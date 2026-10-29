// Package config loads ferry.yaml and turns CLI flags into pair configs.
package config

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"gopkg.in/yaml.v3"

	"github.com/anupam42/Ferry/internal/remote"
)

// Duration accepts "500ms", "5m", "1h30m", "30d" and "2w" in YAML.
type Duration time.Duration

// ParseDuration is time.ParseDuration plus "d" (days) and "w" (weeks).
func ParseDuration(s string) (time.Duration, error) {
	s = strings.TrimSpace(s)
	if s == "" || s == "0" {
		return 0, nil
	}
	for suf, unit := range map[string]time.Duration{"d": 24 * time.Hour, "w": 7 * 24 * time.Hour} {
		if n, ok := strings.CutSuffix(s, suf); ok {
			if f, err := strconv.ParseFloat(n, 64); err == nil {
				return time.Duration(f * float64(unit)), nil
			}
		}
	}
	return time.ParseDuration(s)
}

func (d *Duration) UnmarshalYAML(n *yaml.Node) error {
	v, err := ParseDuration(n.Value)
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
	Merge            bool   `yaml:"merge"` // two-way: try a three-way merge before calling it a conflict

	Ignore         []string          `yaml:"ignore"`
	UseGitignore   bool              `yaml:"use_gitignore"`
	DefaultIgnores bool              `yaml:"default_ignores"`
	Only           []string          `yaml:"only"` // include globs (gitignore syntax); empty = everything
	Map            map[string]string `yaml:"map"`  // source subfolder -> target subfolder; one pair each

	Branch        string     `yaml:"branch"`
	AutoCommit    AutoCommit `yaml:"auto_commit"`
	GitGuard      bool       `yaml:"git_guard"`      // pause during merge/rebase
	CheckUpstream Duration   `yaml:"check_upstream"` // fetch interval; pause while behind. 0 = off
	AutoPull      bool       `yaml:"auto_pull"`      // with check_upstream: pull --rebase instead of pausing
	PullRebase    bool       `yaml:"pull_rebase"`    // pull --rebase before every push
	BeforeCommit  string     `yaml:"before_commit"`  // command run in the target first; failure skips the commit
	PR            bool       `yaml:"pr"`             // open a pull request after pushing (gh CLI)
	PRBase        string     `yaml:"pr_base"`        // base branch for that pull request
	SignCommits   bool       `yaml:"sign_commits"`   // git commit -S
	CommitAuthor  string     `yaml:"commit_author"`  // "Name <email>" for commits made by ferry
	LFS           bool       `yaml:"lfs"`            // track large/binary files with git LFS instead of skipping them

	MaxSize      Size     `yaml:"max_size"`
	Binary       string   `yaml:"binary"`       // allow | warn | skip
	Secrets      string   `yaml:"secrets"`      // warn | block | off
	SecretAllow  []string `yaml:"secret_allow"` // globs never flagged as secrets
	EOL          string   `yaml:"eol"`          // keep | lf | crlf, for text files written to the target
	Symlinks     string   `yaml:"symlinks"`     // skip | follow | link
	BatchLimit   int      `yaml:"batch_limit"`  // a batch bigger than this is "large"
	BatchAction  string   `yaml:"batch_action"` // apply | confirm
	BatchSettle  Duration `yaml:"batch_settle"` // extra quiet time required for large batches
	MaxOpsPerSec int      `yaml:"max_ops_per_sec"`

	Backups       int      `yaml:"backups"`         // versions kept per file; 0 = off
	BackupMaxAge  Duration `yaml:"backup_max_age"`  // prune versions older than this; 0 = keep
	BackupMaxSize Size     `yaml:"backup_max_size"` // prune oldest versions past this total; 0 = no cap
	Trash         bool     `yaml:"trash"`           // deletions go to the OS trash as well

	Watcher  string   `yaml:"watcher"`  // auto | native | poll
	Interval Duration `yaml:"interval"` // poll interval
	Settle   Duration `yaml:"settle"`   // quiet time before applying changes
	Every    Duration `yaml:"every"`    // sync on a timer instead of watching
	Window   string   `yaml:"window"`   // only sync between these times, e.g. "09:00-18:00"
	Days     []string `yaml:"days"`     // only sync on these days, e.g. [mon-fri]

	Remote string `yaml:"remote,omitempty"` // ssh target; set from target: user@host:path
	DryRun bool   `yaml:"-"`
}

