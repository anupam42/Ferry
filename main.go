// ferry — keep a working folder and a git repo folder in sync from any terminal.
package main

import (
	"bufio"
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"golang.org/x/term"
	"gopkg.in/yaml.v3"

	"github.com/anupam42/Ferry/internal/config"
	"github.com/anupam42/Ferry/internal/difftext"
	"github.com/anupam42/Ferry/internal/engine"
	"github.com/anupam42/Ferry/internal/gitx"
	"github.com/anupam42/Ferry/internal/notify"
	"github.com/anupam42/Ferry/internal/service"
	"github.com/anupam42/Ferry/internal/tui"
	"github.com/anupam42/Ferry/internal/ui"
)

// set by -ldflags at release time
var (
	version = "1.1.0"
	commit  = "dev"
	date    = ""
)

var useColor = true

func paint(code, s string) string {
	if !useColor {
		return s
	}
	return "\033[" + code + "m" + s + "\033[0m"
}

func main() {
	enableVT()
	useColor = os.Getenv("NO_COLOR") == "" && term.IsTerminal(int(os.Stdout.Fd()))
	var args []string
	for _, a := range os.Args[1:] {
		if a == "--no-color" || a == "-no-color" {
			useColor = false
			continue
		}
		args = append(args, a)
	}
	cmd := "run"
	if len(args) > 0 {
		switch args[0] {
		case "run", "init", "commit", "diff", "backups", "service", "version", "help", "conflicts", "resolve":
			cmd, args = args[0], args[1:]
		case "-h", "--help":
			cmd, args = "help", nil
		case "-v", "--version":
			cmd, args = "version", nil
		}
	}
	var err error
	switch cmd {
	case "run":
		err = cmdRun(args)
	case "init":
		err = cmdInit(args)
	case "commit":
		err = cmdCommit(args)
	case "diff":
		err = cmdDiff(args)
	case "backups":
		err = cmdBackups(args)
	case "conflicts":
		err = cmdConflicts(args)
	case "resolve":
		err = cmdResolve(args)
	case "service":
		err = cmdService(args)
	case "version":
		fmt.Printf("ferry %s (%s) %s\n", version, commit, date)
	case "help":
		usage()
	}
	if err != nil {
		var ex exitErr
		if errors.As(err, &ex) {
			os.Exit(int(ex))
		}
		fmt.Fprintln(os.Stderr, paint("31", "error: ")+err.Error())
		os.Exit(1)
	}
}

type exitErr int

func (e exitErr) Error() string { return "exit " + strconv.Itoa(int(e)) }

func usage() {
	fmt.Print(`ferry ` + version + ` — mirror a working folder into your git repo (and back)

Usage:
  ferry [run] [flags] <source> <target>      sync one pair and watch (dashboard in a terminal)
  ferry [run] [flags] --config ferry.yaml  sync every pair in a config file
  ferry                                       uses ./ferry.yaml if present
  ferry init [file]                           write a sample config
  ferry commit [-m msg] [--push] [dir]        commit everything in a target repo
  ferry diff [--sides] <source> <target> <file>  diff target file vs HEAD (or vs source)
  ferry conflicts [--diff]                    list conflicts waiting for a decision
  ferry resolve <file>... --keep source|target|newer|both [--all] [--pair NAME]
  ferry backups list    <source> <target> [file]
  ferry backups restore <source> <target> <file> [--version N] [--to path]
  ferry service install|uninstall|start|stop|status|logs [--config file | <source> <target>]
  ferry version

Common flags (run "ferry run -h" for all):
  --two-way          sync both directions with conflict detection
  --on-delete keep|restore|propagate   what a deletion does to the other side (--delete = propagate)
  --headless-conflict hold|keep-both|source|target|newer   when nobody can be asked
  --mirror           make target match source on start
  --branch NAME      switch/create a branch in the target first
  --auto-commit MSG  commit on a timer (--auto-commit-interval 10m, --push)
  --once --dry-run   one pass / preview only        --ui tui|plain|json
`)
}

// ---------- flag helpers ----------

type multiFlag []string

func (m *multiFlag) String() string     { return strings.Join(*m, ",") }
func (m *multiFlag) Set(v string) error { *m = append(*m, v); return nil }

// parseInterspersed lets flags appear before or after positional args.
func parseInterspersed(fs *flag.FlagSet, args []string) ([]string, error) {
	var pos []string
	for {
		if err := fs.Parse(args); err != nil {
			return nil, err
		}
		rest := fs.Args()
		if len(rest) == 0 {
			return pos, nil
		}
		if rest[0] == "--" {
			return append(pos, rest[1:]...), nil
		}
		pos = append(pos, rest[0])
		args = rest[1:]
	}
}

