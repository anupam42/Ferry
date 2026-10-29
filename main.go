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

	"github.com/anupam42/Ferry/internal/api"
	"github.com/anupam42/Ferry/internal/config"
	"github.com/anupam42/Ferry/internal/difftext"
	"github.com/anupam42/Ferry/internal/engine"
	"github.com/anupam42/Ferry/internal/gitx"
	"github.com/anupam42/Ferry/internal/notify"
	"github.com/anupam42/Ferry/internal/service"
	"github.com/anupam42/Ferry/internal/tui"
	"github.com/anupam42/Ferry/internal/ui"
	"github.com/anupam42/Ferry/internal/webhook"
)

// set by -ldflags at release time
var (
	version = "1.2.0"
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

var subcommands = []string{
	"run", "init", "status", "commit", "diff", "plan", "conflicts", "resolve", "history", "undo",
	"backups", "doctor", "service", "completion", "version", "help",
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
		case "-h", "--help":
			cmd, args = "help", nil
		case "-v", "--version":
			cmd, args = "version", nil
		default:
			for _, c := range subcommands {
				if args[0] == c {
					cmd, args = args[0], args[1:]
					break
				}
			}
		}
	}
	var err error
	switch cmd {
	case "run":
		err = cmdRun(args)
	case "init":
		err = cmdInit(args)
	case "status":
		err = cmdStatus(args)
	case "commit":
		err = cmdCommit(args)
	case "diff":
		err = cmdDiff(args)
	case "plan":
		err = cmdPlan(args)
	case "backups":
		err = cmdBackups(args)
	case "conflicts":
		err = cmdConflicts(args)
	case "resolve":
		err = cmdResolve(args)
	case "history":
		err = cmdHistory(args)
	case "undo":
		err = cmdUndo(args)
	case "doctor":
		err = cmdDoctor(args)
	case "service":
		err = cmdService(args)
	case "completion":
		err = cmdCompletion(args)
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
  ferry [run] [flags] <source> <target>        sync one pair and watch (dashboard in a terminal)
  ferry [run] [flags] --config ferry.yaml      sync every pair in a config file
  ferry                                        uses ./ferry.yaml if present
  ferry init [file]                            write a sample config
  ferry status [--json]                        what every pair is doing right now
  ferry plan [--diff] [--format text|markdown|json] <source> <target> | --config file
  ferry commit [-m msg] [--push] [--sign] [--author A] [dir]
  ferry diff [--sides] <source> <target> <file>   diff target file vs HEAD (or vs source)
  ferry conflicts [--diff]                     list conflicts waiting for a decision
  ferry resolve <file>... --keep source|target|newer|both|merge [--all] [--pair NAME]
  ferry history [--pair NAME] [-n 20]          recent sync batches
  ferry undo [--pair NAME] [--batch ID] [--yes]   undo the last sync batch
  ferry backups list    <source> <target> [file]
  ferry backups restore <source> <target> <file> [--version N] [--to path]
  ferry backups prune   [--older-than 30d] [--max-size 1GB] [<source> <target>]
  ferry doctor [--config file | <source> <target>]   check git, watchers, service and config
  ferry service install|uninstall|start|stop|status|logs [--config file | <source> <target>]
  ferry completion bash|zsh|fish|powershell
  ferry version

Targets can be local folders or ssh: user@host:path or ssh://user@host:port/path

Common flags (run "ferry run -h" for all):
  --two-way          sync both directions with conflict detection (--merge tries a 3-way merge)
  --on-delete keep|restore|propagate   what a deletion does to the other side (--delete = propagate)
  --only GLOB        sync only matching paths (repeatable)
  --mirror           make target match source on start
  --branch NAME      switch/create a branch in the target first
  --auto-commit MSG  commit on a timer (--auto-commit-interval 10m, --push, --pr)
  --secrets warn|block|off   flag files that look like credentials
  --every 15m / --window 09:00-18:00 --days mon-fri   sync on a schedule
  --serve 127.0.0.1:7878   local HTTP API     --webhook URL   chat notifications
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

	// added in 1.2
	only, secretAllow, webhooks                       multiFlag
	eol, symlinks, secrets, window, days              string
	beforeCommit, prBase, author, every               string
	backupMaxAge, backupMaxSize                       string
	serve, serveToken, theme                          string
	merge, lfs, trash, pullRebase, autoPull, pr, sign bool
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
	fs.BoolVar(&f.merge, "merge", false, "two-way: try a three-way merge of text files before calling it a conflict")
	fs.Var(&f.ignores, "ignore", "glob to ignore, gitignore syntax (repeatable)")
	fs.Var(&f.only, "only", "sync only paths matching this glob, gitignore syntax (repeatable)")
	fs.BoolVar(&f.noGitignore, "no-gitignore", false, "don't read .gitignore files")
	fs.BoolVar(&f.noDefIgn, "no-default-ignores", false, "don't apply the built-in ignore list")
	fs.StringVar(&f.branch, "branch", "", "switch to (or create) this branch in the target first")
	fs.StringVar(&f.autoCommit, "auto-commit", "", "enable auto-commit with this message template ({summary} {count} {files} {source} {datetime})")
	fs.DurationVar(&f.autoInterval, "auto-commit-interval", d.AutoCommit.Interval.D(), "auto-commit interval")
	fs.BoolVar(&f.push, "push", false, "push after auto-commit")
	fs.BoolVar(&f.pullRebase, "pull-rebase", false, "pull --rebase before pushing")
	fs.BoolVar(&f.pr, "pr", false, "open a pull request after pushing (needs the gh CLI)")
	fs.StringVar(&f.prBase, "pr-base", "", "base branch for --pr")
	fs.StringVar(&f.beforeCommit, "before-commit", "", "command that must pass before ferry commits (e.g. \"npm test\")")
	fs.BoolVar(&f.sign, "sign", false, "sign commits (git commit -S)")
	fs.StringVar(&f.author, "author", "", "author for commits made by ferry, \"Name <email>\"")
	fs.DurationVar(&f.checkUpstream, "check-upstream", 0, "fetch every interval and pause while target is behind upstream (e.g. 5m)")
	fs.BoolVar(&f.autoPull, "auto-pull", false, "with --check-upstream: pull --rebase instead of pausing")
	fs.BoolVar(&f.noGuard, "no-guard", false, "don't pause while the target is mid merge/rebase")
	fs.StringVar(&f.maxSize, "max-size", "50MB", "skip files larger than this (0 = no limit)")
	fs.StringVar(&f.binary, "binary", d.Binary, "binary files: allow | warn | skip")
	fs.BoolVar(&f.lfs, "lfs", false, "track large and binary files with git LFS instead of skipping them")
	fs.StringVar(&f.secrets, "secrets", d.Secrets, "files that look like credentials: warn | block | off")
	fs.Var(&f.secretAllow, "secret-allow", "glob never flagged as a secret (repeatable)")
	fs.StringVar(&f.eol, "eol", d.EOL, "line endings of text files written to the target: keep | lf | crlf")
	fs.StringVar(&f.symlinks, "symlinks", d.Symlinks, "skip | follow | link")
	fs.IntVar(&f.batchLimit, "batch-limit", d.BatchLimit, "batches bigger than this wait for activity to settle")
	fs.StringVar(&f.batchAction, "batch-action", d.BatchAction, "large batches: apply | confirm")
	fs.DurationVar(&f.batchSettle, "batch-settle", d.BatchSettle.D(), "quiet time required before applying a large batch")
	fs.IntVar(&f.maxOps, "max-ops", 0, "max file operations per second (0 = unlimited)")
	fs.IntVar(&f.backups, "backups", d.Backups, "versions to keep before overwrite/delete (0 = off)")
	fs.StringVar(&f.backupMaxAge, "backup-max-age", "", "prune backups older than this (e.g. 30d)")
	fs.StringVar(&f.backupMaxSize, "backup-max-size", "", "prune the oldest backups past this total (e.g. 1GB)")
	fs.BoolVar(&f.trash, "trash", false, "also send deleted files to the OS trash / recycle bin")
	fs.StringVar(&f.watcher, "watcher", d.Watcher, "auto | native | poll")
	fs.DurationVar(&f.interval, "interval", d.Interval.D(), "poll interval")
	fs.DurationVar(&f.settle, "settle", d.Settle.D(), "quiet time before applying changes")
	fs.StringVar(&f.every, "every", "", "sync on a timer instead of watching (e.g. 15m)")
	fs.StringVar(&f.window, "window", "", "only sync between these times, e.g. 09:00-18:00")
	fs.StringVar(&f.days, "days", "", "only sync on these days, e.g. mon-fri or sat,sun")
	fs.StringVar(&f.uiMode, "ui", "auto", "auto | tui | plain | json")
	fs.BoolVar(&f.jsonOut, "json", false, "shorthand for --ui json (NDJSON events on stdout)")
	fs.StringVar(&f.theme, "theme", "", "dashboard colors: auto | dark | light | mono")
	fs.StringVar(&f.serve, "serve", "", "serve the local HTTP API on this address (e.g. 127.0.0.1:7878)")
	fs.StringVar(&f.serveToken, "serve-token", "", "bearer token required by the HTTP API")
	fs.Var(&f.webhooks, "webhook", "post conflicts, errors, pauses and commits to this URL (repeatable)")
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
	setErr := func(e error) {
		if e != nil && err == nil {
			err = e
		}
	}
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
		case "merge":
			p.Merge = f.merge
		case "ignore":
			p.Ignore = append(p.Ignore, f.ignores...)
		case "only":
			p.Only = append([]string{}, f.only...)
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
		case "pull-rebase":
			p.PullRebase = f.pullRebase
		case "pr":
			p.PR = f.pr
		case "pr-base":
			p.PRBase = f.prBase
		case "before-commit":
			p.BeforeCommit = f.beforeCommit
		case "sign":
			p.SignCommits = f.sign
		case "author":
			p.CommitAuthor = f.author
		case "check-upstream":
			p.CheckUpstream = config.Duration(f.checkUpstream)
		case "auto-pull":
			p.AutoPull = f.autoPull
		case "no-guard":
			p.GitGuard = !f.noGuard
		case "max-size":
			s, e := config.ParseSize(f.maxSize)
			setErr(e)
			p.MaxSize = s
		case "binary":
			p.Binary = f.binary
		case "lfs":
			p.LFS = f.lfs
		case "secrets":
			p.Secrets = f.secrets
		case "secret-allow":
			p.SecretAllow = append(p.SecretAllow, f.secretAllow...)
		case "eol":
			p.EOL = f.eol
		case "symlinks":
			p.Symlinks = f.symlinks
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
		case "backup-max-age":
			d, e := config.ParseDuration(f.backupMaxAge)
			setErr(e)
			p.BackupMaxAge = config.Duration(d)
		case "backup-max-size":
			s, e := config.ParseSize(f.backupMaxSize)
			setErr(e)
			p.BackupMaxSize = s
		case "trash":
			p.Trash = f.trash
		case "watcher":
			p.Watcher = f.watcher
		case "interval":
			p.Interval = config.Duration(f.interval)
		case "settle":
			p.Settle = config.Duration(f.settle)
		case "every":
			d, e := config.ParseDuration(f.every)
			setErr(e)
			p.Every = config.Duration(d)
		case "window":
			p.Window = f.window
		case "days":
			p.Days = strings.Split(f.days, ",")
		}
	})
	p.DryRun = f.dryRun
	return err
}

