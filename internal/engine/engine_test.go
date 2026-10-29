package engine

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/anupam42/Ferry/internal/config"
	"github.com/anupam42/Ferry/internal/notify"
)

type rec struct {
	mu  sync.Mutex
	evs []Event
}

func (r *rec) add(e Event) { r.mu.Lock(); r.evs = append(r.evs, e); r.mu.Unlock() }
func (r *rec) has(k Kind, path string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, e := range r.evs {
		if e.Kind == k && (path == "" || e.Path == path) {
			return true
		}
	}
	return false
}

func setup(t *testing.T, mut func(*config.Pair)) (*Engine, *rec, string, string) {
	t.Helper()
	notify.Enabled = false
	t.Setenv("FERRY_HOME", t.TempDir())
	root := t.TempDir()
	s, d := filepath.Join(root, "src"), filepath.Join(root, "dst")
	os.MkdirAll(s, 0o755)
	os.MkdirAll(d, 0o755)
	p := config.Defaults()
	p.Source, p.Target = s, d
	if mut != nil {
		mut(&p)
	}
	if err := p.Normalize(); err != nil {
		t.Fatal(err)
	}
	r := &rec{}
	return New(p, r.add), r, s, d
}

func write(t *testing.T, root, rel, content string) {
	t.Helper()
	p := filepath.Join(root, filepath.FromSlash(rel))
	os.MkdirAll(filepath.Dir(p), 0o755)
	if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	// make sure mtime moves even on coarse filesystems
	future := time.Now().Add(time.Duration(len(content)+1) * time.Millisecond)
	os.Chtimes(p, future, future)
}

func read(root, rel string) string {
	b, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(rel)))
	if err != nil {
		return "<missing>"
	}
	return string(b)
}

func run(t *testing.T, e *Engine) {
	t.Helper()
	if err := e.Run(context.Background(), true); err != nil {
		t.Fatal(err)
	}
}

func TestOneWayBasics(t *testing.T) {
	e, r, s, d := setup(t, func(p *config.Pair) { p.Delete = true; p.Ignore = []string{"*.log"} })
	write(t, s, "a.txt", "hello")
	write(t, s, "sub/b.txt", "b")
	write(t, s, "node_modules/x.js", "x")
	write(t, s, "debug.log", "l")
	write(t, s, ".gitignore", "secret.env\n")
	write(t, s, "secret.env", "k=v")
	run(t, e)
	if read(d, "a.txt") != "hello" || read(d, "sub/b.txt") != "b" {
		t.Fatal("files not copied")
	}
	for _, f := range []string{"node_modules/x.js", "debug.log", "secret.env"} {
		if read(d, f) != "<missing>" {
			t.Errorf("%s should be ignored", f)
		}
	}
	// update + delete
	write(t, s, "a.txt", "hello world")
	os.Remove(filepath.Join(s, "sub/b.txt"))
	e.cycle(false, true)
	if read(d, "a.txt") != "hello world" {
		t.Error("update not applied")
	}
	if read(d, "sub/b.txt") != "<missing>" {
		t.Error("delete not applied")
	}
	if _, err := os.Stat(filepath.Join(d, "sub")); err == nil {
		t.Error("empty dir not removed")
	}
	if !r.has(KDelete, "sub/b.txt") {
		t.Error("no delete event")
	}
	// backup of overwritten a.txt exists
	bs, _ := ListBackups(config.DataDir(), e.id, "a.txt")
	if len(bs) != 1 || bs[0].Side != "target" {
		t.Errorf("expected 1 target backup, got %+v", bs)
	}
}

func TestOneWayRename(t *testing.T) {
	e, r, s, d := setup(t, func(p *config.Pair) { p.Delete = true })
	write(t, s, "old/name.txt", "same content here")
	run(t, e)
	os.MkdirAll(filepath.Join(s, "new"), 0o755)
	os.Rename(filepath.Join(s, "old/name.txt"), filepath.Join(s, "new/name2.txt"))
	e.cycle(false, true)
	if !r.has(KRename, "old/name.txt") {
		t.Fatal("expected rename event")
	}
	if read(d, "new/name2.txt") != "same content here" || read(d, "old/name.txt") != "<missing>" {
		t.Fatal("rename not applied")
	}
}

