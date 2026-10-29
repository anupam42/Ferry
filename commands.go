package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	"golang.org/x/term"

	"github.com/anupam42/Ferry/internal/config"
	"github.com/anupam42/Ferry/internal/difftext"
	"github.com/anupam42/Ferry/internal/engine"
	"github.com/anupam42/Ferry/internal/gitx"
	"github.com/anupam42/Ferry/internal/remote"
	"github.com/anupam42/Ferry/internal/service"
)

// ---------- status ----------

func cmdStatus(args []string) error {
	fs := flag.NewFlagSet("status", flag.ContinueOnError)
	asJSON := fs.Bool("json", false, "print JSON")
	running := fs.Bool("running", false, "only pairs that are running now")
	if _, err := parseInterspersed(fs, args); err != nil {
		return exitErr(2)
	}
	var list []engine.PairStatus
	for _, s := range engine.ReadStatuses(config.DataDir()) {
		if !*running || s.Running {
			list = append(list, s)
		}
	}
	if *asJSON {
		if list == nil {
			list = []engine.PairStatus{}
		}
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		return enc.Encode(list)
	}
	if len(list) == 0 {
		fmt.Println("no pairs have run yet (start one with: ferry <source> <target>)")
		return nil
	}
	for _, s := range list {
		icon := paint("90", "○")
		switch {
		case !s.Running:
		case len(s.Conflicts) > 0:
			icon = paint("1;31", "!")
		case s.Paused || s.PendingBatch > 0:
			icon = paint("33", "‖")
		default:
			icon = paint("32", "●")
		}
		arrow, target := "→", s.Target
		if s.Mode == "two-way" {
			arrow = "⇄"
		}
		if s.Remote != "" {
			target = s.Remote
		}
		fmt.Printf("%s %s  %s %s %s\n", icon, paint("1", s.Name), s.Source, arrow, target)
		var parts []string
		if s.Running {
			parts = append(parts, s.State, fmt.Sprintf("pid %d", s.PID))
		} else {
			parts = append(parts, s.State, "last seen "+ago(s.UpdatedAt))
		}
		if !s.LastSync.IsZero() {
			parts = append(parts, "last sync "+ago(s.LastSync))
		}
		parts = append(parts, fmt.Sprintf("+%d ~%d -%d ↻%d", s.Added, s.Updated, s.Deleted, s.Renamed))
		if s.Failed > 0 {
			parts = append(parts, paint("31", fmt.Sprintf("%d failed", s.Failed)))
		}
		fmt.Println("    " + paint("90", strings.Join(parts, " · ")))
		if s.IsGit {
			g := fmt.Sprintf("git ⎇ %s · %d uncommitted", orDash(s.Branch), s.Uncommitted)
			if s.Staged > 0 {
				g += fmt.Sprintf(" · %d staged", s.Staged)
			}
			fmt.Println("    " + paint("90", g))
		}
		for _, c := range s.Conflicts {
			fmt.Println("    " + paint("1;31", "! ") + c)
		}
	}
	return nil
}

func orDash(s string) string {
	if s == "" {
		return "–"
	}
	return s
}

func ago(t time.Time) string {
	if t.IsZero() {
		return "never"
	}
	d := time.Since(t)
	switch {
	case d < time.Minute:
		return "just now"
	case d < time.Hour:
		return fmt.Sprintf("%dm ago", int(d.Minutes()))
	case d < 24*time.Hour:
		return fmt.Sprintf("%dh ago", int(d.Hours()))
	}
	return t.Format("2006-01-02 15:04")
}

// ---------- plan ----------