// Webhook posts selected events to a chat or HTTP endpoint.
type Webhook struct {
	URL    string   `yaml:"url"`
	Format string   `yaml:"format"` // auto | slack | discord | ntfy | json
	Events []string `yaml:"events"` // event kinds; default: conflict, error, paused, commit
}

// Settings are the top-level (not per-pair) options of a config file.
type Settings struct {
	Notify     *bool
	Serve      string
	ServeToken string
	Theme      string
	Webhooks   []Webhook
}

// File is the on-disk config.
type File struct {
	Notify     *bool       `yaml:"notify"`
	Serve      string      `yaml:"serve"`       // address for the local HTTP API, e.g. 127.0.0.1:7878
	ServeToken string      `yaml:"serve_token"` // bearer token required by the API
	Theme      string      `yaml:"theme"`       // auto | dark | light | mono
	Webhooks   []Webhook   `yaml:"webhooks"`
	Defaults   yaml.Node   `yaml:"defaults"`
	Pairs      []yaml.Node `yaml:"pairs"`
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
		Secrets:          "warn",
		EOL:              "keep",
		Symlinks:         "skip",
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
	pairs, s, err := LoadFile(path)
	return pairs, s.Notify, err
}

// LoadFile is Load plus the file's top-level settings.
func LoadFile(path string) ([]Pair, Settings, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, Settings{}, err
	}
	var f File
	if err := yaml.Unmarshal(data, &f); err != nil {
		return nil, Settings{}, fmt.Errorf("%s: %w", path, err)
	}
	settings := Settings{Notify: f.Notify, Serve: f.Serve, ServeToken: f.ServeToken, Theme: f.Theme, Webhooks: f.Webhooks}
	for _, w := range f.Webhooks {
		if w.URL == "" {
			return nil, settings, fmt.Errorf("%s: every webhook needs a url", path)
		}
	}
	base := Defaults()
	if f.Defaults.Kind != 0 {
		if err := f.Defaults.Decode(&base); err != nil {
			return nil, settings, fmt.Errorf("%s defaults: %w", path, err)
		}
	}
	if len(f.Pairs) == 0 {
		return nil, settings, fmt.Errorf("%s: no pairs defined", path)
	}
	dir := filepath.Dir(path)
	var pairs []Pair
	for i, n := range f.Pairs {
		p := base
		p.Ignore = nil
		p.Map = nil
		p.Name = ""
		if err := n.Decode(&p); err != nil {
			return nil, settings, fmt.Errorf("%s pair %d: %w", path, i+1, err)
		}
		p.Ignore = append(append([]string{}, base.Ignore...), p.Ignore...)
		for _, ptr := range []*string{&p.Source, &p.Target} {
			if *ptr != "" && !remote.IsSpec(*ptr) && !filepath.IsAbs(expandHome(*ptr)) {
				*ptr = filepath.Join(dir, *ptr)
			}
		}
		pairs = append(pairs, expandMap(p)...)
	}
	for i := range pairs {
		if err := pairs[i].Normalize(); err != nil {
			return nil, settings, err
		}
	}
	if err := CheckOverlaps(pairs); err != nil {
		return nil, settings, err
	}
	return pairs, settings, nil
}

