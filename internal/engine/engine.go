// Package engine implements the sync loop for one source/target pair.
package engine

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/anupam42/Ferry/internal/config"
	"github.com/anupam42/Ferry/internal/difftext"
	"github.com/anupam42/Ferry/internal/gitx"
	"github.com/anupam42/Ferry/internal/ignore"
	"github.com/anupam42/Ferry/internal/notify"
)

type side int

const (
	src side = iota
	dst
)

func (s side) String() string {
	if s == src {
		return "source"
	}
	return "target"
}
func (s side) other() side { return 1 - s }
func (s side) arrow() string {
	if s == dst {
		return "→"
	}
	return "←"
}

type opKind int

const (
	opCopy     opKind = iota // rel: from side → to side
	opDelete                 // rel on side
	opRename                 // rel → to, on side
	opDup                    // copy rel → to within side (keep-both)
	opBase                   // record base for rel (sides already equal)
	opDropBase               // forget rel
	opConflict               // hold rel for the user
	opOrphan                 // deleted on one side, keep the copy on `side` (on_delete: keep)
)

type op struct {
	kind    opKind
	rel     string
	to      string
	side    side // side being written
	isNew   bool
	restore bool // copy back to the side where the file was deleted
}

// base is the last-synced state of a file in two-way mode.
type base struct {
	Hash   string `json:"h"`
	Size   int64  `json:"s"`
	SrcMod int64  `json:"sm"`
	DstMod int64  `json:"dm"`
	// Orphan != 0 means the file was deleted on one side and deliberately kept
	// on the other (1 = kept in source, 2 = kept in target). It is not copied
	// back unless the kept copy is edited again.
	Orphan int8 `json:"o,omitempty"`
}

func (b base) survivor() side { return side(b.Orphan - 1) }

// Engine syncs one pair. All state is owned by the Run goroutine; other
// goroutines talk to it through Do().
type Engine struct {
	cfg     config.Pair
	emitFn  func(Event)
	dataDir string
	id      string
	twoWay  bool
	matcher atomic.Pointer[ignore.Matcher] // rebuilt each scan so .gitignore edits apply live

	cmds chan func()
	wake chan struct{}

	// loop-owned state
	prevSrc      Snapshot
	state        map[string]base
	lastS        Snapshot
	lastT        Snapshot
	needsApply   bool
	bigSince     time.Time
	approved     bool
	userPaused   bool
	guardReason  string
	branchErr    string
	behind       int
	conflicts    map[string]bool
	mirrorList   []string
	skipped      map[string]FileStat // files skipped for size/binary, so we warn once per change
	watcherKind  string
	isGit        bool
	retryTimer   *time.Timer
	pendingBatch int

	// published snapshot
	mu      sync.Mutex
	status  Status
	changed map[string]ChangedFile
}

// New creates an engine. emit receives every event (must not block for long).
func New(cfg config.Pair, emit func(Event)) *Engine {
	e := &Engine{
		cfg:       cfg,
		emitFn:    emit,
		dataDir:   config.DataDir(),
		id:        cfg.ID(),
		twoWay:    cfg.Mode == "two-way",
		cmds:      make(chan func(), 32),
		wake:      make(chan struct{}, 1),
		state:     map[string]base{},
		conflicts: map[string]bool{},
		skipped:   map[string]FileStat{},
		changed:   map[string]ChangedFile{},
	}
	e.status = Status{Name: cfg.Name, Source: cfg.Source, Target: cfg.Target, Mode: cfg.Mode}
	e.matcher.Store(e.buildMatcher())
	return e
}

func (e *Engine) Name() string        { return e.cfg.Name }
func (e *Engine) Config() config.Pair { return e.cfg }

func (e *Engine) emit(ev Event) {
	ev.Time = time.Now()
	ev.Pair = e.cfg.Name
	if e.cfg.DryRun && (ev.Kind == KAdd || ev.Kind == KUpdate || ev.Kind == KDelete || ev.Kind == KRename) {
		ev.DryRun = true
	}
	if e.emitFn != nil {
		e.emitFn(ev)
	}
}

func (e *Engine) warn(msg string) { e.emit(Event{Kind: KWarn, Msg: msg}) }
func (e *Engine) errorf(path string, err error) {
	e.emit(Event{Kind: KError, Path: path, Msg: err.Error()})
	notify.Send(e.cfg.Name+"/error", "ferry: error in "+e.cfg.Name, strings.TrimSpace(path+" "+err.Error()))
}

func (e *Engine) buildMatcher() *ignore.Matcher {
	m := ignore.New(hardIgnores...)
	if e.cfg.DefaultIgnores {
		m.Add("", DefaultIgnores)
	}
	m.Add("", e.cfg.Ignore)
	roots := []string{e.cfg.Source}
	if e.twoWay {
		roots = append(roots, e.cfg.Target)
	}
	for _, r := range roots {
		m.AddFile(filepath.Join(r, ".syncignore"), "")
		if e.cfg.UseGitignore {
			m.AddFile(filepath.Join(r, ".gitignore"), "")
		}
	}
	// in one-way mode the target's root .gitignore matters too: no point
	// copying files git will ignore anyway
	if !e.twoWay && e.cfg.UseGitignore {
		m.AddFile(filepath.Join(e.cfg.Target, ".gitignore"), "")
	}
	return m
}

func (e *Engine) root(s side) string {
	if s == src {
		return e.cfg.Source
	}
	return e.cfg.Target
}

func (e *Engine) abs(s side, rel string) string {
	return filepath.Join(e.root(s), filepath.FromSlash(rel))
}

// ---------- public API (safe from any goroutine) ----------

// Do runs f on the engine goroutine.
func (e *Engine) Do(f func()) {
	select {
	case e.cmds <- f:
	default:
		go func() { e.cmds <- f }()
	}
}

