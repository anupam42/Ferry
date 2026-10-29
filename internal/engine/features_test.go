package engine

import (
	"strings"
	"testing"

	"github.com/anupam42/Ferry/internal/config"
)

func TestOnlyFilter(t *testing.T) {
	e, _, s, d := setup(t, func(p *config.Pair) { p.Only = []string{"src/**", "*.md"} })
	write(t, s, "src/a.go", "a")
	write(t, s, "README.md", "r")
	write(t, s, "other/b.txt", "b")
	run(t, e)
	if read(d, "src/a.go") != "a" || read(d, "README.md") != "r" {
		t.Fatal("included files not copied")
	}
	if read(d, "other/b.txt") != "<missing>" {
		t.Fatal("other/b.txt should be excluded by only")
	}
}

func TestUndoLastBatch(t *testing.T) {
	e, _, s, d := setup(t, nil)
	write(t, s, "a.txt", "v1")
	run(t, e)
	write(t, s, "a.txt", "v2 longer")
	write(t, s, "new.txt", "n")
	e.cycle(false, true)
	if read(d, "a.txt") != "v2 longer" || read(d, "new.txt") != "n" {
		t.Fatal("second sync failed")
	}
	hist := History(config.DataDir(), e.id)
	if len(hist) != 2 {
		t.Fatalf("expected 2 batches, got %d", len(hist))
	}
	done, problems, err := Undo(config.DataDir(), hist[0], 5)
	if err != nil || len(problems) != 0 || len(done) != 2 {
		t.Fatalf("undo: done=%v problems=%v err=%v", done, problems, err)
	}
	if read(d, "a.txt") != "v1" || read(d, "new.txt") != "<missing>" {
		t.Fatal("undo did not restore the target")
	}
	if read(s, "a.txt") != "v2 longer" {
		t.Fatal("undo must not touch the source in one-way mode")
	}
	hist = History(config.DataDir(), e.id)
	if !hist[0].Undone {
		t.Fatal("batch not marked undone")
	}
	if _, _, err := Undo(config.DataDir(), hist[0], 5); err == nil {
		t.Fatal("undoing twice should fail")
	}
}

func TestPlanDoesNotWrite(t *testing.T) {
	e, _, s, d := setup(t, nil)
	write(t, s, "a.txt", "x")
	write(t, d, "b.txt", "old")
	write(t, s, "b.txt", "new!")
	changes, err := e.Plan()
	if err != nil {
		t.Fatal(err)
	}
	kinds := map[string]Kind{}
	for _, c := range changes {
		kinds[c.Path] = c.Kind
	}
	if kinds["a.txt"] != KAdd || kinds["b.txt"] != KUpdate {
		t.Fatalf("plan = %+v", changes)
	}
	if read(d, "a.txt") != "<missing>" || read(d, "b.txt") != "old" {
		t.Fatal("plan wrote files")
	}
}

func TestEOLConversion(t *testing.T) {
	e, _, s, d := setup(t, func(p *config.Pair) { p.EOL = "lf" })
	write(t, s, "a.txt", "one\r\ntwo\r\n")
	run(t, e)
	if got := read(d, "a.txt"); got != "one\ntwo\n" {
		t.Fatalf("got %q", got)
	}
	// after a restart the converted copy counts as up to date
	r := &rec{}
	e2 := New(e.cfg, r.add)
	run(t, e2)
	if r.has(KUpdate, "a.txt") {
		t.Fatal("converted file should count as unchanged")
	}
}

func TestEOLTwoWayStable(t *testing.T) {
	e, r, s, d := setup(t, func(p *config.Pair) { p.Mode = "two-way"; p.EOL = "lf" })
	write(t, s, "a.txt", "x\r\ny\r\n")
	run(t, e)
	e.cycle(false, true)
	e.cycle(false, true)
	if read(s, "a.txt") != "x\r\ny\r\n" || read(d, "a.txt") != "x\ny\n" {
		t.Fatalf("src=%q dst=%q", read(s, "a.txt"), read(d, "a.txt"))
	}
	if len(e.conflicts) != 0 || r.has(KConflict, "") {
		t.Fatal("unexpected conflict")
	}
}