func TestLimits(t *testing.T) {
	e, r, s, d := setup(t, func(p *config.Pair) { p.MaxSize = 10; p.Binary = "skip" })
	write(t, s, "big.txt", "this is more than ten bytes")
	write(t, s, "bin.dat", "a\x00b")
	write(t, s, "ok.txt", "ok")
	run(t, e)
	if read(d, "big.txt") != "<missing>" || read(d, "bin.dat") != "<missing>" || read(d, "ok.txt") != "ok" {
		t.Fatal("limits not applied")
	}
	if !r.has(KSkip, "big.txt") || !r.has(KSkip, "bin.dat") {
		t.Fatal("expected skip events")
	}
}

func TestDryRun(t *testing.T) {
	e, r, s, d := setup(t, func(p *config.Pair) { p.DryRun = true })
	write(t, s, "a.txt", "x")
	run(t, e)
	if read(d, "a.txt") != "<missing>" {
		t.Fatal("dry run wrote a file")
	}
	if !r.has(KAdd, "a.txt") {
		t.Fatal("dry run should still report")
	}
}

func TestMirror(t *testing.T) {
	e, _, s, d := setup(t, nil)
	write(t, s, "keep.txt", "k")
	write(t, d, "keep.txt", "k")
	write(t, d, "extra.txt", "e")
	write(t, d, ".git/HEAD", "ref")
	list, err := e.PlanMirror()
	if err != nil || len(list) != 1 || list[0] != "extra.txt" {
		t.Fatalf("PlanMirror = %v, %v", list, err)
	}
	e.ApproveMirror(list)
	run(t, e)
	if read(d, "extra.txt") != "<missing>" || read(d, ".git/HEAD") != "ref" {
		t.Fatal("mirror wrong")
	}
}

func twoWay(conflict string, del bool) func(*config.Pair) {
	return func(p *config.Pair) { p.Mode = "two-way"; p.Conflict = conflict; p.Delete = del }
}

func TestTwoWayPropagation(t *testing.T) {
	e, _, s, d := setup(t, twoWay("ask", true))
	write(t, s, "a.txt", "from source")
	write(t, d, "b.txt", "from target")
	run(t, e)
	if read(d, "a.txt") != "from source" || read(s, "b.txt") != "from target" {
		t.Fatal("initial two-way copy failed")
	}
	write(t, d, "a.txt", "edited in target")
	e.cycle(false, true)
	if read(s, "a.txt") != "edited in target" {
		t.Fatal("target edit not pulled back")
	}
	os.Remove(filepath.Join(s, "b.txt"))
	e.cycle(false, true)
	if read(d, "b.txt") != "<missing>" {
		t.Fatal("delete not propagated")
	}
}

func TestTwoWayRestore(t *testing.T) {
	e, r, s, d := setup(t, func(p *config.Pair) { p.Mode = "two-way"; p.OnDelete = "restore" })
	write(t, s, "a.txt", "x")
	write(t, s, "r/one.txt", "rename me please")
	run(t, e)
	os.Remove(filepath.Join(d, "a.txt"))
	os.Rename(filepath.Join(s, "r/one.txt"), filepath.Join(s, "r/two.txt"))
	e.cycle(false, true)
	if read(d, "a.txt") != "x" {
		t.Fatal("deleted file should be restored with on_delete: restore")
	}
	if !r.has(KRename, "r/one.txt") || read(d, "r/two.txt") == "<missing>" || read(d, "r/one.txt") != "<missing>" {
		t.Fatal("rename should still propagate with delete=false")
	}
}

