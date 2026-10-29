package config

import (
	"os"
	"path/filepath"
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