func cmdPlan(args []string) error {
	f := newRunFlags()
	format := f.fs.String("format", "text", "text | markdown | json")
	withDiff := f.fs.Bool("diff", false, "include a diff for every changed file")
	f.fs.Usage = func() {
		fmt.Fprintln(os.Stderr, "Usage: ferry plan [--diff] [--format text|markdown|json] [run flags] <source> <target> | --config file")
		f.fs.PrintDefaults()
	}
	pos, err := parseInterspersed(f.fs, args)
	if err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return nil
		}
		return exitErr(2)
	}
	pairs, _, err := loadPairs(f, pos)
	if err != nil {
		return err
	}
	type pairPlan struct {
		Pair    string          `json:"pair"`
		Source  string          `json:"source"`
		Target  string          `json:"target"`
		Mode    string          `json:"mode"`
		Changes []engine.Change `json:"changes"`
		Diffs   map[string]string `json:"diffs,omitempty"`
	}
	var plans []pairPlan
	total := 0
	for _, p := range pairs {
		e := engine.New(p, nil)
		changes, err := e.Plan()
		if err != nil {
			return fmt.Errorf("%s: %w", p.Name, err)
		}
		target := p.Target
		if p.Remote != "" {
			target = p.Remote
		}
		pp := pairPlan{Pair: p.Name, Source: p.Source, Target: target, Mode: p.Mode, Changes: changes}
		if changes == nil {
			pp.Changes = []engine.Change{}
		}
		if *withDiff {
			pp.Diffs = map[string]string{}
			for _, c := range changes {
				if d := planDiff(e, c); d != "" {
					pp.Diffs[c.Path] = d
				}
			}
		}
		total += len(changes)
		plans = append(plans, pp)
	}

	switch *format {
	case "json":
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		return enc.Encode(plans)
	case "markdown", "md":
		fmt.Println("# Ferry plan")
		fmt.Printf("\n_%s · %d change(s)_\n", time.Now().Format("2006-01-02 15:04"), total)
		for _, pp := range plans {
			fmt.Printf("\n## %s\n\n`%s` %s `%s` (%s)\n\n", pp.Pair, pp.Source, modeArrow(pp.Mode), pp.Target, pp.Mode)
			if len(pp.Changes) == 0 {
				fmt.Println("Nothing to do.")
				continue
			}
			fmt.Println("| Change | File | Direction | Note |")
			fmt.Println("|---|---|---|---|")
			for _, c := range pp.Changes {
				file := "`" + c.Path + "`"
				if c.To != "" {
					file += " → `" + c.To + "`"
				}
				fmt.Printf("| %s | %s | %s | %s |\n", c.Kind, file, c.Dir, c.Note)
			}
			for _, c := range pp.Changes {
				if d := pp.Diffs[c.Path]; d != "" {
					fmt.Printf("\n<details><summary><code>%s</code></summary>\n\n```diff\n%s```\n\n</details>\n", c.Path, d)
				}
			}
		}
	default:
		for _, pp := range plans {
			fmt.Printf("%s  %s %s %s\n", paint("1", pp.Pair), pp.Source, modeArrow(pp.Mode), pp.Target)
			if len(pp.Changes) == 0 {
				fmt.Println(paint("90", "  nothing to do"))
				continue
			}
			for _, c := range pp.Changes {
				sym, code := planSymbol(c.Kind)
				line := "  " + paint(code, sym) + " "
				if c.Dir != "" {
					line += paint("90", c.Dir) + " "
				}
				line += c.Path
				if c.To != "" {
					line += " → " + c.To
				}
				if c.Note != "" {
					line += paint("90", "  "+c.Note)
				}
				fmt.Println(line)
				if d := pp.Diffs[c.Path]; d != "" {
					for _, l := range strings.Split(strings.TrimRight(d, "\n"), "\n") {
						switch {
						case strings.HasPrefix(l, "+"):
							l = paint("32", l)
						case strings.HasPrefix(l, "-"):
							l = paint("31", l)
						case strings.HasPrefix(l, "@@"):
							l = paint("36", l)
						}
						fmt.Println("      " + l)
					}
				}
			}
		}
		fmt.Println(paint("90", fmt.Sprintf("%d change(s); nothing was written", total)))
	}
	return nil
}

func modeArrow(mode string) string {
	if mode == "two-way" {
		return "⇄"
	}
	return "→"
}

func planSymbol(k engine.Kind) (string, string) {
	switch k {
	case engine.KAdd:
		return "+", "32"
	case engine.KDelete:
		return "-", "31"
	case engine.KRename:
		return "↻", "35"
	case engine.KConflict:
		return "!", "1;31"
	case engine.KKept:
		return "◇", "34"
	}
	return "~", "33"
}

// planDiff renders the diff a planned change would cause, as unified text.
func planDiff(e *engine.Engine, c engine.Change) string {
	read := func(p string) []byte { b, _ := os.ReadFile(p); return b }
	src, dst := e.SourcePath(c.Path), e.TargetPath(c.Path)
	var a, b []byte
	switch {
	case c.Kind == engine.KAdd && c.Dir == "←":
		a, b = nil, read(dst)
	case c.Kind == engine.KAdd:
		a, b = nil, read(src)
	case c.Kind == engine.KDelete && c.Dir == "←":
		a, b = read(src), nil
	case c.Kind == engine.KDelete:
		a, b = read(dst), nil
	case c.Kind == engine.KUpdate && c.Dir == "←":
		a, b = read(src), read(dst)
	case c.Kind == engine.KUpdate, c.Kind == engine.KConflict:
		a, b = read(dst), read(src)
	default:
		return ""
	}
	var sb strings.Builder
	for _, l := range difftext.Diff(a, b, 3) {
		if l.Op == '@' {
			sb.WriteString(l.Text + "\n")
		} else {
			sb.WriteString(string(l.Op) + l.Text + "\n")
		}
	}
	return sb.String()
}

