// Package config loads ferry.yaml and turns CLI flags into pair configs.
package config

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

// Duration accepts "500ms", "5m", "1h30m" in YAML.
type Duration time.Duration

func (d *Duration) UnmarshalYAML(n *yaml.Node) error {
	if n.Value == "" || n.Value == "0" {
		*d = 0
		return nil
	}
	v, err := time.ParseDuration(n.Value)
	if err != nil {
		return fmt.Errorf("line %d: bad duration %q", n.Line, n.Value)
	}
	*d = Duration(v)
	return nil
}
func (d Duration) MarshalYAML() (any, error) { return time.Duration(d).String(), nil }
func (d Duration) D() time.Duration          { return time.Duration(d) }

// Size accepts "50MB", "1.5GB", "800KB", "1024" in YAML.
type Size int64

func ParseSize(s string) (Size, error) {
	s = strings.TrimSpace(strings.ToUpper(s))
	if s == "" || s == "0" {
		return 0, nil
	}
	mult := int64(1)
	for _, u := range []struct {
		suf string
		m   int64
	}{{"GB", 1 << 30}, {"MB", 1 << 20}, {"KB", 1 << 10}, {"G", 1 << 30}, {"M", 1 << 20}, {"K", 1 << 10}, {"B", 1}} {
		if strings.HasSuffix(s, u.suf) {
			mult = u.m
			s = strings.TrimSpace(strings.TrimSuffix(s, u.suf))
			break
		}
	}
	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return 0, fmt.Errorf("bad size %q", s)
	}
	return Size(f * float64(mult)), nil
}

func (s *Size) UnmarshalYAML(n *yaml.Node) error {
	v, err := ParseSize(n.Value)
	if err != nil {
		return fmt.Errorf("line %d: %v", n.Line, err)
	}
	*s = v
	return nil
}
func (s Size) MarshalYAML() (any, error) { return HumanSize(int64(s)), nil }

func HumanSize(n int64) string {
	switch {
	case n >= 1<<30:
		return strconv.FormatFloat(float64(n)/(1<<30), 'f', -1, 64) + "GB"
	case n >= 1<<20:
		return strconv.FormatFloat(float64(n)/(1<<20), 'f', 1, 64) + "MB"
	case n >= 1<<10:
		return strconv.FormatFloat(float64(n)/(1<<10), 'f', 1, 64) + "KB"
	}
	return strconv.FormatInt(n, 10) + "B"
}

type AutoCommit struct {
	Enabled  bool     `yaml:"enabled"`
	Interval Duration `yaml:"interval"`
	Message  string   `yaml:"message"`
	Push     bool     `yaml:"push"`
}

// Pair is one source→target sync job. Every field can also be set under
// `defaults:` in the YAML file.
type Pair struct {
	Name   string `yaml:"name"`
	Source string `yaml:"source"`
	Target string `yaml:"target"`

	Mode     string `yaml:"mode"`      // one-way | two-way
	Delete   bool   `yaml:"delete"`    // shorthand for on_delete: propagate
	OnDelete string `yaml:"on_delete"` // keep | restore | propagate
	Mirror   bool   `yaml:"mirror"`    // on start, delete target files that aren't in source (asks first)

	// Conflict is used when someone can be asked (dashboard or interactive
	// terminal): ask | hold | source | target | newer | keep-both.
	// HeadlessConflict replaces "ask" when nobody can answer (background
	// service, piped output, --json): hold | keep-both | source | target | newer.
	Conflict         string `yaml:"conflict"`
	HeadlessConflict string `yaml:"headless_conflict"`

	Ignore         []string `yaml:"ignore"`
	UseGitignore   bool     `yaml:"use_gitignore"`
	DefaultIgnores bool     `yaml:"default_ignores"`

	Branch        string     `yaml:"branch"`
	AutoCommit    AutoCommit `yaml:"auto_commit"`
	GitGuard      bool       `yaml:"git_guard"`      // pause during merge/rebase
	CheckUpstream Duration   `yaml:"check_upstream"` // fetch interval; pause while behind. 0 = off

	MaxSize      Size     `yaml:"max_size"`
	Binary       string   `yaml:"binary"`       // allow | warn | skip
	BatchLimit   int      `yaml:"batch_limit"`  // a batch bigger than this is "large"
	BatchAction  string   `yaml:"batch_action"` // apply | confirm
	BatchSettle  Duration `yaml:"batch_settle"` // extra quiet time required for large batches
	MaxOpsPerSec int      `yaml:"max_ops_per_sec"`
	Backups      int      `yaml:"backups"` // versions kept per file; 0 = off

	Watcher  string   `yaml:"watcher"`  // auto | native | poll
	Interval Duration `yaml:"interval"` // poll interval
	Settle   Duration `yaml:"settle"`   // quiet time before applying changes
	DryRun   bool     `yaml:"-"`
}