func (e *Engine) Status() Status {
	e.mu.Lock()
	defer e.mu.Unlock()
	s := e.status
	s.Conflicts = append([]string(nil), s.Conflicts...)
	s.GitStatus = append([]string(nil), s.GitStatus...)
	s.Changed = make([]ChangedFile, 0, len(e.changed))
	for _, c := range e.changed {
		s.Changed = append(s.Changed, c)
	}
	sort.Slice(s.Changed, func(i, j int) bool { return s.Changed[i].Path < s.Changed[j].Path })
	return s
}

func (e *Engine) SetPaused(p bool) {
	e.Do(func() {
		if e.userPaused == p {
			return
		}
		e.userPaused = p
		if p {
			e.emit(Event{Kind: KPaused, Msg: "paused by user"})
		} else {
			e.emit(Event{Kind: KResumed, Msg: "resumed"})
			e.cycle(false, true)
		}
		e.publish()
	})
}

func (e *Engine) TogglePause() { e.Do(func() { go e.SetPaused(!e.userPaused) }) }

// Resync forces a full comparison (content-hash) of both folders.
func (e *Engine) Resync() {
	e.Do(func() {
		e.prevSrc = nil
		e.emit(Event{Kind: KInfo, Msg: "full resync"})
		e.cycle(true, true)
	})
}

func (e *Engine) ApproveBatch() {
	e.Do(func() {
		if e.pendingBatch == 0 {
			return
		}
		e.approved = true
		e.cycle(false, true)
	})
}

// Resolve settles a conflict held for the user.
func (e *Engine) Resolve(rel string, c Choice) {
	e.Do(func() {
		if !e.conflicts[rel] {
			return
		}
		e.resolveNow(rel, c, "resolved: ")
		e.saveState()
		e.publish()
	})
}

// Commit stages and commits everything under the target.
func (e *Engine) Commit(msg string, push bool) {
	e.Do(func() { e.commit(msg, push, false) })
}

// ---------- run loop ----------

// Run syncs until ctx is cancelled. With once=true it does a single pass.
func (e *Engine) Run(ctx context.Context, once bool) error {
	if err := os.MkdirAll(e.cfg.Target, 0o755); err != nil {
		return err
	}
	e.isGit = gitx.IsRepo(e.cfg.Target)
	if e.cfg.Branch != "" {
		if !e.isGit {
			e.warn("branch " + e.cfg.Branch + " requested but target is not a git repo")
		} else if created, err := gitx.EnsureBranch(e.cfg.Target, e.cfg.Branch); err != nil {
			e.branchErr = "can't switch to branch " + e.cfg.Branch + ": " + firstLine(err.Error())
			e.errorf("", fmt.Errorf("%s", e.branchErr))
		} else if created {
			e.emit(Event{Kind: KInfo, Msg: "created and switched to branch " + e.cfg.Branch})
		} else {
			e.emit(Event{Kind: KInfo, Msg: "on branch " + e.cfg.Branch})
		}
	}
	if e.twoWay {
		e.loadState()
		if !e.cfg.DryRun {
			_ = os.MkdirAll(filepath.Dir(pidPath(e.dataDir, e.id)), 0o755)
			_ = os.WriteFile(pidPath(e.dataDir, e.id), []byte(strconv.Itoa(os.Getpid())), 0o644)
			defer os.Remove(pidPath(e.dataDir, e.id))
		}
		for _, c := range sortedKeys(e.conflicts) {
			e.emit(Event{Kind: KConflict, Path: c, Msg: "still unresolved from an earlier run", Held: true})
		}
		e.processRequests()
	}
	e.checkGuard()
	if len(e.mirrorList) > 0 {
		e.applyMirror()
	}
	e.cycle(true, true)
	e.refreshGit(false)
	if once {
		e.saveState()
		return nil
	}

	roots := []string{e.cfg.Source}
	if e.twoWay {
		roots = append(roots, e.cfg.Target)
	}
	w := newWatcher(e.cfg.Watcher, roots, e.cfg.Interval.D(), func(root, rel string, isDir bool) bool {
		return e.matcher.Load().Match(rel, isDir)
	}, e.warn)
	defer w.Close()
	e.watcherKind = w.kind
	e.publish()

	settle := e.cfg.Settle.D()
	if settle <= 0 {
		settle = 300 * time.Millisecond
	}
	debounce := time.NewTimer(time.Hour)
	debounce.Stop()
	guard := time.NewTicker(2 * time.Second)
	defer guard.Stop()

	var upstream <-chan time.Time
	if e.cfg.CheckUpstream > 0 && e.isGit {
		t := time.NewTicker(e.cfg.CheckUpstream.D())
		defer t.Stop()
		upstream = t.C
		go e.Do(e.checkUpstream)
	}
	var autoCommit <-chan time.Time
	if e.cfg.AutoCommit.Enabled && e.isGit {
		t := time.NewTicker(e.cfg.AutoCommit.Interval.D())
		defer t.Stop()
		autoCommit = t.C
	}

	for {
		select {
		case <-ctx.Done():
			e.saveState()
			return nil
		case <-w.c:
			if w.kind == "poll" {
				e.cycle(false, false) // polling already spaces scans out
			} else {
				debounce.Reset(settle)
			}
		case <-e.wake:
			e.cycle(false, false)
		case <-debounce.C:
			e.cycle(false, false)
		case f := <-e.cmds:
			f()
		case <-guard.C:
			if e.twoWay {
				e.processRequests()
			}
			e.checkGuard()
			e.refreshGit(false)
		case <-upstream:
			e.checkUpstream()
		case <-autoCommit:
			e.commit(e.cfg.AutoCommit.Message, e.cfg.AutoCommit.Push, true)
		}
	}
}