// settings merges top-level flags over the config file's settings.
func (f *runFlags) settings(s config.Settings) config.Settings {
	if f.serve != "" {
		s.Serve = f.serve
	}
	if f.serveToken != "" {
		s.ServeToken = f.serveToken
	}
	if f.theme != "" {
		s.Theme = f.theme
	}
	for _, u := range f.webhooks {
		s.Webhooks = append(s.Webhooks, config.Webhook{URL: u})
	}
	if s.ServeToken == "" {
		s.ServeToken = os.Getenv("FERRY_TOKEN")
	}
	return s
}

func loadPairs(f *runFlags, pos []string) ([]config.Pair, config.Settings, error) {
	var pairs []config.Pair
	var settings config.Settings
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
			return nil, settings, exitErr(2)
		}
	}
	if cfgPath != "" {
		if len(pos) > 0 {
			return nil, settings, errors.New("use either --config or <source> <target>, not both")
		}
		var err error
		if pairs, settings, err = config.LoadFile(cfgPath); err != nil {
			return nil, settings, err
		}
		if f.pairName != "" {
			var keep []config.Pair
			for _, p := range pairs {
				if p.Name == f.pairName {
					keep = append(keep, p)
				}
			}
			if len(keep) == 0 {
				return nil, settings, fmt.Errorf("no pair named %q in %s", f.pairName, cfgPath)
			}
			pairs = keep
		}
	} else {
		if len(pos) != 2 {
			return nil, settings, errors.New("expected <source> <target>")
		}
		p := config.Defaults()
		p.Source, p.Target = pos[0], pos[1]
		pairs = []config.Pair{p}
	}
	for i := range pairs {
		if err := f.apply(&pairs[i]); err != nil {
			return nil, settings, err
		}
		if err := pairs[i].Normalize(); err != nil {
			return nil, settings, err
		}
	}
	return pairs, f.settings(settings), config.CheckOverlaps(pairs)
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
	pairs, settings, err := loadPairs(f, pos)
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

	notify.Enabled = !f.noNotify && !f.once && (settings.Notify == nil || *settings.Notify)

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

	// webhooks and the HTTP API see every event too
	hooks := webhook.New(settings.Webhooks)
	var apiSrv *api.Server
	if hooks != nil || (settings.Serve != "" && !f.once) {
		base := emit
		emit = func(ev engine.Event) {
			base(ev)
			hooks.Handle(ev)
			apiSrv.Broadcast(ev)
		}
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

	if settings.Serve != "" {
		apiSrv = api.New(engines, settings.ServeToken)
		go func() {
			if err := apiSrv.ListenAndServe(ctx, settings.Serve); err != nil {
				emit(engine.Event{Time: time.Now(), Kind: engine.KError, Msg: "HTTP API: " + err.Error()})
			}
		}()
	}

	if uiMode == "plain" {
		for _, p := range pairs {
			arrow, target := "→", p.Target
			if p.Mode == "two-way" {
				arrow = "⇄"
			}
			if p.Remote != "" {
				target = p.Remote
			}
			fmt.Printf("%s %s  %s %s %s\n", paint("1", "ferry "+version), paint("90", p.Name), p.Source, arrow, target)
		}
		if settings.Serve != "" {
			fmt.Println(paint("90", "HTTP API on http://"+settings.Serve))
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
		if settings.Theme != "" {
			tui.SetTheme(settings.Theme)
		}
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
	sign := fs.Bool("sign", false, "sign the commit (git commit -S)")
	author := fs.String("author", "", "commit author, \"Name <email>\"")
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
		*msg = "sync: " + engine.SummarizeStatus(lines)
	}
	hash, err := gitx.CommitAll(dir, *msg, gitx.CommitOptions{Author: *author, Sign: *sign})
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
		return errors.New("usage: ferry backups list|restore|prune <source> <target> [file]")
	}
	sub := args[0]
	fs := flag.NewFlagSet("backups", flag.ContinueOnError)
	ver := fs.Int("version", 1, "which version to restore (1 = newest)")
	to := fs.String("to", "", "restore to this path instead of the original location")
	olderThan := fs.String("older-than", "", "prune: delete versions older than this (e.g. 30d)")
	maxSize := fs.String("max-size", "", "prune: delete the oldest versions past this total per pair (e.g. 1GB)")
	pos, err := parseInterspersed(fs, args[1:])
	if err != nil {
		return exitErr(2)
	}
	if sub == "prune" {
		return backupsPrune(pos, *olderThan, *maxSize)
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
		return errors.New("usage: ferry backups list|restore|prune ...")
	}
	return nil
}

