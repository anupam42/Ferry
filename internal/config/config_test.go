package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestLoadMergesDefaults(t *testing.T) {
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "a"), 0o755)
	os.MkdirAll(filepath.Join(dir, "c"), 0o755)
	cfg := filepath.Join(dir, "fs.yaml")
	os.WriteFile(cfg, []byte(`
notify: false
defaults:
  delete: true
  ignore: [dist]
  auto_commit: {enabled: true, interval: 2m}
pairs:
  - {name: one, source: a, target: b}
  - name: two
    source: c
    target: d
    mode: two-way
    delete: false
    ignore: ["*.log"]
    max_size: 1.5KB
    auto_commit: {push: true}
`), 0o644)
	pairs, notify, err := Load(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if notify == nil || *notify {
		t.Error("notify should be false")
	}
	one, two := pairs[0], pairs[1]
	if !one.Delete || two.Delete {
		t.Error("delete override wrong")
	}
	if one.Source != filepath.Join(dir, "a") {
		t.Errorf("relative path not resolved: %s", one.Source)
	}
	if len(two.Ignore) != 2 || two.Ignore[0] != "dist" || two.Ignore[1] != "*.log" {
		t.Errorf("ignores not merged: %v", two.Ignore)
	}
	if two.MaxSize != 1536 || one.MaxSize != 50<<20 {
		t.Errorf("max size: %d %d", one.MaxSize, two.MaxSize)
	}
	if !two.AutoCommit.Enabled || !two.AutoCommit.Push || two.AutoCommit.Interval.D() != 2*time.Minute {
		t.Errorf("nested auto_commit not merged: %+v", two.AutoCommit)
	}
	if two.Mode != "two-way" || one.Mode != "one-way" || !one.UseGitignore {
		t.Error("mode/defaults wrong")
	}
}

func TestRejectsLoops(t *testing.T) {
	dir := t.TempDir()
	p := Defaults()
	p.Source, p.Target = dir, filepath.Join(dir, "inner")
	if err := p.Normalize(); err == nil {
		t.Fatal("expected error for nested folders")
	}
}

func TestParseDurationDays(t *testing.T) {
	for in, want := range map[string]time.Duration{"30d": 720 * time.Hour, "2w": 336 * time.Hour, "90m": 90 * time.Minute, "0": 0} {
		if got, err := ParseDuration(in); err != nil || got != want {
			t.Errorf("ParseDuration(%q) = %v, %v", in, got, err)
		}
	}
}

func TestWindowAndDays(t *testing.T) {
	p := Pair{Window: "09:00-18:00", Days: []string{"mon-fri"}}
	at := func(day, hour int) time.Time { return time.Date(2026, 10, day, hour, 0, 0, 0, time.Local) }
	// 2026-10-26 is a Monday, 2026-10-31 a Saturday
	if !p.InWindow(at(26, 10)) || p.InWindow(at(26, 19)) || p.InWindow(at(31, 10)) {
		t.Error("window/days wrong")
	}
	night := Pair{Window: "22:00-06:00"}
	if !night.InWindow(at(27, 23)) || !night.InWindow(at(27, 5)) || night.InWindow(at(27, 12)) {
		t.Error("overnight window wrong")
	}
	if _, err := parseDays([]string{"funday"}); err == nil {
		t.Error("bad day accepted")
	}
	if _, _, err := parseWindow("9-5"); err == nil {
		t.Error("bad window accepted")
	}
}

func TestMapExpands(t *testing.T) {
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "src", "app"), 0o755)
	os.MkdirAll(filepath.Join(dir, "src", "docs"), 0o755)
	cfg := filepath.Join(dir, "f.yaml")
	os.WriteFile(cfg, []byte(`
pairs:
  - name: mono
    source: src
    target: repo
    map: {app: packages/app, docs: docs}
`), 0o644)
	pairs, _, err := Load(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if len(pairs) != 2 || pairs[0].Name != "mono/app" || pairs[1].Name != "mono/docs" {
		t.Fatalf("pairs = %+v", pairs)
	}
	if pairs[0].Target != filepath.Join(dir, "repo", "packages", "app") || pairs[1].Source != filepath.Join(dir, "src", "docs") {
		t.Fatalf("paths wrong: %s %s", pairs[0].Target, pairs[1].Source)
	}
}

func TestRemoteTarget(t *testing.T) {
	t.Setenv("FERRY_HOME", t.TempDir())
	p := Defaults()
	p.Source, p.Target = t.TempDir(), "deploy@example.com:site"
	if err := p.Normalize(); err != nil {
		t.Fatal(err)
	}
	if p.Remote != "ssh://deploy@example.com/~/site" || !strings.HasPrefix(p.Target, DataDir()) {
		t.Fatalf("remote=%q target=%q", p.Remote, p.Target)
	}
	two := Defaults()
	two.Source, two.Target, two.Mode = t.TempDir(), "deploy@example.com:site", "two-way"
	if err := two.Normalize(); err == nil {
		t.Fatal("two-way remote should be rejected")
	}
}