// ---------- history / undo ----------

func pickBatches(pairName string) []engine.Batch {
	var out []engine.Batch
	for _, b := range engine.AllHistory(config.DataDir()) {
		if pairName == "" || b.Pair == pairName {
			out = append(out, b)
		}
	}
	return out
}

func cmdHistory(args []string) error {
	fs := flag.NewFlagSet("history", flag.ContinueOnError)
	pairName := fs.String("pair", "", "only this pair")
	n := fs.Int("n", 20, "how many batches to show")
	asJSON := fs.Bool("json", false, "print JSON")
	if _, err := parseInterspersed(fs, args); err != nil {
		return exitErr(2)
	}
	list := pickBatches(*pairName)
	if len(list) > *n {
		list = list[:*n]
	}
	if *asJSON {
		if list == nil {
			list = []engine.Batch{}
		}
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		return enc.Encode(list)
	}
	if len(list) == 0 {
		fmt.Println("no sync batches recorded yet")
		return nil
	}
	for _, b := range list {
		a, u, d, r := b.Counts()
		head := fmt.Sprintf("%s  %s  +%d ~%d -%d ↻%d", b.Time.Format("2006-01-02 15:04:05"), paint("1", b.Pair), a, u, d, r)
		if b.Undone {
			head += paint("90", "  (undone)")
		}
		fmt.Println(head + paint("90", "  id "+b.ID))
		for i, en := range b.Entries {
			if i == 5 {
				fmt.Println(paint("90", fmt.Sprintf("     … %d more", len(b.Entries)-5)))
				break
			}
			line := "     " + en.Op + " " + en.Path
			if en.To != "" {
				line += " → " + en.To
			}
			fmt.Println(line + paint("90", " ("+en.Side+")"))
		}
	}
	fmt.Println(paint("90", "\nundo the newest with: ferry undo   (or ferry undo --batch ID)"))
	return nil
}

func cmdUndo(args []string) error {
	fs := flag.NewFlagSet("undo", flag.ContinueOnError)
	pairName := fs.String("pair", "", "only this pair")
	batchID := fs.String("batch", "", "undo this batch (see ferry history) instead of the newest")
	yes := fs.Bool("yes", false, "don't ask for confirmation")
	if _, err := parseInterspersed(fs, args); err != nil {
		return exitErr(2)
	}
	var target *engine.Batch
	for _, b := range pickBatches(*pairName) {
		if (*batchID == "" && !b.Undone) || b.ID == *batchID {
			b := b
			target = &b
			break
		}
	}
	if target == nil {
		if *batchID != "" {
			return fmt.Errorf("no batch %s (see: ferry history)", *batchID)
		}
		fmt.Println("nothing to undo")
		return nil
	}
	a, u, d, r := target.Counts()
	fmt.Printf("%s batch from %s in %s: +%d ~%d -%d ↻%d\n", paint("1", "undo"), target.Time.Format("2006-01-02 15:04:05"), target.Pair, a, u, d, r)
	for i, en := range target.Entries {
		if i == 20 {
			fmt.Printf("   … and %d more\n", len(target.Entries)-20)
			break
		}
		fmt.Printf("   %s %s %s\n", undoVerb(en.Op), en.Path, paint("90", "("+en.Side+")"))
	}
	if !*yes {
		if !term.IsTerminal(int(os.Stdin.Fd())) {
			return errors.New("re-run with --yes to confirm")
		}
		if !confirm("Undo these changes? (current versions are backed up first) [y/N] ") {
			fmt.Println("nothing changed")
			return nil
		}
	}
	done, problems, err := engine.Undo(config.DataDir(), *target, 5)
	if err != nil {
		return err
	}
	fmt.Printf("%s reverted %d change(s)\n", paint("32", "✓"), len(done))
	for _, p := range problems {
		fmt.Println(paint("33", "  ! ") + p)
	}
	fmt.Println(paint("90", "  In two-way mode the reverted files sync back to the other side. In one-way mode the source keeps your edits; they are copied again only if the file changes or on a full resync."))
	return nil
}

func undoVerb(op string) string {
	switch op {
	case "add":
		return "remove"
	case "rename":
		return "rename back"
	}
	return "restore"
}