func TestConflictAskAndResolve(t *testing.T) {
	e, r, s, d := setup(t, twoWay("ask", true))
	write(t, s, "c.txt", "base")
	run(t, e)
	write(t, s, "c.txt", "source edit")
	write(t, d, "c.txt", "target edit!")
	e.cycle(false, true)
	if !r.has(KConflict, "c.txt") || !e.conflicts["c.txt"] {
		t.Fatal("expected conflict")
	}
	if read(s, "c.txt") != "source edit" || read(d, "c.txt") != "target edit!" {
		t.Fatal("conflict must not touch files")
	}
	title, lines := e.Diff("c.txt", true)
	if !strings.Contains(title, "c.txt") || len(lines) == 0 {
		t.Fatal("expected conflict diff")
	}
	// resolve synchronously (no loop running)
	ops := e.resolveOps("c.txt", UseSource)
	delete(e.conflicts, "c.txt")
	e.apply(ops)
	if read(d, "c.txt") != "source edit" {
		t.Fatal("resolve to source failed")
	}
	e.cycle(false, true)
	if e.conflicts["c.txt"] {
		t.Fatal("conflict should be gone")
	}
}

func TestConflictKeepBoth(t *testing.T) {
	e, _, s, d := setup(t, twoWay("keep-both", true))
	write(t, s, "doc.md", "base")
	run(t, e)
	write(t, s, "doc.md", "source version")
	write(t, d, "doc.md", "target version")
	e.cycle(false, true)
	e.cycle(false, true) // conflict copy propagates
	if read(s, "doc.md") != "target version" || read(d, "doc.md") != "target version" {
		t.Fatal("target version should win the name")
	}
	matches, _ := filepath.Glob(filepath.Join(d, "doc.conflict-source-*.md"))
	if len(matches) != 1 || read(d, filepath.Base(matches[0])) != "source version" {
		t.Fatalf("conflict copy missing in target: %v", matches)
	}
}

func TestConflictNewer(t *testing.T) {
	e, _, s, d := setup(t, twoWay("newer", true))
	write(t, s, "n.txt", "base")
	run(t, e)
	write(t, s, "n.txt", "older")
	write(t, d, "n.txt", "newer!")
	old := time.Now().Add(-time.Hour)
	os.Chtimes(filepath.Join(s, "n.txt"), old, old)
	e.cycle(false, true)
	if read(s, "n.txt") != "newer!" {
		t.Fatal("newer should win")
	}
}

func TestStatePersists(t *testing.T) {
	e, _, s, d := setup(t, twoWay("ask", true))
	write(t, s, "p.txt", "v1")
	run(t, e)
	// second engine with same config: no spurious conflicts, and target edit flows back
	e2 := New(e.cfg, nil)
	write(t, d, "p.txt", "v2 from target")
	if err := e2.Run(context.Background(), true); err != nil {
		t.Fatal(err)
	}
	if len(e2.conflicts) != 0 || read(s, "p.txt") != "v2 from target" {
		t.Fatalf("state not persisted: conflicts=%v src=%q", e2.conflicts, read(s, "p.txt"))
	}
}

func TestExpandMessage(t *testing.T) {
	p := config.Pair{Name: "x", Source: "/a/work", Target: "/b/repo"}
	got := expandMessage("sync {count} from {source}: {files}", p, []string{" M a.go", "?? b.go"})
	if got != "sync 2 from work: a.go, b.go" {
		t.Fatal(got)
	}
}