func (e *Engine) scheduleWake(d time.Duration) {
	if e.retryTimer != nil {
		e.retryTimer.Stop()
	}
	e.retryTimer = time.AfterFunc(d, func() {
		select {
		case e.wake <- struct{}{}:
		default:
		}
	})
}

// cycle scans, and when the scan is stable, plans and applies changes.
// initial/force skip the stability check.
func (e *Engine) cycle(initial, force bool) {
	if e.paused() {
		e.needsApply = true
		e.publish()
		return
	}
	m := e.buildMatcher()
	e.matcher.Store(m)
	S, err := scanDir(e.cfg.Source, m, e.cfg.UseGitignore)
	if err != nil {
		e.errorf("", fmt.Errorf("scan source: %w", err))
		return
	}
	var T Snapshot
	if e.twoWay {
		if T, err = scanDir(e.cfg.Target, m, e.cfg.UseGitignore); err != nil {
			e.errorf("", fmt.Errorf("scan target: %w", err))
			return
		}
	}

	if !initial && !force {
		changed := !S.Equal(e.lastS) || (e.twoWay && !T.Equal(e.lastT))
		if changed {
			// wait one settle period and make sure nothing is still being written
			e.lastS, e.lastT = S, T
			e.needsApply = true
			e.bigSince = time.Time{}
			e.scheduleWake(e.settle())
			e.publish()
			return
		}
		if !e.needsApply {
			return
		}
	}
	e.lastS, e.lastT = S, T

	var ops []op
	if e.twoWay {
		ops = e.planTwoWay(S, T)
	} else {
		ops = e.planOneWay(S)
	}
	ops = e.detectRenames(ops)

	// large batches (npm install, git checkout in source, ...): wait for things to calm down
	if n := countWrites(ops); n > e.cfg.BatchLimit && e.cfg.BatchLimit > 0 && !initial {
		if e.bigSince.IsZero() {
			e.bigSince = time.Now()
			e.emit(Event{Kind: KWarn, Msg: fmt.Sprintf("large batch: %d changes, waiting %s for activity to settle", n, e.cfg.BatchSettle.D())})
		}
		if time.Since(e.bigSince) < e.cfg.BatchSettle.D() {
			e.scheduleWake(e.cfg.BatchSettle.D() - time.Since(e.bigSince) + 50*time.Millisecond)
			return
		}
		if e.cfg.BatchAction == "confirm" && !e.approved {
			if e.pendingBatch != n {
				e.emit(Event{Kind: KWarn, Msg: fmt.Sprintf("%d changes waiting for approval (press y in the dashboard)", n)})
				notify.Send(e.cfg.Name+"/batch", "ferry: "+e.cfg.Name, fmt.Sprintf("%d changes waiting for approval", n))
			}
			e.pendingBatch = n
			e.publish()
			return
		}
	}

	e.needsApply = false
	e.bigSince = time.Time{}
	e.approved = false
	e.pendingBatch = 0

	failed := e.apply(ops)
	if !e.twoWay {
		next := Snapshot{}
		for k, v := range S {
			if !failed[k] {
				next[k] = v
			}
		}
		e.prevSrc = next
	}
	if len(failed) > 0 {
		e.needsApply = true
		e.scheduleWake(5 * time.Second)
	}
	e.saveState()
	if countWrites(ops) > 0 {
		e.refreshGit(true)
	}
	e.publish()
}

func (e *Engine) settle() time.Duration {
	if d := e.cfg.Settle.D(); d > 0 {
		return d
	}
	return 300 * time.Millisecond
}

func (e *Engine) paused() bool {
	return e.userPaused || e.guardReason != "" || e.branchErr != ""
}

func countWrites(ops []op) int {
	n := 0
	for _, o := range ops {
		if o.kind == opCopy || o.kind == opDelete || o.kind == opRename || o.kind == opDup {
			n++
		}
	}
	return n
}

// ---------- planning ----------

func (e *Engine) planOneWay(S Snapshot) []op {
	var ops []op
	keys := sortedKeys(S)
	for _, rel := range keys {
		s := S[rel]
		if p, ok := e.prevSrc[rel]; ok && p.Size == s.Size && p.Mod == s.Mod {
			continue
		}
		d := e.abs(dst, rel)
		_, err := os.Stat(d)
		exists := err == nil
		if exists && sameContent(e.abs(src, rel), d) {
			continue
		}
		ops = append(ops, op{kind: opCopy, rel: rel, side: dst, isNew: !exists})
	}
	if e.cfg.Delete && e.prevSrc != nil {
		for _, rel := range sortedKeys(e.prevSrc) {
			if _, ok := S[rel]; ok {
				continue
			}
			if _, err := os.Stat(e.abs(dst, rel)); err == nil {
				ops = append(ops, op{kind: opDelete, rel: rel, side: dst})
			}
		}
	}
	return ops
}

// changedSince reports whether a side differs from the last-synced base.
func (e *Engine) changedSince(s side, st FileStat, ok bool, b base, bok bool, rel string) bool {
	if !bok {
		return ok
	}
	if !ok {
		return true
	}
	mod := b.SrcMod
	if s == dst {
		mod = b.DstMod
	}
	if st.Size == b.Size && st.Mod == mod {
		return false
	}
	if st.Size != b.Size {
		return true
	}
	// same size, new mtime: compare content (touch, checkout, editor re-save)
	h, err := hashFile(e.abs(s, rel))
	if err != nil {
		return true
	}
	if h == b.Hash {
		if s == src {
			b.SrcMod = st.Mod
		} else {
			b.DstMod = st.Mod
		}
		e.state[rel] = b
		return false
	}
	return true
}