type runFlags struct {
	fs                                              *flag.FlagSet
	configPath, pairName                            string
	mode, conflict, branch, autoCommit, binary      string
	onDelete, headlessConflict                      string
	batchAction, watcher, uiMode, logPath, pidfile  string
	maxSize                                         string
	twoWay, del, mirror, yes, noGitignore, noDefIgn bool
	push, noGuard, once, dryRun, quiet, noColor     bool
	noNotify, jsonOut, showGit                      bool
	ignores                                         multiFlag
	autoInterval, checkUpstream, interval, settle   time.Duration
	batchSettle                                     time.Duration
	batchLimit, maxOps, backups                     int
}

func newRunFlags() *runFlags {
	f := &runFlags{fs: flag.NewFlagSet("run", flag.ContinueOnError)}
	fs := f.fs
	d := config.Defaults()
	fs.StringVar(&f.configPath, "config", "", "YAML config with one or more pairs")
	fs.StringVar(&f.pairName, "pair", "", "only run the pair with this name (with --config)")
	fs.StringVar(&f.mode, "mode", d.Mode, "one-way | two-way")
	fs.BoolVar(&f.twoWay, "two-way", false, "shorthand for --mode two-way")
	fs.BoolVar(&f.del, "delete", false, "shorthand for --on-delete propagate")
	fs.StringVar(&f.onDelete, "on-delete", "keep", "file deleted on one side: keep | restore (two-way) | propagate")
	fs.StringVar(&f.headlessConflict, "headless-conflict", d.HeadlessConflict, "conflicts when nobody can be asked: hold | keep-both | source | target | newer")
	fs.BoolVar(&f.mirror, "mirror", false, "on start, delete target files that aren't in source (asks first)")
	fs.BoolVar(&f.yes, "yes", false, "don't ask for confirmation (mirror)")
	fs.StringVar(&f.conflict, "conflict", d.Conflict, "two-way conflicts: ask | hold | source | target | newer | keep-both")
	fs.Var(&f.ignores, "ignore", "glob to ignore, gitignore syntax (repeatable)")
	fs.BoolVar(&f.noGitignore, "no-gitignore", false, "don't read .gitignore files")
	fs.BoolVar(&f.noDefIgn, "no-default-ignores", false, "don't apply the built-in ignore list")
	fs.StringVar(&f.branch, "branch", "", "switch to (or create) this branch in the target first")
	fs.StringVar(&f.autoCommit, "auto-commit", "", "enable auto-commit with this message template ({count} {files} {source} {datetime})")
	fs.DurationVar(&f.autoInterval, "auto-commit-interval", d.AutoCommit.Interval.D(), "auto-commit interval")
	fs.BoolVar(&f.push, "push", false, "push after auto-commit")
	fs.DurationVar(&f.checkUpstream, "check-upstream", 0, "fetch every interval and pause while target is behind upstream (e.g. 5m)")
	fs.BoolVar(&f.noGuard, "no-guard", false, "don't pause while the target is mid merge/rebase")
	fs.StringVar(&f.maxSize, "max-size", "50MB", "skip files larger than this (0 = no limit)")
	fs.StringVar(&f.binary, "binary", d.Binary, "binary files: allow | warn | skip")
	fs.IntVar(&f.batchLimit, "batch-limit", d.BatchLimit, "batches bigger than this wait for activity to settle")
	fs.StringVar(&f.batchAction, "batch-action", d.BatchAction, "large batches: apply | confirm")
	fs.DurationVar(&f.batchSettle, "batch-settle", d.BatchSettle.D(), "quiet time required before applying a large batch")
	fs.IntVar(&f.maxOps, "max-ops", 0, "max file operations per second (0 = unlimited)")
	fs.IntVar(&f.backups, "backups", d.Backups, "versions to keep before overwrite/delete (0 = off)")
	fs.StringVar(&f.watcher, "watcher", d.Watcher, "auto | native | poll")
	fs.DurationVar(&f.interval, "interval", d.Interval.D(), "poll interval")
	fs.DurationVar(&f.settle, "settle", d.Settle.D(), "quiet time before applying changes")
	fs.StringVar(&f.uiMode, "ui", "auto", "auto | tui | plain | json")
	fs.BoolVar(&f.jsonOut, "json", false, "shorthand for --ui json (NDJSON events on stdout)")
	fs.BoolVar(&f.once, "once", false, "sync once and exit")
	fs.BoolVar(&f.dryRun, "dry-run", false, "show what would change without writing")
	fs.BoolVar(&f.quiet, "quiet", false, "plain mode: only summaries, warnings and errors")
	fs.BoolVar(&f.noColor, "no-color", false, "disable colors (NO_COLOR is honored too)")
	fs.BoolVar(&f.noNotify, "no-notify", false, "disable desktop notifications")
	fs.BoolVar(&f.showGit, "git", false, "plain mode: print git status after each batch")
	fs.StringVar(&f.logPath, "log", "", "also append a plain-text log to this file")
	fs.StringVar(&f.pidfile, "pidfile", "", "write the process id to this file")
	return f
}