// expandMap turns a pair with `map:` into one pair per mapped subfolder.
func expandMap(p Pair) []Pair {
	if len(p.Map) == 0 {
		return []Pair{p}
	}
	keys := make([]string, 0, len(p.Map))
	for k := range p.Map {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	name := p.Name
	if name == "" {
		name = filepath.Base(p.Source)
	}
	var out []Pair
	for _, k := range keys {
		q := p
		q.Map = nil
		q.Name = name + "/" + strings.Trim(filepath.ToSlash(k), "/")
		q.Source = filepath.Join(p.Source, filepath.FromSlash(k))
		if remote.IsSpec(p.Target) || p.Remote != "" {
			t := p.Target
			if p.Remote != "" {
				t = p.Remote
			}
			q.Target = strings.TrimRight(t, "/") + "/" + strings.Trim(filepath.ToSlash(p.Map[k]), "/")
			q.Remote = ""
		} else {
			q.Target = filepath.Join(p.Target, filepath.FromSlash(p.Map[k]))
		}
		out = append(out, q)
	}
	return out
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
	if p.Source == "" || (p.Target == "" && p.Remote == "") {
		return fmt.Errorf("pair %q: source and target are required", p.Name)
	}
	if remote.IsSpec(p.Target) {
		p.Remote = p.Target
	}
	if p.Remote != "" {
		sp, err := remote.Parse(p.Remote)
		if err != nil {
			return fmt.Errorf("pair %q: %v", p.Name, err)
		}
		p.Remote = sp.String()
		// remote pairs sync into a local shadow copy, which is pushed over ssh
		p.Target = filepath.Join(DataDir(), "remote", shortHash(p.Remote))
	}
	var err error
	if p.Source, err = filepath.Abs(expandHome(p.Source)); err != nil {
		return err
	}
	if p.Target, err = filepath.Abs(expandHome(p.Target)); err != nil {
		return err
	}
	if p.Name == "" {
		dst := filepath.Base(p.Target)
		if p.Remote != "" {
			dst = p.Remote
		}
		p.Name = filepath.Base(p.Source) + " → " + dst
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
	if p.Remote != "" && p.Mode == "two-way" {
		return fmt.Errorf("pair %q: remote (ssh) targets only support one-way mode", p.Name)
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
	// fields added after 1.1 may be empty in older saved configs
	if p.Secrets == "" {
		p.Secrets = "warn"
	}
	if !oneOf(p.Secrets, "warn", "block", "off") {
		return fmt.Errorf("pair %q: secrets must be warn, block or off", p.Name)
	}
	if p.EOL == "" {
		p.EOL = "keep"
	}
	if !oneOf(p.EOL, "keep", "lf", "crlf") {
		return fmt.Errorf("pair %q: eol must be keep, lf or crlf", p.Name)
	}
	if p.Symlinks == "" {
		p.Symlinks = "skip"
	}
	if !oneOf(p.Symlinks, "skip", "follow", "link") {
		return fmt.Errorf("pair %q: symlinks must be skip, follow or link", p.Name)
	}
	if !oneOf(p.Watcher, "auto", "native", "poll") {
		return fmt.Errorf("pair %q: watcher must be auto, native or poll", p.Name)
	}
	if !oneOf(p.BatchAction, "apply", "confirm") {
		return fmt.Errorf("pair %q: batch_action must be apply or confirm", p.Name)
	}
	if p.Window != "" {
		if _, _, err := parseWindow(p.Window); err != nil {
			return fmt.Errorf("pair %q: %v", p.Name, err)
		}
	}
	if len(p.Days) > 0 {
		if _, err := parseDays(p.Days); err != nil {
			return fmt.Errorf("pair %q: %v", p.Name, err)
		}
	}
	if p.Every < 0 {
		p.Every = 0
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

// ---------- sync window ----------

// InWindow reports whether the pair may sync at t (window and days).
func (p *Pair) InWindow(t time.Time) bool {
	if len(p.Days) > 0 {
		if days, err := parseDays(p.Days); err == nil && !days[t.Weekday()] {
			return false
		}
	}
	if p.Window != "" {
		start, end, err := parseWindow(p.Window)
		if err == nil {
			m := t.Hour()*60 + t.Minute()
			if start <= end {
				return m >= start && m < end
			}
			return m >= start || m < end // overnight, e.g. 22:00-06:00
		}
	}
	return true
}

// WindowLabel describes the sync window for messages, e.g. "09:00-18:00 mon-fri".
func (p *Pair) WindowLabel() string {
	parts := []string{}
	if p.Window != "" {
		parts = append(parts, p.Window)
	}
	if len(p.Days) > 0 {
		parts = append(parts, strings.Join(p.Days, ","))
	}
	return strings.Join(parts, " ")
}

func parseWindow(s string) (start, end int, err error) {
	a, b, ok := strings.Cut(strings.ReplaceAll(s, " ", ""), "-")
	if !ok {
		return 0, 0, fmt.Errorf("window %q: expected HH:MM-HH:MM", s)
	}
	ta, err1 := time.Parse("15:04", a)
	tb, err2 := time.Parse("15:04", b)
	if err1 != nil || err2 != nil {
		return 0, 0, fmt.Errorf("window %q: expected HH:MM-HH:MM", s)
	}
	return ta.Hour()*60 + ta.Minute(), tb.Hour()*60 + tb.Minute(), nil
}

var dayNames = map[string]time.Weekday{
	"sun": time.Sunday, "mon": time.Monday, "tue": time.Tuesday, "wed": time.Wednesday,
	"thu": time.Thursday, "fri": time.Friday, "sat": time.Saturday,
}

func parseDays(list []string) ([7]bool, error) {
	var days [7]bool
	day := func(s string) (time.Weekday, error) {
		s = strings.ToLower(strings.TrimSpace(s))
		if len(s) > 3 {
			s = s[:3]
		}
		d, ok := dayNames[s]
		if !ok {
			return 0, fmt.Errorf("unknown day %q (use mon, tue, … or mon-fri)", s)
		}
		return d, nil
	}
	for _, item := range list {
		for _, tok := range strings.Split(item, ",") {
			tok = strings.ToLower(strings.TrimSpace(tok))
			switch tok {
			case "":
				continue
			case "daily", "all", "everyday":
				days = [7]bool{true, true, true, true, true, true, true}
				continue
			case "weekdays":
				tok = "mon-fri"
			case "weekends", "weekend":
				tok = "sat-sun"
			}
			if a, b, ok := strings.Cut(tok, "-"); ok {
				da, err := day(a)
				if err != nil {
					return days, err
				}
				db, err := day(b)
				if err != nil {
					return days, err
				}
				for d := da; ; d = (d + 1) % 7 {
					days[d] = true
					if d == db {
						break
					}
				}
				continue
			}
			d, err := day(tok)
			if err != nil {
				return days, err
			}
			days[d] = true
		}
	}
	return days, nil
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
	return shortHash(strings.ToLower(p.Source) + "|" + strings.ToLower(p.Target))
}

func shortHash(s string) string {
	h := sha256.Sum256([]byte(s))
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
# theme: auto           # dashboard colors: auto | dark | light | mono
# serve: 127.0.0.1:7878 # local HTTP API for editors and scripts (see README)
# webhooks:             # post conflicts, errors, pauses and commits to chat
#   - url: https://hooks.slack.com/services/XXX
#     events: [conflict, error, paused, commit]

defaults:               # applies to every pair below; any key can be overridden per pair
  mode: one-way         # one-way (source -> target) | two-way
  on_delete: keep       # file deleted on one side: keep (leave the other copy alone)
                        #   | restore (two-way: copy it back) | propagate (delete it on the other side too)
  conflict: ask         # two-way, when you can be asked (dashboard / terminal):
                        #   ask | hold | source | target | newer | keep-both
  headless_conflict: hold   # when nobody can be asked (service, --json, piped):
                            #   hold (leave both files, notify, resolve later with "ferry resolve")
                            #   | keep-both | source | target | newer
  merge: false          # two-way: try a three-way merge of text files before calling it a conflict
  use_gitignore: true   # honor .gitignore files in source and target
  ignore: [dist, coverage, "*.log"]
  # only: ["src/**", "docs/**"]   # sync just these paths (gitignore syntax)
  git_guard: true       # pause while the target repo is merging/rebasing
  check_upstream: 0     # e.g. 5m: fetch and pause while target is behind its upstream
  auto_pull: false      # with check_upstream: pull --rebase instead of pausing
  max_size: 50MB        # skip bigger files
  binary: warn          # allow | warn | skip
  lfs: false            # track large or binary files with git LFS instead of skipping them
  secrets: warn         # files that look like credentials: warn | block | off
  secret_allow: []      # globs never flagged as secrets, e.g. ["test/fixtures/**"]
  eol: keep             # line endings of text files written to the target: keep | lf | crlf
  symlinks: skip        # skip | follow (copy what they point to) | link (recreate the link)
  batch_limit: 200      # batches bigger than this wait for activity to settle
  batch_action: apply   # apply | confirm (ask in the dashboard first)
  max_ops_per_sec: 0    # throttle file operations, 0 = unlimited
  backups: 5            # versions kept before overwrite/delete, 0 = off
  backup_max_age: 0     # e.g. 30d: prune older versions
  backup_max_size: 0    # e.g. 1GB: prune the oldest versions past this total
  trash: false          # also send deleted files to the OS trash / recycle bin
  watcher: auto         # auto (native events + safety poll) | native | poll
  every: 0              # e.g. 15m: sync on a timer instead of watching
  # window: "09:00-18:00"   # only sync during these hours
  # days: [mon-fri]         # only sync on these days
  before_commit: ""     # e.g. "npm run lint": must pass before ferry commits
  pull_rebase: false    # pull --rebase before pushing
  pr: false             # open a pull request after pushing (needs the gh CLI)
  sign_commits: false   # git commit -S
  commit_author: ""     # e.g. "Sync Bot <bot@example.com>"
  auto_commit:
    enabled: false
    interval: 10m
    message: "sync: {summary}"   # also {count} {files} {source} {target} {pair} {date} {time} {datetime}
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

  # - name: monorepo
  #   source: ~/scratch
  #   target: ~/code/monorepo
  #   map: {app: packages/app, docs: docs}   # one pair per mapped subfolder

  # - name: server
  #   source: ./site
  #   target: deploy@example.com:/srv/site   # ssh target (one-way)
`