func (e *Engine) planTwoWay(S, T Snapshot) []op {
	keys := map[string]bool{}
	for k := range S {
		keys[k] = true
	}
	for k := range T {
		keys[k] = true
	}
	for k := range e.state {
		keys[k] = true
	}
	var ops []op
	for _, rel := range sortedKeys(keys) {
		s, sok := S[rel]
		t, tok := T[rel]
		b, bok := e.state[rel]

		if e.conflicts[rel] {
			if sok && tok && sameContent(e.abs(src, rel), e.abs(dst, rel)) {
				delete(e.conflicts, rel)
				ops = append(ops, op{kind: opBase, rel: rel})
				e.emit(Event{Kind: KResolved, Path: rel, Msg: "both sides now match"})
			}
			continue
		}

		if bok && b.Orphan != 0 {
			o, handled := e.orphanOps(rel, b, s, sok, t, tok)
			ops = append(ops, o...)
			if handled {
				continue
			}
			// recreated on the side where it was deleted: treat as never synced
			delete(e.state, rel)
			b, bok = base{}, false
		}

		sCh := e.changedSince(src, s, sok, b, bok, rel)
		b = e.state[rel] // may have been refreshed
		tCh := e.changedSince(dst, t, tok, b, bok, rel)

		switch {
		case !sCh && !tCh:
			continue
		case sCh && !tCh:
			ops = append(ops, e.propagate(src, rel, sok, tok)...)
		case tCh && !sCh:
			ops = append(ops, e.propagate(dst, rel, tok, sok)...)
		default: // both changed
			switch {
			case !sok && !tok:
				ops = append(ops, op{kind: opDropBase, rel: rel})
			case sok && tok && sameContent(e.abs(src, rel), e.abs(dst, rel)):
				ops = append(ops, op{kind: opBase, rel: rel})
			default:
				ops = append(ops, e.conflictOps(rel)...)
			}
		}
	}
	return ops
}

// propagate pushes a change made on `from` to the other side.
func (e *Engine) propagate(from side, rel string, fromOK, toOK bool) []op {
	to := from.other()
	if fromOK {
		return []op{{kind: opCopy, rel: rel, side: to, isNew: !toOK}}
	}
	// deleted on `from`
	if !toOK {
		return []op{{kind: opDropBase, rel: rel}}
	}
	switch e.cfg.OnDelete {
	case "propagate":
		return []op{{kind: opDelete, rel: rel, side: to}}
	case "restore":
		return []op{{kind: opCopy, rel: rel, side: from, isNew: true, restore: true}}
	default: // keep: leave the other copy alone and remember not to copy it back
		return []op{{kind: opOrphan, rel: rel, side: to}}
	}
}

// orphanOps handles a file that was deleted on one side and kept on the other.
// handled=false means it was recreated on the deleted side and should be
// planned as a fresh file.
func (e *Engine) orphanOps(rel string, b base, s FileStat, sok bool, t FileStat, tok bool) ([]op, bool) {
	surv := b.survivor()
	survSt, survOK, goneOK := s, sok, tok
	mod := b.SrcMod
	if surv == dst {
		survSt, survOK, goneOK = t, tok, sok
		mod = b.DstMod
	}
	switch {
	case goneOK:
		return nil, false
	case !survOK:
		return []op{{kind: opDropBase, rel: rel}}, true
	}
	if survSt.Size == b.Size && survSt.Mod == mod {
		return nil, true
	}
	if survSt.Size == b.Size {
		if h, err := hashFile(e.abs(surv, rel)); err == nil && h == b.Hash {
			if surv == src {
				b.SrcMod = survSt.Mod
			} else {
				b.DstMod = survSt.Mod
			}
			e.state[rel] = b
			return nil, true
		}
	}
	// the kept copy was edited again: it's live work, bring it back
	e.emit(Event{Kind: KInfo, Path: rel, Msg: "edited in " + surv.String() + " after being deleted in " + surv.other().String() + "; copying it back"})
	return []op{{kind: opCopy, rel: rel, side: surv.other(), isNew: true}}, true
}

func (e *Engine) conflictOps(rel string) []op {
	switch e.cfg.Conflict {
	case "ask", "hold":
		return []op{{kind: opConflict, rel: rel}}
	default:
		e.emit(Event{Kind: KConflict, Path: rel, Msg: "changed on both sides; auto-resolving: " + e.cfg.Conflict})
		return e.resolveOps(rel, Choice(e.cfg.Conflict))
	}
}

// resolveOps turns a conflict choice into concrete operations.
func (e *Engine) resolveOps(rel string, c Choice) []op {
	si, serr := os.Stat(e.abs(src, rel))
	ti, terr := os.Stat(e.abs(dst, rel))
	sok, tok := serr == nil, terr == nil

	winner := func(w side) []op {
		wok := (w == src && sok) || (w == dst && tok)
		lok := (w == src && tok) || (w == dst && sok)
		if wok {
			return []op{{kind: opCopy, rel: rel, side: w.other(), isNew: !lok}}
		}
		if lok {
			return []op{{kind: opDelete, rel: rel, side: w.other()}}
		}
		return []op{{kind: opDropBase, rel: rel}}
	}
	switch {
	case !sok && !tok:
		return []op{{kind: opDropBase, rel: rel}}
	case !sok || !tok:
		if c == UseSource {
			return winner(src)
		}
		if c == UseTarget {
			return winner(dst)
		}
		// newer / keep-both: a surviving edit beats a deletion
		if sok {
			return winner(src)
		}
		return winner(dst)
	}
	switch c {
	case UseSource:
		return winner(src)
	case UseTarget:
		return winner(dst)
	case UseNewer:
		if si.ModTime().After(ti.ModTime()) {
			return winner(src)
		}
		return winner(dst)
	default: // keep-both: target version keeps the name, source version saved alongside
		cp := conflictName(rel, "source")
		return []op{
			{kind: opDup, rel: rel, to: cp, side: src},
			{kind: opCopy, rel: rel, side: src},
		}
	}
}