// File is the on-disk config.
type File struct {
	Notify   *bool       `yaml:"notify"`
	Defaults yaml.Node   `yaml:"defaults"`
	Pairs    []yaml.Node `yaml:"pairs"`
}

// Defaults returns the built-in defaults.
func Defaults() Pair {
	return Pair{
		Mode:             "one-way",
		Conflict:         "ask",
		HeadlessConflict: "hold",
		UseGitignore:     true,
		DefaultIgnores:   true,
		GitGuard:         true,
		MaxSize:          50 << 20,
		Binary:           "warn",
		BatchLimit:       200,
		BatchAction:      "apply",
		BatchSettle:      Duration(3 * time.Second),
		Backups:          5,
		Watcher:          "auto",
		Interval:         Duration(500 * time.Millisecond),
		Settle:           Duration(300 * time.Millisecond),
		AutoCommit:       AutoCommit{Interval: Duration(10 * time.Minute), Message: "sync: {count} file(s) from {source} at {datetime}"},
	}
}

// Load reads a YAML config. Relative source/target paths are resolved
// against the config file's directory.
func Load(path string) ([]Pair, *bool, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, nil, err
	}
	var f File
	if err := yaml.Unmarshal(data, &f); err != nil {
		return nil, nil, fmt.Errorf("%s: %w", path, err)
	}
	base := Defaults()
	if f.Defaults.Kind != 0 {
		if err := f.Defaults.Decode(&base); err != nil {
			return nil, nil, fmt.Errorf("%s defaults: %w", path, err)
		}
	}
	if len(f.Pairs) == 0 {
		return nil, nil, fmt.Errorf("%s: no pairs defined", path)
	}
	dir := filepath.Dir(path)
	var pairs []Pair
	for i, n := range f.Pairs {
		p := base
		p.Ignore = nil
		p.Name = ""
		if err := n.Decode(&p); err != nil {
			return nil, nil, fmt.Errorf("%s pair %d: %w", path, i+1, err)
		}
		p.Ignore = append(append([]string{}, base.Ignore...), p.Ignore...)
		for _, ptr := range []*string{&p.Source, &p.Target} {
			if *ptr != "" && !filepath.IsAbs(expandHome(*ptr)) {
				*ptr = filepath.Join(dir, *ptr)
			}
		}
		pairs = append(pairs, p)
	}
	for i := range pairs {
		if err := pairs[i].Normalize(); err != nil {
			return nil, nil, err
		}
	}
	if err := CheckOverlaps(pairs); err != nil {
		return nil, nil, err
	}
	return pairs, f.Notify, nil
}