func backupsPrune(pos []string, olderThan, maxSize string) error {
	age, err := config.ParseDuration(olderThan)
	if err != nil {
		return fmt.Errorf("--older-than: %v", err)
	}
	size, err := config.ParseSize(maxSize)
	if err != nil {
		return fmt.Errorf("--max-size: %v", err)
	}
	if age <= 0 && size <= 0 {
		return errors.New("give --older-than (e.g. 30d) and/or --max-size (e.g. 1GB)")
	}
	var ids []string
	if len(pos) >= 2 {
		p := config.Defaults()
		p.Source, p.Target = pos[0], pos[1]
		if err := p.Normalize(); err != nil {
			return err
		}
		ids = []string{p.ID()}
	} else {
		entries, _ := os.ReadDir(config.DataDir())
		for _, en := range entries {
			if en.IsDir() {
				ids = append(ids, en.Name())
			}
		}
	}
	total, freed := 0, int64(0)
	for _, id := range ids {
		n, f, err := engine.PruneBackups(config.DataDir(), id, age, int64(size))
		if err != nil {
			return err
		}
		total += n
		freed += f
	}
	fmt.Printf("%s removed %d backup version(s), freed %s\n", paint("32", "✓"), total, config.HumanSize(freed))
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
			pairs, settings, err := loadPairs(f, pos)
			if err != nil {
				return err
			}
			cfg = filepath.Join(config.DataDir(), "service.yaml")
			if err := writeServiceConfig(cfg, pairs[0], settings); err != nil {
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

func writeServiceConfig(path string, p config.Pair, s config.Settings) error {
	p.DryRun = false
	doc := map[string]any{"pairs": []config.Pair{p}}
	if s.Serve != "" {
		doc["serve"] = s.Serve
	}
	if s.ServeToken != "" {
		doc["serve_token"] = s.ServeToken
	}
	if len(s.Webhooks) > 0 {
		doc["webhooks"] = s.Webhooks
	}
	data, err := yaml.Marshal(doc)
	if err != nil {
		return err
	}
	_ = os.MkdirAll(filepath.Dir(path), 0o755)
	return os.WriteFile(path, append([]byte("# generated by ferry service install\n"), data...), 0o600)
}

// ---------- conflict prompts ----------

var promptMu sync.Mutex

// askChoice prompts on the terminal. ok=false means "decide later".
func askChoice(in *bufio.Reader, e *engine.Engine, rel string) (engine.Choice, bool) {
	promptMu.Lock()
	defer promptMu.Unlock()
	for {
		fmt.Printf("\n%s %s %s changed on both sides.\n  [s] keep source  [t] keep target  [n] keep newer  [b] keep both  [m] merge  [d] diff  [l] later: ",
			paint("1;31", "conflict"), paint("90", "["+e.Name()+"]"), paint("1", rel))
		line, err := in.ReadString('\n')
		if err != nil {
			return "", false
		}
		answer := strings.ToLower(strings.TrimSpace(line))
		switch answer {
		case "d", "diff":
			printDiff(e.Diff(rel, true))
			continue
		case "l", "later", "":
			fmt.Println(paint("90", "  left as is. Resolve later with: ferry resolve "+rel+" --keep source|target|newer|both|merge"))
			return "", false
		}
		if c, ok := engine.ParseChoice(answer); ok {
			return c, true
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
	fmt.Println(paint("90", "\nresolve with: ferry resolve <file> --keep source|target|newer|both|merge   (or --all)"))
	return nil
}

func cmdResolve(args []string) error {
	fs := flag.NewFlagSet("resolve", flag.ContinueOnError)
	keep := fs.String("keep", "", "source | target | newer | both | merge")
	all := fs.Bool("all", false, "resolve every conflict (of --pair, or of all pairs)")
	pairName := fs.String("pair", "", "pair name, when files are ambiguous")
	pos, err := parseInterspersed(fs, args)
	if err != nil {
		return exitErr(2)
	}
	choice, ok := engine.ParseChoice(*keep)
	if !ok {
		return errors.New("usage: ferry resolve <file>... --keep source|target|newer|both|merge [--all] [--pair NAME]")
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
