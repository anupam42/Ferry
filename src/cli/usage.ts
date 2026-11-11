import { VERSION } from "./common.ts";

export const SUBCOMMANDS = [
  "run",
  "init",
  "status",
  "commit",
  "diff",
  "plan",
  "conflicts",
  "resolve",
  "history",
  "undo",
  "restore",
  "stats",
  "ui",
  "backups",
  "doctor",
  "service",
  "completion",
  "version",
  "help",
];

export function usage(): void {
  process.stdout.write(`ferry ${VERSION} — mirror a working folder into your git repo (and back)

Usage:
  ferry [run] [flags] <source> <target>        sync one pair and watch (dashboard in a terminal)
  ferry [run] [flags] <source> <t1> <t2>…      one source into several targets (one-way)
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
  ferry restore --at "2h ago" [--pair NAME] [--dry-run]   roll pairs back to a moment
  ferry stats [--pair NAME] [--since 7d] [--json]    what was synced, busiest days, top files
  ferry ui [--config file | <source> <target>] [--port 7878]   open the web app in your browser
  ferry backups list    <source> <target> [file]
  ferry backups restore <source> <target> <file> [--version N] [--to path]
  ferry backups prune   [--older-than 30d] [--max-size 1GB] [<source> <target>]
  ferry doctor [--config file | <source> <target>]   check git, watchers, service and config
  ferry service install|uninstall|start|stop|status|logs [--config file | <source> <target>]
  ferry completion bash|zsh|fish|powershell
  ferry version

Targets can be local folders, ssh (user@host:path or ssh://user@host:port/path)
or S3-compatible storage (s3://bucket/prefix; AWS, R2, MinIO, GCS interop)

Common flags (run "ferry run -h" for all):
  --two-way          sync both directions with conflict detection (--merge tries a 3-way merge)
  --on-delete keep|restore|propagate   what a deletion does to the other side (--delete = propagate)
  --only GLOB        sync only matching paths (repeatable)
  --mirror           make target match source on start
  --branch NAME      switch/create a branch in the target first
  --auto-commit MSG  commit on a timer (--auto-commit-interval 10m, --push, --pr)
  --secrets warn|block|redact|off   flag (or blank out) things that look like credentials
  --transform "GLOB=CMD"   pipe files through a formatter on the way, e.g. "*.ts=prettier --stdin-filepath {path}"
  commit messages: "{ai}" in --auto-commit or ferry commit --ai lets Claude write them
  --every 15m / --window 09:00-18:00 --days mon-fri   sync on a schedule
  --serve 127.0.0.1:7878   local HTTP API     --webhook URL   chat notifications
  --once --dry-run   one pass / preview only        --ui tui|plain|json
`);
}