func expandHome(p string) string {
	if strings.HasPrefix(p, "~/") || strings.HasPrefix(p, `~\`) || p == "~" {
		if h, err := os.UserHomeDir(); err == nil {
			return filepath.Join(h, p[1:])
		}
	}
	return p
}

// Normalize validates a pair and makes paths absolute.
func (p *Pair) Normalize() error {
	if p.Source == "" || p.Target == "" {
		return fmt.Errorf("pair %q: source and target are required", p.Name)
	}
	var err error
	if p.Source, err = filepath.Abs(expandHome(p.Source)); err != nil {
		return err
	}
	if p.Target, err = filepath.Abs(expandHome(p.Target)); err != nil {
		return err
	}
	if p.Name == "" {
		p.Name = filepath.Base(p.Source) + " → " + filepath.Base(p.Target)
	}
	if st, err := os.Stat(p.Source); err != nil || !st.IsDir() {
		return fmt.Errorf("pair %q: source %q is not a folder", p.Name, p.Source)
	}
	if samePath(p.Source, p.Target) {
		return fmt.Errorf("pair %q: source and target are the same folder", p.Name)
	}
	if inside(p.Target, p.Source) || inside(p.Source, p.Target) {
		return fmt.Errorf("pair %q: one folder is inside the other; that would loop forever", p.Name)
	}
	switch p.Mode {
	case "", "one-way", "oneway":
		p.Mode = "one-way"
	case "two-way", "twoway", "bidirectional":
		p.Mode = "two-way"
	default:
		return fmt.Errorf("pair %q: mode must be one-way or two-way", p.Name)
	}
	if !oneOf(p.Conflict, "ask", "hold", "source", "target", "newer", "keep-both") {
		return fmt.Errorf("pair %q: conflict must be ask, hold, source, target, newer or keep-both", p.Name)
	}
	if p.HeadlessConflict == "" {
		p.HeadlessConflict = "hold"
	}
	if !oneOf(p.HeadlessConflict, "hold", "source", "target", "newer", "keep-both") {
		return fmt.Errorf("pair %q: headless_conflict must be hold, source, target, newer or keep-both", p.Name)
	}
	// on_delete wins; the older delete: true is shorthand for propagate
	if p.OnDelete == "" {
		if p.Delete {
			p.OnDelete = "propagate"
		} else {
			p.OnDelete = "keep"
		}
	}
	if !oneOf(p.OnDelete, "keep", "restore", "propagate") {
		return fmt.Errorf("pair %q: on_delete must be keep, restore or propagate", p.Name)
	}
	if p.OnDelete == "restore" && p.Mode == "one-way" {
		return fmt.Errorf("pair %q: on_delete: restore only applies to two-way mode", p.Name)
	}
	p.Delete = p.OnDelete == "propagate"
	if !oneOf(p.Binary, "allow", "warn", "skip") {
		return fmt.Errorf("pair %q: binary must be allow, warn or skip", p.Name)
	}
	if !oneOf(p.Watcher, "auto", "native", "poll") {
		return fmt.Errorf("pair %q: watcher must be auto, native or poll", p.Name)
	}
	if !oneOf(p.BatchAction, "apply", "confirm") {
		return fmt.Errorf("pair %q: batch_action must be apply or confirm", p.Name)
	}
	if p.Interval <= 0 {
		p.Interval = Duration(500 * time.Millisecond)
	}
	if p.AutoCommit.Interval <= 0 {
		p.AutoCommit.Interval = Duration(10 * time.Minute)
	}
	if p.AutoCommit.Message == "" {
		p.AutoCommit.Message = Defaults().AutoCommit.Message
	}
	return nil
}

// CheckOverlaps rejects configs where one pair writes into another pair's folders in a loop.
func CheckOverlaps(pairs []Pair) error {
	for i := range pairs {
		for j := range pairs {
			if i == j {
				continue
			}
			if pairs[i].Name == pairs[j].Name {
				return fmt.Errorf("two pairs are named %q; names must be unique", pairs[i].Name)
			}
			if samePath(pairs[i].Target, pairs[j].Target) {
				return fmt.Errorf("pairs %q and %q write to the same target", pairs[i].Name, pairs[j].Name)
			}
		}
	}
	return nil
}

// ID is a stable identifier for a pair, used for state and backup folders.
func (p *Pair) ID() string {
	h := sha256.Sum256([]byte(strings.ToLower(p.Source) + "|" + strings.ToLower(p.Target)))
	return hex.EncodeToString(h[:6])
}

func oneOf(v string, opts ...string) bool {
	for _, o := range opts {
		if v == o {
			return true
		}
	}
	return false
}

func samePath(a, b string) bool {
	return strings.EqualFold(filepath.Clean(a), filepath.Clean(b))
}

func inside(child, parent string) bool {
	rel, err := filepath.Rel(parent, child)
	return err == nil && rel != "." && !strings.HasPrefix(rel, "..")
}

// DataDir is where state, backups and logs live (outside both folders).
func DataDir() string {
	if d := os.Getenv("FERRY_HOME"); d != "" {
		return d
	}
	if d, err := os.UserCacheDir(); err == nil {
		return filepath.Join(d, "ferry")
	}
	return filepath.Join(os.TempDir(), "ferry")
}

// Sample is written by `ferry init`.
const Sample = `# ferry configuration
# Run with:  ferry --config ferry.yaml   (or just "ferry" in this folder)

notify: true            # desktop notifications on conflicts and errors

defaults:               # applies to every pair below; any key can be overridden per pair
  mode: one-way         # one-way (source -> target) | two-way
  on_delete: keep       # file deleted on one side: keep (leave the other copy alone)
                        #   | restore (two-way: copy it back) | propagate (delete it on the other side too)
  conflict: ask         # two-way, when you can be asked (dashboard / terminal):
                        #   ask | hold | source | target | newer | keep-both
  headless_conflict: hold   # when nobody can be asked (service, --json, piped):
                            #   hold (leave both files, notify, resolve later with "ferry resolve")
                            #   | keep-both | source | target | newer
  use_gitignore: true   # honor .gitignore files in source and target
  ignore: [dist, coverage, "*.log"]
  git_guard: true       # pause while the target repo is merging/rebasing
  check_upstream: 0     # e.g. 5m: fetch and pause while target is behind its upstream
  max_size: 50MB        # skip bigger files
  binary: warn          # allow | warn | skip
  batch_limit: 200      # batches bigger than this wait for activity to settle
  batch_action: apply   # apply | confirm (ask in the dashboard first)
  max_ops_per_sec: 0    # throttle file operations, 0 = unlimited
  backups: 5            # versions kept before overwrite/delete, 0 = off
  watcher: auto         # auto (native events + safety poll) | native | poll
  auto_commit:
    enabled: false
    interval: 10m
    message: "sync: {count} file(s) from {source} at {datetime}"
    push: false

pairs:
  - name: web-app
    source: ~/scratch/web-app
    target: ~/code/web-app
    branch: feature/sync      # optional: switch/create this branch in the target first

  - name: notes
    source: ./notes-draft
    target: ./notes-repo
    mode: two-way
    on_delete: propagate
`