// apply copies explicitly-set flags onto p, so config file values win otherwise.
func (f *runFlags) apply(p *config.Pair) error {
	var err error
	f.fs.Visit(func(fl *flag.Flag) {
		switch fl.Name {
		case "mode":
			p.Mode = f.mode
		case "two-way":
			if f.twoWay {
				p.Mode = "two-way"
			}
		case "delete":
			p.Delete = f.del
			if f.del {
				p.OnDelete = "propagate"
			} else if p.OnDelete == "propagate" {
				p.OnDelete = "keep"
			}
		case "on-delete":
			p.OnDelete = f.onDelete
		case "headless-conflict":
			p.HeadlessConflict = f.headlessConflict
		case "mirror":
			p.Mirror = f.mirror
		case "conflict":
			p.Conflict = f.conflict
		case "ignore":
			p.Ignore = append(p.Ignore, f.ignores...)
		case "no-gitignore":
			p.UseGitignore = !f.noGitignore
		case "no-default-ignores":
			p.DefaultIgnores = !f.noDefIgn
		case "branch":
			p.Branch = f.branch
		case "auto-commit":
			p.AutoCommit.Enabled = true
			p.AutoCommit.Message = f.autoCommit
		case "auto-commit-interval":
			p.AutoCommit.Interval = config.Duration(f.autoInterval)
		case "push":
			p.AutoCommit.Push = f.push
		case "check-upstream":
			p.CheckUpstream = config.Duration(f.checkUpstream)
		case "no-guard":
			p.GitGuard = !f.noGuard
		case "max-size":
			var s config.Size
			if s, err = config.ParseSize(f.maxSize); err == nil {
				p.MaxSize = s
			}
		case "binary":
			p.Binary = f.binary
		case "batch-limit":
			p.BatchLimit = f.batchLimit
		case "batch-action":
			p.BatchAction = f.batchAction
		case "batch-settle":
			p.BatchSettle = config.Duration(f.batchSettle)
		case "max-ops":
			p.MaxOpsPerSec = f.maxOps
		case "backups":
			p.Backups = f.backups
		case "watcher":
			p.Watcher = f.watcher
		case "interval":
			p.Interval = config.Duration(f.interval)
		case "settle":
			p.Settle = config.Duration(f.settle)
		}
	})
	p.DryRun = f.dryRun
	return err
}

func loadPairs(f *runFlags, pos []string) ([]config.Pair, *bool, error) {
	var pairs []config.Pair
	var notifyCfg *bool
	cfgPath := f.configPath
	if cfgPath == "" && len(pos) == 0 {
		for _, c := range []string{"ferry.yaml", "ferry.yml", ".ferry.yaml"} {
			if _, err := os.Stat(c); err == nil {
				cfgPath = c
				break
			}
		}
		if cfgPath == "" {
			usage()
			return nil, nil, exitErr(2)
		}
	}
	if cfgPath != "" {
		if len(pos) > 0 {
			return nil, nil, errors.New("use either --config or <source> <target>, not both")
		}
		var err error
		if pairs, notifyCfg, err = config.Load(cfgPath); err != nil {
			return nil, nil, err
		}
		if f.pairName != "" {
			var keep []config.Pair
			for _, p := range pairs {
				if p.Name == f.pairName {
					keep = append(keep, p)
				}
			}
			if len(keep) == 0 {
				return nil, nil, fmt.Errorf("no pair named %q in %s", f.pairName, cfgPath)
			}
			pairs = keep
		}
	} else {
		if len(pos) != 2 {
			return nil, nil, errors.New("expected <source> <target>")
		}
		p := config.Defaults()
		p.Source, p.Target = pos[0], pos[1]
		pairs = []config.Pair{p}
	}
	for i := range pairs {
		if err := f.apply(&pairs[i]); err != nil {
			return nil, nil, err
		}
		if err := pairs[i].Normalize(); err != nil {
			return nil, nil, err
		}
	}
	return pairs, notifyCfg, config.CheckOverlaps(pairs)
}