func conflictName(rel, who string) string {
	ext := filepath.Ext(rel)
	stem := strings.TrimSuffix(rel, ext)
	return fmt.Sprintf("%s.conflict-%s-%s%s", stem, who, time.Now().Format("20060102-150405"), ext)
}

// detectRenames replaces delete+add pairs with identical content by a rename.
// In two-way mode without delete propagation, a "restore" of the old name plus
// a copy of the new name is also recognised as a rename on the other side.
func (e *Engine) detectRenames(ops []op) []op {
	type key struct {
		s    side
		size int64
	}
	type cand struct {
		idx  int
		side side // side where the old file still exists and will be renamed
	}
	dels := map[key][]cand{}
	for i, o := range ops {
		var where side
		switch {
		case o.kind == opDelete:
			where = o.side
		case o.kind == opCopy && o.restore:
			where = o.side.other()
		case o.kind == opOrphan:
			where = o.side
		default:
			continue
		}
		if fi, err := os.Stat(e.abs(where, o.rel)); err == nil {
			k := key{where, fi.Size()}
			dels[k] = append(dels[k], cand{i, where})
		}
	}
	if len(dels) == 0 {
		return ops
	}
	drop := map[int]bool{}
	for i, o := range ops {
		if o.kind != opCopy || !o.isNew || o.restore {
			continue
		}
		fi, err := os.Stat(e.abs(o.side.other(), o.rel))
		if err != nil {
			continue
		}
		k := key{o.side, fi.Size()}
		for _, c := range dels[k] {
			if drop[c.idx] {
				continue
			}
			if sameContent(e.abs(o.side.other(), o.rel), e.abs(c.side, ops[c.idx].rel)) {
				ops[i] = op{kind: opRename, rel: ops[c.idx].rel, to: o.rel, side: o.side}
				drop[c.idx] = true
				break
			}
		}
	}
	out := ops[:0:0]
	for i, o := range ops {
		if !drop[i] {
			out = append(out, o)
		}
	}
	return out
}

// ---------- applying ----------

func (e *Engine) apply(ops []op) (failed map[string]bool) {
	failed = map[string]bool{}
	var tick <-chan time.Time
	if e.cfg.MaxOpsPerSec > 0 {
		t := time.NewTicker(time.Second / time.Duration(e.cfg.MaxOpsPerSec))
		defer t.Stop()
		tick = t.C
	}
	var added, updated, deleted, renamed, skipped, errs int
	bdir := BackupDir(e.dataDir, e.id)

	for _, o := range ops {
		if tick != nil && (o.kind == opCopy || o.kind == opDelete || o.kind == opRename || o.kind == opDup) {
			<-tick
		}
		switch o.kind {
		case opBase:
			e.recordBase(o.rel)
		case opDropBase:
			delete(e.state, o.rel)
		case opOrphan:
			if e.cfg.DryRun {
				e.emit(Event{Kind: KKept, Path: o.rel, Msg: "deleted in " + o.side.other().String() + "; kept in " + o.side.String()})
				continue
			}
			p := e.abs(o.side, o.rel)
			fi, err := os.Stat(p)
			h, herr := hashFile(p)
			if err != nil || herr != nil {
				delete(e.state, o.rel)
				continue
			}
			b := base{Hash: h, Size: fi.Size(), Orphan: int8(o.side) + 1}
			if o.side == src {
				b.SrcMod = fi.ModTime().UnixNano()
			} else {
				b.DstMod = fi.ModTime().UnixNano()
			}
			e.state[o.rel] = b
			e.emit(Event{Kind: KKept, Path: o.rel, Msg: "deleted in " + o.side.other().String() + "; kept in " + o.side.String() + " (on_delete: keep)"})
			e.track(o.rel, KKept, "")
		case opConflict:
			if !e.conflicts[o.rel] {
				e.conflicts[o.rel] = true
				msg := "changed on both sides; choose a version"
				if e.cfg.Conflict == "hold" {
					msg = "changed on both sides; both files left as they are. Resolve with: ferry resolve " + o.rel + " --keep source|target|newer|both"
				}
				e.emit(Event{Kind: KConflict, Path: o.rel, Msg: msg, Held: true})
				e.track(o.rel, KConflict, "")
				notify.Send(e.cfg.Name+"/conflict", "ferry: conflict in "+e.cfg.Name, o.rel+" changed on both sides")
			}
		case opCopy:
			from := o.side.other()
			fp := e.abs(from, o.rel)
			fi, err := os.Stat(fp)
			if err != nil {
				failed[o.rel] = true
				continue
			}
			stat := FileStat{fi.Size(), fi.ModTime().UnixNano(), fi.Mode()}
			if e.cfg.MaxSize > 0 && fi.Size() > int64(e.cfg.MaxSize) {
				if e.skipped[o.rel] != stat {
					e.emit(Event{Kind: KSkip, Path: o.rel, Msg: fmt.Sprintf("too large (%s > %s)", config.HumanSize(fi.Size()), config.HumanSize(int64(e.cfg.MaxSize)))})
					e.skipped[o.rel] = stat
				}
				skipped++
				continue
			}
			if e.cfg.Binary != "allow" && isBinaryFile(fp) {
				if e.cfg.Binary == "skip" {
					if e.skipped[o.rel] != stat {
						e.emit(Event{Kind: KSkip, Path: o.rel, Msg: "binary file"})
						e.skipped[o.rel] = stat
					}
					skipped++
					continue
				}
				if o.isNew {
					e.emit(Event{Kind: KWarn, Path: o.rel, Msg: fmt.Sprintf("binary file (%s) — are you sure it belongs in git?", config.HumanSize(fi.Size()))})
				}
			}
			delete(e.skipped, o.rel)
			kind := KUpdate
			if o.isNew {
				kind = KAdd
			}
			if e.cfg.DryRun {
				e.emit(Event{Kind: kind, Path: o.rel, Dir: o.side.arrow()})
				if o.isNew {
					added++
				} else {
					updated++
				}
				continue
			}
			tp := e.abs(o.side, o.rel)
			if !o.isNew {
				_ = backupFile(bdir, o.side.String(), o.rel, tp, e.cfg.Backups)
			}
			if _, err := copyFile(fp, tp); err != nil {
				failed[o.rel] = true
				errs++
				e.errorf(o.rel, err)
				continue
			}
			e.recordBase(o.rel)
			e.emit(Event{Kind: kind, Path: o.rel, Dir: o.side.arrow()})
			e.track(o.rel, kind, o.side.arrow())
			if o.isNew {
				added++
			} else {
				updated++
			}
		case opDelete:
			if e.cfg.DryRun {
				e.emit(Event{Kind: KDelete, Path: o.rel, Dir: o.side.arrow()})
				deleted++
				continue
			}
			p := e.abs(o.side, o.rel)
			_ = backupFile(bdir, o.side.String(), o.rel, p, e.cfg.Backups)
			if err := removeWithRetry(p); err != nil {
				failed[o.rel] = true
				errs++
				e.errorf(o.rel, err)
				continue
			}
			removeEmptyParents(e.root(o.side), p)
			delete(e.state, o.rel)
			e.emit(Event{Kind: KDelete, Path: o.rel, Dir: o.side.arrow()})
			e.track(o.rel, KDelete, o.side.arrow())
			deleted++
		case opRename:
			if e.cfg.DryRun {
				e.emit(Event{Kind: KRename, Path: o.rel, To: o.to, Dir: o.side.arrow()})
				renamed++
				continue
			}
			from, to := e.abs(o.side, o.rel), e.abs(o.side, o.to)
			if err := os.MkdirAll(filepath.Dir(to), 0o755); err == nil {
				err = replaceFile(from, to)
				if err != nil {
					failed[o.to] = true
					errs++
					e.errorf(o.rel, err)
					continue
				}
			}
			removeEmptyParents(e.root(o.side), from)
			delete(e.state, o.rel)
			e.recordBase(o.to)
			e.emit(Event{Kind: KRename, Path: o.rel, To: o.to, Dir: o.side.arrow()})
			e.untrack(o.rel)
			e.track(o.to, KRename, o.side.arrow())
			renamed++
		case opDup:
			if e.cfg.DryRun {
				continue
			}
			if _, err := copyFile(e.abs(o.side, o.rel), e.abs(o.side, o.to)); err != nil {
				failed[o.rel] = true
				errs++
				e.errorf(o.to, err)
				continue
			}
			e.emit(Event{Kind: KInfo, Path: o.to, Msg: "kept " + o.side.String() + " version of " + o.rel})
		}
	}
	if added+updated+deleted+renamed+skipped+errs > 0 {
		e.mu.Lock()
		e.status.Added += added
		e.status.Updated += updated
		e.status.Deleted += deleted
		e.status.Renamed += renamed
		e.status.Skipped += skipped
		e.status.Failed += errs
		if added+updated+deleted+renamed > 0 {
			e.status.LastSync = time.Now()
		}
		e.mu.Unlock()
		if added+updated+deleted+renamed+errs > 0 && !e.cfg.DryRun {
			e.emit(Event{Kind: KSynced, Msg: fmt.Sprintf("+%d ~%d -%d ↻%d !%d", added, updated, deleted, renamed, errs)})
		}
	}
	return failed
}

