package engine

import (
	"bufio"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"time"
)

// JournalEntry is one file operation in a sync batch.
type JournalEntry struct {
	Op     string `json:"op"`   // add | update | delete | rename
	Side   string `json:"side"` // the side that was written: source | target
	Path   string `json:"path"`
	To     string `json:"to,omitempty"`     // rename destination
	Backup string `json:"backup,omitempty"` // copy of the version that was replaced or deleted
}

// Batch is one apply pass, recorded so it can be listed and undone.
type Batch struct {
	ID      string         `json:"id"`
	Time    time.Time      `json:"time"`
	Pair    string         `json:"pair"`
	PairID  string         `json:"pair_id"`
	Source  string         `json:"source"`
	Target  string         `json:"target"`
	Remote  string         `json:"remote,omitempty"`
	Entries []JournalEntry `json:"entries"`
	Undone  bool           `json:"undone,omitempty"`
}

// Counts returns how many entries of each op the batch has.
func (b Batch) Counts() (add, update, del, rename int) {
	for _, en := range b.Entries {
		switch en.Op {
		case "add":
			add++
		case "update":
			update++
		case "delete":
			del++
		case "rename":
			rename++
		}
	}
	return
}

const journalKeep = 200 // batches kept per pair

func journalPath(dataDir, id string) string { return filepath.Join(dataDir, id, "history.jsonl") }

func (e *Engine) appendJournal(entries []JournalEntry) {
	now := time.Now()
	b := Batch{
		ID: now.Format("20060102-150405.000000"), Time: now, Pair: e.cfg.Name, PairID: e.id,
		Source: e.cfg.Source, Target: e.cfg.Target, Remote: e.cfg.Remote, Entries: entries,
	}
	data, err := json.Marshal(b)
	if err != nil {
		return
	}
	p := journalPath(e.dataDir, e.id)
	_ = os.MkdirAll(filepath.Dir(p), 0o755)
	f, err := os.OpenFile(p, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return
	}
	_, _ = f.Write(append(data, '\n'))
	f.Close()
	e.journalN++
	if e.journalN%50 == 1 {
		if bs, err := readJournal(p); err == nil && len(bs) > journalKeep {
			_ = writeJournal(p, bs[len(bs)-journalKeep:])
		}
	}
}

// readJournal returns batches oldest first.
func readJournal(p string) ([]Batch, error) {
	f, err := os.Open(p)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	var out []Batch
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 64*1024), 64<<20)
	for sc.Scan() {
		var b Batch
		if json.Unmarshal(sc.Bytes(), &b) == nil {
			out = append(out, b)
		}
	}
	return out, sc.Err()
}

func writeJournal(p string, bs []Batch) error {
	var buf []byte
	for _, b := range bs {
		data, err := json.Marshal(b)
		if err != nil {
			return err
		}
		buf = append(append(buf, data...), '\n')
	}
	tmp := p + ".tmp"
	if err := os.WriteFile(tmp, buf, 0o644); err != nil {
		return err
	}
	return replaceFile(tmp, p)
}

// History lists a pair's recorded batches, newest first.
func History(dataDir, id string) []Batch {
	bs, _ := readJournal(journalPath(dataDir, id))
	// the file is in append order; reverse it rather than trust clock resolution
	out := make([]Batch, len(bs))
	for i, b := range bs {
		b.PairID = id
		out[len(bs)-1-i] = b
	}
	return out
}

// AllHistory lists the batches of every pair, newest first.
func AllHistory(dataDir string) []Batch {
	entries, _ := os.ReadDir(dataDir)
	var out []Batch
	for _, en := range entries {
		if en.IsDir() {
			out = append(out, History(dataDir, en.Name())...)
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Time.After(out[j].Time) })
	return out
}

// History lists this pair's batches, newest first.
func (e *Engine) History() []Batch { return History(e.dataDir, e.id) }

// UndoLast undoes the newest batch that hasn't been undone yet.
func (e *Engine) UndoLast() (Batch, []string, error) {
	for _, b := range e.History() {
		if !b.Undone {
			_, problems, err := Undo(e.dataDir, b, e.cfg.Backups)
			if err == nil {
				e.Do(func() { e.emit(Event{Kind: KInfo, Msg: "undid the sync batch from " + b.Time.Format("15:04:05")}) })
			}
			return b, problems, err
		}
	}
	return Batch{}, nil, errors.New("nothing to undo")
}

// Undo reverses a recorded batch on disk: files Ferry created are removed,
// overwritten or deleted files come back from their backups, and renames are
// reversed. The versions being replaced are backed up first, so an undo can
// itself be reverted with "ferry backups restore". problems lists files that
// could not be put back (for example because backups were off).
func Undo(dataDir string, b Batch, keep int) (done, problems []string, err error) {
	if b.Undone {
		return nil, nil, errors.New("that batch was already undone")
	}
	if b.Remote != "" {
		return nil, nil, errors.New("undo isn't supported for remote (ssh) targets")
	}
	if keep < 1 {
		keep = 5
	}
	bdir := BackupDir(dataDir, b.PairID)
	root := func(s string) string {
		if s == "source" {
			return b.Source
		}
		return b.Target
	}
	for i := len(b.Entries) - 1; i >= 0; i-- {
		en := b.Entries[i]
		r := root(en.Side)
		p := filepath.Join(r, filepath.FromSlash(en.Path))
		switch en.Op {
		case "add":
			_, _ = backupFile(bdir, en.Side, en.Path, p, keep)
			if err := removeWithRetry(p); err != nil {
				problems = append(problems, en.Path+": "+err.Error())
				continue
			}
			removeEmptyParents(r, p)
		case "update", "delete":
			if en.Backup == "" {
				problems = append(problems, en.Path+": no copy of the earlier version (backups were off)")
				continue
			}
			if _, err := os.Stat(en.Backup); err != nil {
				problems = append(problems, en.Path+": the backup of the earlier version has been pruned")
				continue
			}
			// stage the old version first: backing up the current one may prune en.Backup
			tmp := filepath.Join(filepath.Dir(p), ".ferry-undo-"+filepath.Base(p))
			if _, err := copyFile(en.Backup, tmp); err != nil {
				problems = append(problems, en.Path+": "+err.Error())
				continue
			}
			if en.Op == "update" {
				_, _ = backupFile(bdir, en.Side, en.Path, p, keep)
			}
			if err := replaceFile(tmp, p); err != nil {
				os.Remove(tmp)
				problems = append(problems, en.Path+": "+err.Error())
				continue
			}
		case "rename":
			to := filepath.Join(r, filepath.FromSlash(en.To))
			if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
				problems = append(problems, en.Path+": "+err.Error())
				continue
			}
			if err := replaceFile(to, p); err != nil {
				problems = append(problems, en.To+": "+err.Error())
				continue
			}
			removeEmptyParents(r, to)
		default:
			continue
		}
		done = append(done, en.Op+" "+en.Path)
	}
	return done, problems, markUndone(dataDir, b.PairID, b.ID)
}

func markUndone(dataDir, pairID, batchID string) error {
	p := journalPath(dataDir, pairID)
	bs, err := readJournal(p)
	if err != nil {
		return err
	}
	for i := range bs {
		if bs[i].ID == batchID {
			bs[i].Undone = true
		}
	}
	return writeJournal(p, bs)
}