// ---------- run ----------

func cmdRun(args []string) error {
	f := newRunFlags()
	f.fs.Usage = func() {
		fmt.Fprintln(os.Stderr, "Usage: ferry run [flags] <source> <target> | --config file")
		f.fs.PrintDefaults()
	}
	pos, err := parseInterspersed(f.fs, args)
	if err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return nil
		}
		return exitErr(2)
	}
	if f.noColor {
		useColor = false
	}
	pairs, notifyCfg, err := loadPairs(f, pos)
	if err != nil {
		return err
	}

	uiMode := f.uiMode
	if f.jsonOut {
		uiMode = "json"
	}
	isTTY := term.IsTerminal(int(os.Stdout.Fd())) && term.IsTerminal(int(os.Stdin.Fd()))
	if uiMode == "auto" {
		uiMode = "plain"
		if isTTY && !f.once {
			uiMode = "tui"
		}
	}
	if uiMode == "tui" && !isTTY {
		return errors.New("--ui tui needs an interactive terminal")
	}

	notify.Enabled = !f.noNotify && !f.once && (notifyCfg == nil || *notifyCfg)

	// "ask" needs someone to ask: the dashboard, or a prompt in an interactive
	// terminal. Otherwise the pair's headless_conflict policy applies.
	interactive := uiMode == "tui" || (uiMode == "plain" && isTTY)
	asking := false
	for i := range pairs {
		if pairs[i].Mode != "two-way" || pairs[i].Conflict != "ask" {
			continue
		}
		if interactive {
			asking = true
		} else {
			pairs[i].Conflict = pairs[i].HeadlessConflict
		}
	}

	if f.pidfile != "" {
		_ = os.MkdirAll(filepath.Dir(f.pidfile), 0o755)
		_ = os.WriteFile(f.pidfile, []byte(strconv.Itoa(os.Getpid())), 0o644)
		defer os.Remove(f.pidfile)
	}
	var logFile io.Writer
	if f.logPath != "" {
		_ = os.MkdirAll(filepath.Dir(f.logPath), 0o755)
		lf, err := os.OpenFile(f.logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
		if err != nil {
			return err
		}
		defer lf.Close()
		logFile = lf
	}

	printer := &ui.Printer{
		Out: os.Stdout, Log: logFile, Color: useColor, Quiet: f.quiet,
		JSON: uiMode == "json", ShowGit: f.showGit, ShowPair: len(pairs) > 1,
	}

	var emit func(engine.Event)
	var evCh chan engine.Event
	if uiMode == "tui" {
		evCh = make(chan engine.Event, 4096)
		var filePrinter *ui.Printer
		if logFile != nil {
			filePrinter = &ui.Printer{Out: logFile, ShowPair: true, ShowGit: true}
		}
		emit = func(ev engine.Event) {
			if filePrinter != nil {
				filePrinter.Handle(ev)
			}
			select {
			case evCh <- ev:
			default: // dashboard is behind; drop rather than stall syncing
			}
		}
	} else {
		emit = printer.Handle
	}

	// plain interactive terminal: ask about conflicts right here
	byName := map[string]*engine.Engine{}
	stdin := bufio.NewReader(os.Stdin)
	var promptCh chan engine.Event
	if uiMode == "plain" && asking && !f.once {
		promptCh = make(chan engine.Event, 256)
		base := emit
		emit = func(ev engine.Event) {
			base(ev)
			if ev.Kind == engine.KConflict && ev.Held {
				select {
				case promptCh <- ev:
				default:
				}
			}
		}
	}

	engines := make([]*engine.Engine, len(pairs))
	for i, p := range pairs {
		engines[i] = engine.New(p, emit)
		byName[p.Name] = engines[i]
	}
	if promptCh != nil {
		go runPrompter(promptCh, byName, stdin)
	}

	// mirror needs a confirmation before anything runs
	for i, p := range pairs {
		if !p.Mirror {
			continue
		}
		list, err := engines[i].PlanMirror()
		if err != nil {
			return err
		}
		if len(list) == 0 {
			continue
		}
		if !f.yes && !p.DryRun {
			if !term.IsTerminal(int(os.Stdin.Fd())) {
				return fmt.Errorf("pair %q: --mirror would delete %d target files; re-run with --yes to confirm", p.Name, len(list))
			}
			fmt.Printf("%s mirror for %s will delete %d file(s) in %s that are not in the source:\n",
				paint("1;33", "!"), p.Name, len(list), p.Target)
			for j, rel := range list {
				if j == 20 {
					fmt.Printf("   … and %d more\n", len(list)-20)
					break
				}
				fmt.Println("   - " + rel)
			}
			if !confirm("Delete them? (backups are kept) [y/N] ") {
				fmt.Println("mirror skipped")
				continue
			}
		}
		engines[i].ApproveMirror(list)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
	go func() { <-sig; cancel() }()

	if f.once {
		code := 0
		held := 0
		for _, e := range engines {
			if err := e.Run(ctx, true); err != nil {
				emit(engine.Event{Time: time.Now(), Pair: e.Name(), Kind: engine.KError, Msg: err.Error()})
				code = 1
			}
			st := e.Status()
			if uiMode != "json" {
				fmt.Printf("%s %s: +%d ~%d -%d ↻%d, %d skipped, %d failed%s\n", paint("36", "done"), e.Name(),
					st.Added, st.Updated, st.Deleted, st.Renamed, st.Skipped, st.Failed, dryNote(f.dryRun))
			}
			if st.Failed > 0 {
				code = 1
			}
			for _, rel := range e.HeldConflicts() {
				if asking && uiMode == "plain" {
					if c, ok := askChoice(stdin, e, rel); ok {
						e.ResolveSync(rel, c)
						continue
					}
				}
				held++
			}
		}
		if held > 0 && uiMode != "json" {
			fmt.Printf("%s %d conflict(s) left as they are. See them with: ferry conflicts\n", paint("1;33", "!"), held)
		}
		if code != 0 {
			return exitErr(code)
		}
		if held > 0 {
			return exitErr(3)
		}
		return nil
	}

	if uiMode == "plain" {
		for _, p := range pairs {
			arrow := "→"
			if p.Mode == "two-way" {
				arrow = "⇄"
			}
			fmt.Printf("%s %s  %s %s %s\n", paint("1", "ferry "+version), paint("90", p.Name), p.Source, arrow, p.Target)
		}
		fmt.Println(paint("90", "watching for changes… press Ctrl+C to stop"))
	}
	var wg sync.WaitGroup
	for _, e := range engines {
		wg.Add(1)
		go func(e *engine.Engine) {
			defer wg.Done()
			if err := e.Run(ctx, false); err != nil {
				emit(engine.Event{Time: time.Now(), Pair: e.Name(), Kind: engine.KError, Msg: err.Error()})
			}
		}(e)
	}

	if uiMode == "tui" {
		prog := tea.NewProgram(tui.New(engines, version), tea.WithAltScreen(), tea.WithContext(ctx))
		go func() {
			for ev := range evCh {
				prog.Send(tui.EventMsg(ev))
			}
		}()
		_, err := prog.Run()
		cancel()
		wg.Wait()
		if err != nil && !errors.Is(err, tea.ErrProgramKilled) && !errors.Is(err, context.Canceled) {
			return err
		}
		for _, e := range engines {
			st := e.Status()
			fmt.Printf("%s %s: +%d ~%d -%d ↻%d this session\n", paint("36", "stopped"), e.Name(), st.Added, st.Updated, st.Deleted, st.Renamed)
		}
		return nil
	}

	wg.Wait()
	if uiMode != "json" {
		fmt.Println(paint("90", "stopped."))
	}
	return nil
}

func dryNote(dry bool) string {
	if dry {
		return paint("90", " (dry-run, nothing written)")
	}
	return ""
}

func confirm(prompt string) bool {
	fmt.Print(prompt)
	line, _ := bufio.NewReader(os.Stdin).ReadString('\n')
	line = strings.ToLower(strings.TrimSpace(line))
	return line == "y" || line == "yes"
}

// ---------- init ----------

func cmdInit(args []string) error {
	path := "ferry.yaml"
	if len(args) > 0 {
		path = args[0]
	}
	if _, err := os.Stat(path); err == nil {
		return fmt.Errorf("%s already exists", path)
	}
	if err := os.WriteFile(path, []byte(config.Sample), 0o644); err != nil {
		return err
	}
	fmt.Printf("wrote %s — edit the pairs, then run: ferry --config %s\n", path, path)
	return nil
}

// ---------- commit ----------

func cmdCommit(args []string) error {
	fs := flag.NewFlagSet("commit", flag.ContinueOnError)
	msg := fs.String("m", "", "commit message (default: summary of changed files)")
	push := fs.Bool("push", false, "push after committing")
	pos, err := parseInterspersed(fs, args)
	if err != nil {
		return exitErr(2)
	}
	dir := "."
	if len(pos) > 0 {
		dir = pos[0]
	}
	if !gitx.IsRepo(dir) {
		return fmt.Errorf("%s is not a git repository", dir)
	}
	lines, _ := gitx.Status(dir)
	if len(lines) == 0 {
		fmt.Println("nothing to commit")
		return nil
	}
	if *msg == "" {
		*msg = fmt.Sprintf("sync: update %d file(s) — %s", len(lines), time.Now().Format("2006-01-02 15:04"))
	}
	hash, err := gitx.CommitAll(dir, *msg)
	if err != nil {
		return err
	}
	fmt.Printf("%s %s %s\n", paint("32", "committed"), hash, *msg)
	if *push {
		if err := gitx.Push(dir); err != nil {
			return err
		}
		fmt.Println(paint("32", "pushed ") + gitx.CurrentBranch(dir))
	}
	return nil
}

// ---------- diff ----------

func cmdDiff(args []string) error {
	fs := flag.NewFlagSet("diff", flag.ContinueOnError)
	sides := fs.Bool("sides", false, "compare target vs source instead of HEAD vs target")
	pos, err := parseInterspersed(fs, args)
	if err != nil {
		return exitErr(2)
	}
	if len(pos) != 3 {
		return errors.New("usage: ferry diff [--sides] <source> <target> <file>")
	}
	p := config.Defaults()
	p.Source, p.Target = pos[0], pos[1]
	if err := p.Normalize(); err != nil {
		return err
	}
	rel := relTo(p, pos[2])
	title, lines := engine.New(p, nil).Diff(rel, *sides)
	printDiff(title, lines)
	return nil
}

func printDiff(title string, lines []difftext.Line) {
	fmt.Println(paint("1", title))
	if len(lines) == 0 {
		fmt.Println(paint("90", "no differences"))
	}
	for _, l := range lines {
		switch l.Op {
		case '+':
			fmt.Println(paint("32", "+"+l.Text))
		case '-':
			fmt.Println(paint("31", "-"+l.Text))
		case '@':
			fmt.Println(paint("36", l.Text))
		default:
			fmt.Println(" " + l.Text)
		}
	}
}

// relTo accepts a path relative to the pair, or an absolute path inside either folder.
func relTo(p config.Pair, file string) string {
	if abs, err := filepath.Abs(file); err == nil {
		for _, root := range []string{p.Target, p.Source} {
			if r, err := filepath.Rel(root, abs); err == nil && !strings.HasPrefix(r, "..") {
				if _, err := os.Stat(abs); err == nil {
					return filepath.ToSlash(r)
				}
			}
		}
	}
	return filepath.ToSlash(file)
}

// ---------- backups ----------

func cmdBackups(args []string) error {
	if len(args) == 0 {
		return errors.New("usage: ferry backups list|restore <source> <target> [file]")
	}
	sub := args[0]
	fs := flag.NewFlagSet("backups", flag.ContinueOnError)
	ver := fs.Int("version", 1, "which version to restore (1 = newest)")
	to := fs.String("to", "", "restore to this path instead of the original location")
	pos, err := parseInterspersed(fs, args[1:])
	if err != nil {
		return exitErr(2)
	}
	if len(pos) < 2 {
		return errors.New("expected <source> <target>")
	}
	p := config.Defaults()
	p.Source, p.Target = pos[0], pos[1]
	if err := p.Normalize(); err != nil {
		return err
	}
	file := ""
	if len(pos) > 2 {
		file = relTo(p, pos[2])
	}
	list, err := engine.ListBackups(config.DataDir(), p.ID(), file)
	if err != nil {
		return err
	}
	switch sub {
	case "list":
		if len(list) == 0 {
			fmt.Println("no backups")
			return nil
		}
		last, n := "", 0
		for _, b := range list {
			if b.Side+b.Rel != last {
				last, n = b.Side+b.Rel, 0
				fmt.Printf("%s %s\n", paint("1", b.Rel), paint("90", "("+b.Side+")"))
			}
			n++
			fmt.Printf("   %d. %s  %s\n", n, b.Time.Format("2006-01-02 15:04:05"), config.HumanSize(b.Size))
		}
		fmt.Println(paint("90", "stored in "+engine.BackupDir(config.DataDir(), p.ID())))
	case "restore":
		if file == "" {
			return errors.New("restore needs a file")
		}
		if len(list) < *ver || *ver < 1 {
			return fmt.Errorf("no version %d for %s (%d available)", *ver, file, len(list))
		}
		b := list[*ver-1]
		dest := *to
		if dest == "" {
			root := p.Target
			if b.Side == "source" {
				root = p.Source
			}
			dest = filepath.Join(root, filepath.FromSlash(b.Rel))
		}
		if err := engine.RestoreBackup(config.DataDir(), p.ID(), b, dest, p.Backups); err != nil {
			return err
		}
		fmt.Printf("%s %s from %s → %s\n", paint("32", "restored"), b.Rel, b.Time.Format("2006-01-02 15:04:05"), dest)
	default:
		return errors.New("usage: ferry backups list|restore ...")
	}
	return nil
}

// ---------- service ----------

func cmdService(args []string) error {
	if len(args) == 0 {
		return errors.New("usage: ferry service install|uninstall|start|stop|status|logs")
	}
	sub := args[0]
	switch sub {
	case "install":
		f := newRunFlags()
		pos, err := parseInterspersed(f.fs, args[1:])
		if err != nil {
			return exitErr(2)
		}
		cfg := f.configPath
		if cfg == "" {
			if len(pos) != 2 {
				return errors.New("usage: ferry service install --config ferry.yaml | <source> <target> [--two-way --delete ...]")
			}
			pairs, _, err := loadPairs(f, pos)
			if err != nil {
				return err
			}
			cfg = filepath.Join(config.DataDir(), "service.yaml")
			if err := writeServiceConfig(cfg, pairs[0]); err != nil {
				return err
			}
		}
		where, err := service.Install(cfg)
		if err != nil {
			return err
		}
		fmt.Printf("%s background service installed (%s)\n  config: %s\n  log:    %s\n", paint("32", "✓"), where, cfg, service.LogPath())
	case "uninstall":
		if err := service.Uninstall(); err != nil {
			return err
		}
		fmt.Println(paint("32", "✓") + " service removed")
	case "start":
		return service.Start()
	case "stop":
		return service.Stop()
	case "status":
		fmt.Println(service.Status())
	case "logs":
		n := 50
		if len(args) > 1 {
			if v, err := strconv.Atoi(args[1]); err == nil {
				n = v
			}
		}
		return service.Logs(os.Stdout, n)
	default:
		return errors.New("usage: ferry service install|uninstall|start|stop|status|logs")
	}
	return nil
}

func writeServiceConfig(path string, p config.Pair) error {
	p.DryRun = false
	doc := map[string]any{"pairs": []config.Pair{p}}
	data, err := yaml.Marshal(doc)
	if err != nil {
		return err
	}
	_ = os.MkdirAll(filepath.Dir(path), 0o755)
	return os.WriteFile(path, append([]byte("# generated by ferry service install\n"), data...), 0o644)
}

// ---------- conflict prompts ----------

var promptMu sync.Mutex

// askChoice prompts on the terminal. ok=false means "decide later".
func askChoice(in *bufio.Reader, e *engine.Engine, rel string) (engine.Choice, bool) {
	promptMu.Lock()
	defer promptMu.Unlock()
	for {
		fmt.Printf("\n%s %s %s changed on both sides.\n  [s] keep source  [t] keep target  [n] keep newer  [b] keep both  [d] diff  [l] later: ",
			paint("1;31", "conflict"), paint("90", "["+e.Name()+"]"), paint("1", rel))
		line, err := in.ReadString('\n')
		if err != nil {
			return "", false
		}
		switch strings.ToLower(strings.TrimSpace(line)) {
		case "s", "source":
			return engine.UseSource, true
		case "t", "target":
			return engine.UseTarget, true
		case "n", "newer":
			return engine.UseNewer, true
		case "b", "both":
			return engine.KeepBoth, true
		case "d", "diff":
			printDiff(e.Diff(rel, true))
		case "l", "later", "":
			fmt.Println(paint("90", "  left as is. Resolve later with: ferry resolve "+rel+" --keep source|target|newer|both"))
			return "", false
		}
	}
}

func runPrompter(ch chan engine.Event, byName map[string]*engine.Engine, in *bufio.Reader) {
	for ev := range ch {
		e := byName[ev.Pair]
		if e == nil {
			continue
		}
		time.Sleep(300 * time.Millisecond) // let the sync pass finish printing
		still := false
		for _, c := range e.Status().Conflicts {
			if c == ev.Path {
				still = true
			}
		}
		if !still {
			continue
		}
		if c, ok := askChoice(in, e, ev.Path); ok {
			e.Resolve(ev.Path, c)
		}
	}
}

// ---------- conflicts / resolve ----------

func cmdConflicts(args []string) error {
	fs := flag.NewFlagSet("conflicts", flag.ContinueOnError)
	showDiff := fs.Bool("diff", false, "show a diff (target vs source) for each conflict")
	if _, err := parseInterspersed(fs, args); err != nil {
		return exitErr(2)
	}
	total := 0
	for _, sp := range engine.SavedPairs(config.DataDir()) {
		if len(sp.Conflicts) == 0 {
			continue
		}
		run := paint("90", "not running")
		if sp.PID > 0 {
			run = paint("32", fmt.Sprintf("running (pid %d)", sp.PID))
		}
		fmt.Printf("%s  %s ⇄ %s  %s\n", paint("1", sp.Pair.Name), sp.Pair.Source, sp.Pair.Target, run)
		e := engine.New(sp.Pair, nil)
		for _, c := range sp.Conflicts {
			total++
			fmt.Printf("  %s %s\n", paint("1;31", "!"), c)
			if *showDiff {
				printDiff(e.Diff(c, true))
			}
		}
	}
	if total == 0 {
		fmt.Println("no conflicts")
		return nil
	}
	fmt.Println(paint("90", "\nresolve with: ferry resolve <file> --keep source|target|newer|both   (or --all)"))
	return nil
}

func cmdResolve(args []string) error {
	fs := flag.NewFlagSet("resolve", flag.ContinueOnError)
	keep := fs.String("keep", "", "source | target | newer | both")
	all := fs.Bool("all", false, "resolve every conflict (of --pair, or of all pairs)")
	pairName := fs.String("pair", "", "pair name, when files are ambiguous")
	pos, err := parseInterspersed(fs, args)
	if err != nil {
		return exitErr(2)
	}
	choice, ok := map[string]engine.Choice{
		"source": engine.UseSource, "s": engine.UseSource,
		"target": engine.UseTarget, "t": engine.UseTarget,
		"newer": engine.UseNewer, "n": engine.UseNewer,
		"both": engine.KeepBoth, "keep-both": engine.KeepBoth, "b": engine.KeepBoth,
	}[strings.ToLower(*keep)]
	if !ok {
		return errors.New("usage: ferry resolve <file>... --keep source|target|newer|both [--all] [--pair NAME]")
	}
	if !*all && len(pos) == 0 {
		return errors.New("name the conflicted file(s), or use --all")
	}

	var cands []engine.SavedPair
	for _, sp := range engine.SavedPairs(config.DataDir()) {
		if len(sp.Conflicts) > 0 && (*pairName == "" || sp.Pair.Name == *pairName) {
			cands = append(cands, sp)
		}
	}
	if len(cands) == 0 {
		fmt.Println("no conflicts to resolve")
		return nil
	}

	// pair ID -> files to resolve
	todo := map[string][]string{}
	if *all {
		for _, sp := range cands {
			todo[sp.ID] = sp.Conflicts
		}
	} else {
		for _, f := range pos {
			var hits []engine.SavedPair
			for _, sp := range cands {
				rel := relTo(sp.Pair, f)
				for _, c := range sp.Conflicts {
					if c == rel {
						hits = append(hits, sp)
						todo[sp.ID] = append(todo[sp.ID], rel)
					}
				}
			}
			if len(hits) == 0 {
				return fmt.Errorf("%s is not a conflict (see: ferry conflicts)", f)
			}
			if len(hits) > 1 {
				return fmt.Errorf("%s is a conflict in several pairs; add --pair NAME", f)
			}
		}
	}

	printer := &ui.Printer{Out: os.Stdout, Color: useColor}
	for _, sp := range cands {
		files := todo[sp.ID]
		if len(files) == 0 {
			continue
		}
		for _, rel := range files {
			if err := engine.QueueResolve(config.DataDir(), sp.ID, rel, choice); err != nil {
				return err
			}
		}
		if pid, running := engine.RunningPID(config.DataDir(), sp.ID); running {
			deadline := time.Now().Add(8 * time.Second)
			for engine.PendingRequests(config.DataDir(), sp.ID) > 0 && time.Now().Before(deadline) {
				time.Sleep(200 * time.Millisecond)
			}
			if engine.PendingRequests(config.DataDir(), sp.ID) == 0 {
				fmt.Printf("%s %d conflict(s) in %s resolved by the running ferry (pid %d): kept %s\n", paint("32", "✓"), len(files), sp.Pair.Name, pid, choice)
			} else {
				fmt.Printf("%s queued for %s; the running ferry (pid %d) will apply it shortly\n", paint("33", "…"), sp.Pair.Name, pid)
			}
			continue
		}
		if err := engine.ResolveOffline(config.DataDir(), sp.ID, printer.Handle); err != nil {
			return err
		}
	}
	return nil
}