func TestSecretsBlock(t *testing.T) {
	e, r, s, d := setup(t, func(p *config.Pair) {
		p.Secrets = "block"
		p.SecretAllow = []string{"fixtures/**"}
	})
	write(t, s, "config.js", `const key = "AKIAABCDEFGHIJKLMNOP"`)
	write(t, s, "fixtures/fake.js", `const key = "AKIAABCDEFGHIJKLMNOP"`)
	write(t, s, ".env", "X=1")
	write(t, s, "ok.txt", "fine")
	run(t, e)
	if read(d, "config.js") != "<missing>" || read(d, ".env") != "<missing>" {
		t.Fatal("secrets should be blocked")
	}
	if read(d, "fixtures/fake.js") == "<missing>" || read(d, "ok.txt") != "fine" {
		t.Fatal("allowed files should be copied")
	}
	if !r.has(KSkip, "config.js") {
		t.Fatal("expected skip event")
	}
}

func TestSecretDetection(t *testing.T) {
	if secretNameHit("config/.env") == "" || secretNameHit(".env.example") != "" || secretNameHit("keys/server.pem") == "" {
		t.Fatal("file name rules wrong")
	}
	if len(scanSecretContent([]byte("-----BEGIN OPENSSH PRIVATE KEY-----\nabc"))) == 0 {
		t.Fatal("private key not found")
	}
	if len(scanSecretContent([]byte("token: ghp_"+strings.Repeat("a", 36)))) == 0 {
		t.Fatal("github token not found")
	}
	if hits := scanSecretContent([]byte("const answer = 42 // nothing secret")); len(hits) != 0 {
		t.Fatalf("false positive: %v", hits)
	}
}

func TestMergeCleanAndMarkers(t *testing.T) {
	e, _, s, d := setup(t, func(p *config.Pair) { p.Mode = "two-way"; p.Conflict = "hold"; p.Merge = true })
	write(t, s, "m.txt", "a\nb\nc\nd\ne\n")
	run(t, e)
	write(t, s, "m.txt", "a\nB\nc\nd\ne\n")
	write(t, d, "m.txt", "a\nb\nc\nD\ne\n")
	e.cycle(false, true)
	want := "a\nB\nc\nD\ne\n"
	if read(s, "m.txt") != want || read(d, "m.txt") != want {
		t.Fatalf("clean merge failed: src=%q dst=%q", read(s, "m.txt"), read(d, "m.txt"))
	}
	if len(e.conflicts) != 0 {
		t.Fatal("a clean merge should not leave a conflict")
	}
	// overlapping edits are held, then resolved with conflict markers
	write(t, s, "m.txt", "a\nX\nc\nD\ne\n")
	write(t, d, "m.txt", "a\nY\nc\nD\ne\n")
	e.cycle(false, true)
	if !e.conflicts["m.txt"] {
		t.Fatal("overlapping edits should conflict")
	}
	ops := e.resolveOps("m.txt", Merge)
	delete(e.conflicts, "m.txt")
	e.apply(ops)
	got := read(d, "m.txt")
	if !strings.Contains(got, "<<<<<<< target") || !strings.Contains(got, ">>>>>>> source") || read(s, "m.txt") != got {
		t.Fatalf("merge markers missing: %q", got)
	}
}

func TestSummarizeStatus(t *testing.T) {
	got := SummarizeStatus([]string{" M src/api/a.go", " M src/api/b.go", "?? README.md", " D old.txt"})
	if got != "add README.md; update 2 files in src/api; delete old.txt" {
		t.Fatal(got)
	}
}

func TestStatusFileWritten(t *testing.T) {
	e, _, s, _ := setup(t, nil)
	write(t, s, "a.txt", "x")
	run(t, e)
	list := ReadStatuses(config.DataDir())
	if len(list) != 1 || list[0].Running || list[0].Added != 1 || list[0].Name != e.Name() {
		t.Fatalf("statuses = %+v", list)
	}
}

func TestParseChoice(t *testing.T) {
	for in, want := range map[string]Choice{"s": UseSource, "both": KeepBoth, "M": Merge, "newer": UseNewer} {
		if c, ok := ParseChoice(in); !ok || c != want {
			t.Errorf("ParseChoice(%q) = %q, %v", in, c, ok)
		}
	}
	if _, ok := ParseChoice("nope"); ok {
		t.Error("bad choice accepted")
	}
}