// ---------- doctor ----------

func cmdDoctor(args []string) error {
	f := newRunFlags()
	pos, err := parseInterspersed(f.fs, args)
	if err != nil {
		return exitErr(2)
	}
	fails, warns := 0, 0
	ok := func(msg string) { fmt.Println(paint("32", "  ✓ ") + msg) }
	warn := func(msg, fix string) {
		warns++
		fmt.Println(paint("33", "  ! ") + msg)
		if fix != "" {
			fmt.Println(paint("90", "      → "+fix))
		}
	}
	fail := func(msg, fix string) {
		fails++
		fmt.Println(paint("31", "  ✗ ") + msg)
		if fix != "" {
			fmt.Println(paint("90", "      → "+fix))
		}
	}
	have := func(name string) bool { _, err := exec.LookPath(name); return err == nil }

	fmt.Println(paint("1", "ferry "+version) + paint("90", " on "+runtime.GOOS+"/"+runtime.GOARCH))
	fmt.Println(paint("1", "\nTools"))
	if gitx.Available() {
		ok(gitx.Version())
		name, email := gitx.ConfigGet(".", "user.name"), gitx.ConfigGet(".", "user.email")
		if name == "" || email == "" {
			warn("git user.name / user.email are not set; commits will fail", `git config --global user.name "You" && git config --global user.email you@example.com`)
		} else {
			ok("git identity: " + name + " <" + email + ">")
		}
		if gitx.LFSAvailable(".") {
			ok("git-lfs installed (lfs: true works)")
		} else {
			fmt.Println(paint("90", "  · git-lfs not installed (only needed for lfs: true)"))
		}
	} else {
		fail("git is not on PATH; git features (commit, branch, guard, diff vs HEAD) are off", "install git from https://git-scm.com")
	}
	if have("gh") {
		ok("gh CLI installed (pr: true works)")
	} else {
		fmt.Println(paint("90", "  · gh CLI not installed (only needed for pr: true)"))
	}
	if have("ssh") {
		ok("ssh installed (remote targets work)")
	} else {
		fmt.Println(paint("90", "  · ssh not installed (only needed for user@host:path targets)"))
	}
	switch runtime.GOOS {
	case "linux":
		if have("notify-send") {
			ok("desktop notifications via notify-send")
		} else {
			warn("notify-send not found; desktop notifications are off", "install libnotify-bin (Debian/Ubuntu) or libnotify (Fedora/Arch)")
		}
	case "darwin":
		ok("desktop notifications via osascript")
	case "windows":
		if have("powershell") {
			ok("desktop notifications via PowerShell toasts")
		} else {
			warn("powershell not found; desktop notifications are off", "")
		}
	}

	fmt.Println(paint("1", "\nData folder"))
	dd := config.DataDir()
	if err := os.MkdirAll(dd, 0o755); err != nil {
		fail("can't create "+dd+": "+err.Error(), "set FERRY_HOME to a writable folder")
	} else if tmp, err := os.CreateTemp(dd, "doctor-*"); err != nil {
		fail(dd+" is not writable: "+err.Error(), "set FERRY_HOME to a writable folder")
	} else {
		tmp.Close()
		os.Remove(tmp.Name())
		ok(dd)
	}
	held := 0
	for _, sp := range engine.SavedPairs(dd) {
		held += len(sp.Conflicts)
	}
	if held > 0 {
		warn(fmt.Sprintf("%d conflict(s) waiting for a decision", held), "ferry conflicts")
	}

	fmt.Println(paint("1", "\nBackground service"))
	if service.IsInstalled() {
		ok("installed — " + firstLineOf(service.Status()))
	} else {
		fmt.Println(paint("90", "  · not installed (ferry service install --config ferry.yaml)"))
	}

	fmt.Println(paint("1", "\nPairs"))
	var pairs []config.Pair
	if f.configPath != "" || len(pos) > 0 {
		pairs, _, err = loadPairs(f, pos)
	} else if _, statErr := os.Stat("ferry.yaml"); statErr == nil {
		f.configPath = "ferry.yaml"
		pairs, _, err = loadPairs(f, nil)
	} else {
		fmt.Println(paint("90", "  · no ferry.yaml here; pass --config FILE or <source> <target> to check pairs"))
	}
	if err != nil {
		fail("config: "+err.Error(), "fix the config, or run ferry init for a commented example")
	}
	for _, p := range pairs {
		fmt.Println("  " + paint("1", p.Name))
		doctorPair(p, ok, warn, fail)
	}

	fmt.Println()
	switch {
	case fails > 0:
		fmt.Println(paint("31", fmt.Sprintf("%d problem(s), %d warning(s)", fails, warns)))
		return exitErr(1)
	case warns > 0:
		fmt.Println(paint("33", fmt.Sprintf("no problems, %d warning(s)", warns)))
	default:
		fmt.Println(paint("32", "all good"))
	}
	return nil
}