func (e *Engine) recordBase(rel string) {
	if !e.twoWay || e.cfg.DryRun {
		return
	}
	si, err1 := os.Stat(e.abs(src, rel))
	ti, err2 := os.Stat(e.abs(dst, rel))
	if err1 != nil || err2 != nil {
		delete(e.state, rel)
		return
	}
	h, err := hashFile(e.abs(dst, rel))
	if err != nil {
		return
	}
	e.state[rel] = base{Hash: h, Size: ti.Size(), SrcMod: si.ModTime().UnixNano(), DstMod: ti.ModTime().UnixNano()}
}

func (e *Engine) track(rel string, k Kind, dir string) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if len(e.changed) > 5000 {
		return
	}
	e.changed[rel] = ChangedFile{Path: rel, Kind: k, Dir: dir, Time: time.Now()}
}

func (e *Engine) untrack(rel string) {
	e.mu.Lock()
	delete(e.changed, rel)
	e.mu.Unlock()
}

// ---------- mirror ----------

// PlanMirror lists target files that don't exist in source (respecting ignores).
func (e *Engine) PlanMirror() ([]string, error) {
	m := e.buildMatcher()
	S, err := scanDir(e.cfg.Source, m, e.cfg.UseGitignore)
	if err != nil {
		return nil, err
	}
	T, err := scanDir(e.cfg.Target, m, e.cfg.UseGitignore)
	if err != nil {
		return nil, err
	}
	var extra []string
	for _, rel := range sortedKeys(T) {
		if _, ok := S[rel]; !ok {
			extra = append(extra, rel)
		}
	}
	return extra, nil
}

// ApproveMirror must be called before Run with the list the user confirmed.
func (e *Engine) ApproveMirror(list []string) { e.mirrorList = list }

func (e *Engine) applyMirror() {
	var ops []op
	for _, rel := range e.mirrorList {
		ops = append(ops, op{kind: opDelete, rel: rel, side: dst})
	}
	e.emit(Event{Kind: KInfo, Msg: fmt.Sprintf("mirror: removing %d target files not in source", len(ops))})
	e.apply(ops)
	e.mirrorList = nil
}

// ---------- git ----------