func TestTwoWayKeep(t *testing.T) {
	e, r, s, d := setup(t, twoWay("ask", false)) // default on_delete: keep
	if e.cfg.OnDelete != "keep" {
		t.Fatalf("default on_delete = %q", e.cfg.OnDelete)
	}
	write(t, s, "a.txt", "x")
	write(t, s, "r/one.txt", "rename me please")
	write(t, s, "edit.txt", "v1")
	run(t, e)

	os.Remove(filepath.Join(s, "a.txt"))
	os.Rename(filepath.Join(s, "r/one.txt"), filepath.Join(s, "r/two.txt"))
	os.Remove(filepath.Join(d, "edit.txt"))
	e.cycle(false, true)
	if read(s, "a.txt") != "<missing>" || read(d, "a.txt") != "x" {
		t.Fatal("keep: source delete should stay deleted, target copy kept")
	}
	if !r.has(KKept, "a.txt") {
		t.Fatal("expected kept event")
	}
	if !r.has(KRename, "r/one.txt") || read(d, "r/two.txt") == "<missing>" || read(d, "r/one.txt") != "<missing>" {
		t.Fatal("rename should propagate under keep")
	}
	// several more cycles: nothing gets resurrected
	e.cycle(false, true)
	e.cycle(false, true)
	if read(s, "a.txt") != "<missing>" || read(d, "edit.txt") != "<missing>" || read(s, "edit.txt") != "v1" {
		t.Fatal("keep: file was resurrected")
	}
	// survives a restart
	e2 := New(e.cfg, nil)
	if err := e2.Run(context.Background(), true); err != nil {
		t.Fatal(err)
	}
	if read(s, "a.txt") != "<missing>" {
		t.Fatal("keep: resurrected after restart")
	}
	// editing the kept copy brings it back
	write(t, d, "a.txt", "edited again in target")
	e2.cycle(false, true)
	if read(s, "a.txt") != "edited again in target" {
		t.Fatal("edited kept copy should be copied back")
	}
	// recreating on the deleted side with the same content just re-links
	write(t, d, "edit.txt", "v1")
	e2.cycle(false, true)
	if len(e2.conflicts) != 0 {
		t.Fatalf("unexpected conflicts %v", e2.conflicts)
	}
	if b := e2.state["edit.txt"]; b.Orphan != 0 || b.Hash == "" {
		t.Fatalf("edit.txt should be a normal synced file again: %+v", b)
	}
}

func TestHoldPersistsAndResolvesFromCLI(t *testing.T) {
	e, r, s, d := setup(t, twoWay("hold", true))
	write(t, s, "c.txt", "base")
	run(t, e)
	write(t, s, "c.txt", "source edit")
	write(t, d, "c.txt", "target edit!")
	e.cycle(false, true)
	if !r.has(KConflict, "c.txt") || !e.conflicts["c.txt"] {
		t.Fatal("expected held conflict")
	}
	e.saveState()

	// another process: listed from saved state
	saved := SavedPairs(config.DataDir())
	if len(saved) != 1 || len(saved[0].Conflicts) != 1 || saved[0].Pair.Source != s {
		t.Fatalf("SavedPairs = %+v", saved)
	}
	if saved[0].PID != 0 {
		t.Fatal("no process should be running")
	}
	// queue + offline apply
	if err := QueueResolve(config.DataDir(), saved[0].ID, "c.txt", UseTarget); err != nil {
		t.Fatal(err)
	}
	if PendingRequests(config.DataDir(), saved[0].ID) != 1 {
		t.Fatal("request not queued")
	}
	r2 := &rec{}
	if err := ResolveOffline(config.DataDir(), saved[0].ID, r2.add); err != nil {
		t.Fatal(err)
	}
	if !r2.has(KResolved, "c.txt") || read(s, "c.txt") != "target edit!" {
		t.Fatal("offline resolve did not apply")
	}
	if PendingRequests(config.DataDir(), saved[0].ID) != 0 || len(SavedPairs(config.DataDir())[0].Conflicts) != 0 {
		t.Fatal("request/conflict not cleared")
	}
	// a fresh engine sees no conflict
	e3 := New(e.cfg, nil)
	if err := e3.Run(context.Background(), true); err != nil {
		t.Fatal(err)
	}
	if len(e3.conflicts) != 0 {
		t.Fatal("conflict came back")
	}
}

func TestHeldConflictReloadedOnStart(t *testing.T) {
	e, _, s, d := setup(t, twoWay("hold", true))
	write(t, s, "c.txt", "base")
	run(t, e)
	write(t, s, "c.txt", "S")
	write(t, d, "c.txt", "TT")
	e.cycle(false, true)
	e.saveState()
	r := &rec{}
	e2 := New(e.cfg, r.add)
	QueueResolve(config.DataDir(), e2.id, "c.txt", KeepBoth)
	if err := e2.Run(context.Background(), true); err != nil {
		t.Fatal(err)
	}
	if !r.has(KConflict, "c.txt") || !r.has(KResolved, "c.txt") {
		t.Fatal("expected reload + resolve on start")
	}
	if read(s, "c.txt") != "TT" || read(d, "c.txt") != "TT" {
		t.Fatal("keep-both should leave target version under the name")
	}
}