func doctorPair(p config.Pair, ok func(string), warn, fail func(string, string)) {
	ind := func(s string) string { return "  " + s }
	if p.Remote != "" {
		sp, err := remote.Parse(p.Remote)
		if err != nil {
			fail(ind(err.Error()), "")
			return
		}
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		out, err := sp.Run(ctx, "mkdir -p "+sp.Dir()+" && test -w "+sp.Dir()+" && command -v tar", nil)
		cancel()
		if err != nil {
			fail(ind("can't reach "+p.Remote+": "+firstLineOf(strings.TrimSpace(out+" "+err.Error()))), "check that `ssh "+sp.Host+"` works without a password prompt (ssh keys or agent)")
		} else {
			ok(ind("ssh to " + sp.Host + " works and the folder is writable"))
		}
		if gitx.IsRepo(p.Remote) {
			ok(ind("remote target is a git repo"))
		}
	} else {
		if _, err := os.Stat(p.Target); err != nil {
			warn(ind("target "+p.Target+" doesn't exist yet"), "it will be created on the first run")
		} else if gitx.IsRepo(p.Target) {
			ok(ind("target is a git repo (branch " + orDash(gitx.CurrentBranch(p.Target)) + ")"))
			if r := gitx.InProgress(p.Target); r != "" {
				warn(ind("target has a "+r+"; ferry pauses until it's finished"), "finish or abort it in the target repo")
			}
		} else {
			warn(ind("target is not a git repo; commit features are off"), "git init "+p.Target)
		}
	}
	if p.Every > 0 {
		ok(ind("syncs every " + p.Every.D().String() + " (no file watcher)"))
	} else {
		roots := []string{p.Source}
		if p.Mode == "two-way" {
			roots = append(roots, p.Target)
		}
		for _, r := range roots {
			if _, err := os.Stat(r); err != nil {
				continue
			}
			dirs, err := engine.ProbeWatcher(r)
			switch {
			case err != nil:
				warn(ind("native file events unavailable for "+r+" ("+err.Error()+"); ferry will poll"), watcherFix(err))
			case strings.HasPrefix(filepath.ToSlash(r), "/mnt/") && os.Getenv("WSL_DISTRO_NAME") != "":
				warn(ind(r+" is a Windows drive inside WSL; native events don't arrive there"), "use --watcher poll, or keep the folder inside the Linux filesystem")
			default:
				ok(ind(fmt.Sprintf("native file events work for %s (%d folders)", r, dirs)))
				if limit := inotifyLimit(); limit > 0 && dirs > limit*8/10 {
					warn(ind(fmt.Sprintf("%d folders is close to the inotify limit of %d", dirs, limit)), "sudo sysctl fs.inotify.max_user_watches=524288")
				}
			}
		}
	}
	if p.Window != "" || len(p.Days) > 0 {
		state := "inside it now"
		if !p.InWindow(time.Now()) {
			state = "outside it now, so syncing is paused"
		}
		ok(ind("sync window " + p.WindowLabel() + " — " + state))
	}
	if p.Secrets == "off" {
		warn(ind("secret scanning is off"), "secrets: warn (or block)")
	}
	if p.LFS && !gitx.LFSAvailable(".") {
		warn(ind("lfs: true but git-lfs is not installed"), "https://git-lfs.com")
	}
	if p.PR {
		if _, err := exec.LookPath("gh"); err != nil {
			warn(ind("pr: true but the gh CLI is not installed"), "https://cli.github.com")
		}
	}
}

func watcherFix(err error) string {
	if strings.Contains(err.Error(), "too many") || strings.Contains(err.Error(), "no space") {
		return "raise the limit: sudo sysctl fs.inotify.max_user_watches=524288"
	}
	return "network drives and some containers don't send events; polling works everywhere"
}

func inotifyLimit() int {
	if runtime.GOOS != "linux" {
		return 0
	}
	b, err := os.ReadFile("/proc/sys/fs/inotify/max_user_watches")
	if err != nil {
		return 0
	}
	n, _ := strconv.Atoi(strings.TrimSpace(string(b)))
	return n
}

func firstLineOf(s string) string {
	s = strings.TrimSpace(s)
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		return s[:i]
	}
	return s
}