func (e *Engine) checkGuard() {
	if !e.isGit {
		return
	}
	reason := e.branchErr
	if reason == "" && e.cfg.GitGuard {
		reason = gitx.InProgress(e.cfg.Target)
	}
	if reason == "" && e.behind > 0 {
		reason = fmt.Sprintf("target is %d commit(s) behind upstream — pull first", e.behind)
	}
	if reason == e.guardReason {
		return
	}
	was := e.guardReason
	e.guardReason = reason
	if reason != "" {
		e.emit(Event{Kind: KPaused, Msg: reason})
		notify.Send(e.cfg.Name+"/guard", "ferry paused: "+e.cfg.Name, reason)
	} else if was != "" {
		e.emit(Event{Kind: KResumed, Msg: "git is clear again; resuming"})
		if e.needsApply {
			e.cycle(false, true)
		}
	}
	e.publish()
}

func (e *Engine) checkUpstream() {
	if err := gitx.Fetch(e.cfg.Target); err != nil {
		e.warn("fetch failed: " + firstLine(err.Error()))
		return
	}
	e.behind = gitx.Behind(e.cfg.Target)
	e.checkGuard()
}

func (e *Engine) refreshGit(emit bool) {
	if !e.isGit {
		return
	}
	lines, err := gitx.Status(e.cfg.Target)
	if err != nil {
		return
	}
	branch := gitx.CurrentBranch(e.cfg.Target)
	e.mu.Lock()
	e.status.GitStatus = lines
	e.status.Branch = branch
	e.mu.Unlock()
	if emit {
		e.emit(Event{Kind: KGit, Lines: lines, Msg: branch})
	}
}

func (e *Engine) commit(tmpl string, push, auto bool) {
	if !e.isGit {
		e.warn("target is not a git repo; nothing to commit")
		return
	}
	if r := gitx.InProgress(e.cfg.Target); r != "" {
		if !auto {
			e.warn("not committing: " + r)
		}
		return
	}
	lines, _ := gitx.Status(e.cfg.Target)
	if len(lines) == 0 {
		if !auto {
			e.emit(Event{Kind: KInfo, Msg: "nothing to commit"})
		}
		return
	}
	msg := expandMessage(tmpl, e.cfg, lines)
	hash, err := gitx.CommitAll(e.cfg.Target, msg)
	if err != nil {
		e.errorf("", fmt.Errorf("commit failed: %s", firstLine(err.Error())))
		return
	}
	if hash == "" {
		return
	}
	e.emit(Event{Kind: KCommit, Msg: fmt.Sprintf("%s %s", hash, firstLine(msg))})
	if push {
		if err := gitx.Push(e.cfg.Target); err != nil {
			e.errorf("", fmt.Errorf("push failed: %s", firstLine(err.Error())))
		} else {
			e.emit(Event{Kind: KCommit, Msg: "pushed " + gitx.CurrentBranch(e.cfg.Target)})
		}
	}
	e.refreshGit(true)
	e.publish()
}

func expandMessage(tmpl string, p config.Pair, lines []string) string {
	now := time.Now()
	var files []string
	for _, l := range lines {
		if len(l) > 3 {
			files = append(files, strings.Trim(l[3:], `"`))
		}
	}
	shown := files
	if len(shown) > 5 {
		shown = append(append([]string{}, shown[:5]...), fmt.Sprintf("+%d more", len(files)-5))
	}
	r := strings.NewReplacer(
		"{count}", fmt.Sprint(len(files)),
		"{files}", strings.Join(shown, ", "),
		"{source}", filepath.Base(p.Source),
		"{target}", filepath.Base(p.Target),
		"{pair}", p.Name,
		"{date}", now.Format("2006-01-02"),
		"{time}", now.Format("15:04"),
		"{datetime}", now.Format("2006-01-02 15:04"),
	)
	return r.Replace(tmpl)
}

// ---------- diff ----------

// Diff returns a diff for rel suitable for display, plus a title.
// Conflicts compare target→source; otherwise the target file vs git HEAD;
// without git, target vs source.
func (e *Engine) Diff(rel string, conflict bool) (string, []difftext.Line) {
	read := func(p string) []byte { b, _ := os.ReadFile(p); return b }
	tpath, spath := e.abs(dst, rel), e.abs(src, rel)
	if conflict || !gitx.IsRepo(e.cfg.Target) {
		return "target ↔ source: " + rel, difftext.Diff(read(tpath), read(spath), 3)
	}
	head, ok := gitx.ShowHead(e.cfg.Target, rel)
	title := "HEAD ↔ working copy: " + rel
	if !ok {
		title = "new file (not in HEAD): " + rel
	}
	return title, difftext.Diff(head, read(tpath), 3)
}

// ---------- state ----------

func (e *Engine) statePath() string { return filepath.Join(e.dataDir, e.id, "state.json") }

// stateFile is persisted per pair (two-way only). It keeps the pair's config so
// "ferry conflicts / resolve" can work without the original flags.
type stateFile struct {
	Version   int             `json:"version"`
	Pair      config.Pair     `json:"pair"`
	Files     map[string]base `json:"files"`
	Conflicts []string        `json:"conflicts,omitempty"`
}

func readStateFile(path string) (*stateFile, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var sf stateFile
	if err := json.Unmarshal(data, &sf); err == nil && sf.Files != nil {
		return &sf, nil
	}
	// v1.0 format: just the file map
	var old map[string]base
	if err := json.Unmarshal(data, &old); err != nil {
		return nil, err
	}
	return &stateFile{Files: old}, nil
}

func (e *Engine) loadState() {
	sf, err := readStateFile(e.statePath())
	if err != nil {
		return
	}
	e.state = sf.Files
	for _, c := range sf.Conflicts {
		e.conflicts[c] = true
	}
}

func (e *Engine) saveState() {
	if !e.twoWay || e.cfg.DryRun {
		return
	}
	p := e.statePath()
	_ = os.MkdirAll(filepath.Dir(p), 0o755)
	sf := stateFile{Version: 2, Pair: e.cfg, Files: e.state, Conflicts: sortedKeys(e.conflicts)}
	data, _ := json.Marshal(sf)
	tmp := p + ".tmp"
	if os.WriteFile(tmp, data, 0o644) == nil {
		_ = replaceFile(tmp, p)
	}
}

// ---------- conflicts held across processes ----------

// SavedPair describes a two-way pair known from its state file.
type SavedPair struct {
	ID        string
	Pair      config.Pair
	Conflicts []string
	PID       int // >0 if a ferry process is syncing this pair now
}

// SavedPairs lists every two-way pair that has state in dataDir.
func SavedPairs(dataDir string) []SavedPair {
	entries, _ := os.ReadDir(dataDir)
	var out []SavedPair
	for _, en := range entries {
		if !en.IsDir() {
			continue
		}
		sf, err := readStateFile(filepath.Join(dataDir, en.Name(), "state.json"))
		if err != nil || sf.Pair.Source == "" {
			continue
		}
		sp := SavedPair{ID: en.Name(), Pair: sf.Pair, Conflicts: sf.Conflicts}
		sp.PID, _ = RunningPID(dataDir, en.Name())
		out = append(out, sp)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Pair.Name < out[j].Pair.Name })
	return out
}

func pidPath(dataDir, id string) string { return filepath.Join(dataDir, id, "engine.pid") }

// RunningPID reports the process currently syncing the pair, if any.
func RunningPID(dataDir, id string) (int, bool) {
	b, err := os.ReadFile(pidPath(dataDir, id))
	if err != nil {
		return 0, false
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(b)))
	if err != nil || !processAlive(pid) {
		return 0, false
	}
	return pid, true
}

func requestDir(dataDir, id string) string { return filepath.Join(dataDir, id, "resolve") }

type resolveRequest struct {
	Path   string `json:"path"`
	Choice Choice `json:"choice"`
}

// QueueResolve asks whichever process owns the pair (now or next start) to
// resolve a held conflict.
func QueueResolve(dataDir, id, rel string, c Choice) error {
	dir := requestDir(dataDir, id)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	data, _ := json.Marshal(resolveRequest{Path: rel, Choice: c})
	h := sha256.Sum256([]byte(rel))
	name := filepath.Join(dir, hex.EncodeToString(h[:8])+".json")
	tmp := name + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return replaceFile(tmp, name)
}

// PendingRequests counts resolve requests not yet applied.
func PendingRequests(dataDir, id string) int {
	m, _ := filepath.Glob(filepath.Join(requestDir(dataDir, id), "*.json"))
	return len(m)
}

// processRequests applies queued resolve requests (loop goroutine only).
func (e *Engine) processRequests() {
	files, _ := filepath.Glob(filepath.Join(requestDir(e.dataDir, e.id), "*.json"))
	if len(files) == 0 {
		return
	}
	for _, f := range files {
		data, err := os.ReadFile(f)
		os.Remove(f)
		if err != nil {
			continue
		}
		var r resolveRequest
		if json.Unmarshal(data, &r) != nil {
			continue
		}
		if !e.conflicts[r.Path] {
			e.warn("resolve request for " + r.Path + " ignored: not a conflict")
			continue
		}
		e.resolveNow(r.Path, r.Choice, "resolved from the command line: ")
	}
	e.saveState()
	e.publish()
}

func (e *Engine) resolveNow(rel string, c Choice, prefix string) {
	ops := e.resolveOps(rel, c)
	delete(e.conflicts, rel)
	e.apply(ops)
	e.emit(Event{Kind: KResolved, Path: rel, Msg: prefix + string(c)})
}

// ResolveSync resolves a conflict when the run loop is not running
// (after a --once pass).
func (e *Engine) ResolveSync(rel string, c Choice) {
	if !e.conflicts[rel] {
		return
	}
	e.resolveNow(rel, c, "resolved: ")
	e.saveState()
	e.publish()
}

// HeldConflicts lists conflicts waiting for a decision (safe when the loop isn't running).
func (e *Engine) HeldConflicts() []string { return sortedKeys(e.conflicts) }

// ResolveOffline applies queued resolve requests for a pair that no process is
// running, using the pair's saved config. It never scans or syncs anything else.
func ResolveOffline(dataDir, id string, emit func(Event)) error {
	sf, err := readStateFile(filepath.Join(dataDir, id, "state.json"))
	if err != nil {
		return err
	}
	if sf.Pair.Source == "" {
		return fmt.Errorf("no saved config for this pair; run ferry on it once first")
	}
	e := New(sf.Pair, emit)
	e.dataDir, e.id = dataDir, id
	e.loadState()
	e.processRequests()
	return nil
}

// publish copies loop-owned fields into the shared status.
func (e *Engine) publish() {
	conf := make([]string, 0, len(e.conflicts))
	for k := range e.conflicts {
		conf = append(conf, k)
	}
	sort.Strings(conf)
	e.mu.Lock()
	e.status.UserPaused = e.userPaused
	e.status.GuardReason = e.guardReason
	if e.branchErr != "" {
		e.status.GuardReason = e.branchErr
	}
	e.status.Conflicts = conf
	e.status.Watcher = e.watcherKind
	e.status.IsGit = e.isGit
	e.status.Pending = e.needsApply
	e.status.PendingBatch = e.pendingBatch
	e.mu.Unlock()
}

func sortedKeys[V any](m map[string]V) []string {
	ks := make([]string, 0, len(m))
	for k := range m {
		ks = append(ks, k)
	}
	sort.Strings(ks)
	return ks
}

func firstLine(s string) string {
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		return s[:i]
	}
	return s
}
