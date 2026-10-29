# Ferry

Work in one folder, commit from another. **Ferry** watches a working folder and mirrors every change into your git repo folder. It can also sync in both directions, with conflict detection and three-way merges, or push to a server over ssh. It runs from any terminal (PowerShell, cmd, bash, zsh, fish) on Windows, macOS and Linux as a single binary with no runtime.

```
⇄ ferry 1.2.0                                              2 pair(s) · ? help · q quit
╭──────────────────────────────────────────────────────────────────────────────────────────╮
│ ▸ ● web-app  one-way · native ⎇ feature/sync  +12 ~3 -1 ↻1  last 12:01:53  watching      │
│   ! notes    two-way · native ⎇ main          +2 ~0 -0 ↻0   last 11:58:10  1 conflict    │
╰──────────────────────────────────────────────────────────────────────────────────────────╯
╭ Changed this session (4) ───────────────╮╭ Activity ───────────────────────────────────╮
│ ! doc.md  (s/t/n/b/m to resolve)        ││ 12:01:53 + → src/app/main.ts                 │
│ src/                                    ││ 12:01:53 ↻ → old.ts → new.ts                 │
│   app/                                  ││ 12:01:56 ! doc.md changed on both sides      │
│     + main.ts →                         ││ 12:02:06 ● 4072182 sync: add src/app/main.ts │
│ git ⎇ main · 3 uncommitted · 1 staged   ││                                              │
╰─────────────────────────────────────────╯╰──────────────────────────────────────────────╯
```

## Contents

- [Install](#install) · [Quick start](#quick-start)
- [Features](#features): [Sync](#sync) · [Choosing what to sync](#choosing-what-to-sync) · [Conflicts and merging](#conflicts-and-merging) · [Safety](#safety) · [History and undo](#history-and-undo) · [Git](#git) · [Remote targets over ssh](#remote-targets-over-ssh) · [Scheduling](#scheduling) · [Dashboard](#dashboard) · [Status, plan and doctor](#status-plan-and-doctor) · [Integrations](#integrations) · [Background service](#background-service)
- [Commands](#commands) · [Dashboard keys](#dashboard-keys) · [Config file](#config-file) · [Behaviour notes](#behaviour-notes)

## Install

| Platform | Command |
|---|---|
| Prebuilt binary | download the file for your OS from the [Releases](https://github.com/anupam42/Ferry/releases) page and put it on your PATH |
| macOS / Linux script | `curl -fsSL https://raw.githubusercontent.com/anupam42/Ferry/main/scripts/install.sh \| sh` |
| Windows script | `irm https://raw.githubusercontent.com/anupam42/Ferry/main/scripts/install.ps1 \| iex` |
| Homebrew | `brew install anupam42/tap/ferry` |
| Scoop | `scoop bucket add anupam42 https://github.com/anupam42/scoop-bucket; scoop install ferry` |
| winget | `winget install anupam42.ferry` |
| From source | `go build .` (Go 1.24+; dependencies are vendored, so no network is needed) |

The install scripts, Homebrew, Scoop and winget only work once a release is published (see [Releasing](#releasing)).

Shell completions: `ferry completion bash|zsh|fish|powershell` (each script says where to put it).

## Quick start

```bash
# one-way: working folder -> repo, watch with the live dashboard
ferry ./scratch ./my-repo

# two-way with conflict detection and automatic three-way merges
ferry --two-way --merge ./scratch ./my-repo

# see what would happen, then do a single pass
ferry plan --diff ./scratch ./my-repo
ferry --once ./scratch ./my-repo

# several pairs from a config file
ferry init                    # writes ferry.yaml
ferry                         # picks up ./ferry.yaml

# what's running, and is everything set up right?
ferry status
ferry doctor
```

PowerShell is the same: `ferry C:\work\scratch C:\code\my-repo --two-way`. Flags can go before or after the folders.

## Features

### Sync
- **One-way or two-way** (`--two-way`). Two-way keeps a record of the last-synced state, so it can tell "edited here" from "edited there". A file edited on both sides is a **conflict**.
- **Deletions** (`--on-delete`, default `keep`). This decides what happens when you delete a file on one side:
  - `keep`: the copy on the other side is left alone, and the file stays deleted where you deleted it. It is never copied back unless you edit the kept copy again. This works across restarts.
  - `restore` (two-way only): the file is copied back from the other side.
  - `propagate`: it is deleted on the other side too (backups are kept). `--delete` is shorthand for this.
- **Renames are synced as renames.** A delete plus an add with identical content becomes one `mv` in the target, so git shows a rename.
- **Native file events with polling as backup.** `--watcher auto` uses OS events plus a 10 s safety rescan. If events aren't available (network drives, WSL `/mnt/c`, Docker volumes, inotify limits), it switches to polling.
- **Line endings** (`--eol lf|crlf`, default `keep`). Text files written to the target get the line endings you choose, which helps between Windows and WSL or Linux checkouts. A converted file still counts as unchanged, so it isn't copied again on every pass.
- **Permissions and modified times are kept.** In one-way mode a `chmod +x` on its own (no content change) is synced too.
- **Symlinks** (`--symlinks`, default `skip`): `follow` copies the file a link points to, and `link` recreates the link itself on the other side. Links to folders are never followed, so they can't loop.
- **Hash cache.** Content hashes are cached by path, size and modified time and kept between runs, so large trees aren't re-read on every comparison. A full resync (`r`) clears the cache.
- **`--mirror`**: on start, make the target exactly match the source. It lists what it will delete and asks first; use `--yes` in scripts.
- **Multiple pairs** from `ferry.yaml`, each with its own settings.

### Choosing what to sync
- **`.gitignore` support.** It reads `.gitignore` files in the source (including nested ones) and the target. It also reads `.syncignore` files and `--ignore` globs, all in full gitignore syntax (`!negation`, `dir/`, `**`). Edits to these files apply live.
- **Include lists** (`--only "src/**" --only "*.md"`, or `only:` in the config): sync only matching paths. Excludes still apply on top.
- **Path mapping** (`map:` in the config): one entry fans out into a pair per subfolder, for example `map: {app: packages/app, docs: docs}` syncs `scratch/app` into `repo/packages/app` and `scratch/docs` into `repo/docs`. Each mapped pair is named `name/subfolder`.
- **Size limit and binary detection**: `--max-size 50MB` skips large files, and `--binary warn|skip|allow` controls binaries. The default warns when a new binary file shows up.
- **Git LFS** (`--lfs`): instead of skipping large or binary files, Ferry runs `git lfs track "*.ext"` in the target and copies them. This needs git-lfs installed.

### Conflicts and merging
- **Conflict policies.** A conflict is a file edited on both sides since the last sync.
  - `--conflict` applies when someone can be asked:
    - `ask` (default): the dashboard (`s`/`t`/`n`/`b`/`m`) or, in a plain terminal, a prompt with a `d` diff option.
    - `hold`, `source`, `target`, `newer`.
    - `keep-both`: the target version keeps the name, and the source version is saved as `name.conflict-source-<time>.ext` on both sides.
  - `--headless-conflict` applies when nobody can be asked (background service, piped output, `--json`):
    - `hold` (default): both files stay exactly as they are. You get a desktop notification, and the conflict is saved, even across restarts.
    - `keep-both`, `source`, `target`, `newer`.
- **Three-way merge** (`--merge`, two-way). Ferry keeps a copy of the last-synced version of each text file (up to 2 MB). When both sides change, it merges the two edits against that common version, like git does. If the edits don't overlap, both sides get the merged file and no conflict is raised. If they overlap, the normal conflict policy applies.
- **Merge with markers on request.** Resolving a conflict with `merge` (`m` in the dashboard, `--keep merge` on the command line) writes the merged file to both sides, with `<<<<<<< target` / `=======` / `>>>>>>> source` blocks where the edits overlap.
- **Resolve held conflicts from any terminal**, even while the service is running:
  ```bash
  ferry conflicts --diff                 # what's waiting, with diffs
  ferry resolve doc.md --keep target     # the running process applies it within ~2 s
  ferry resolve --all --keep both --pair notes
  ```
  If no ferry process is running for that pair, `resolve` applies the change itself using the pair's saved settings.

### Safety
- **Backups before every overwrite or delete.** The last 5 versions of each file are kept outside both folders (`--backups N`). Use `ferry backups list|restore <src> <dst> [file] [--version N]`.
- **Backup limits.** `--backup-max-age 30d` and `--backup-max-size 1GB` prune old versions automatically (at start and every hour). `ferry backups prune --older-than 30d --max-size 1GB [<src> <dst>]` does it by hand, for one pair or all of them.
- **Secret scanning** (`--secrets warn|block|off`, default `warn`). Before a file is copied into the target, Ferry checks its name (`.env`, `id_rsa`, `*.pem`, `*.p12`, …) and its content (private keys, AWS, GitHub, GitLab, Slack and Stripe keys, Google and `sk-…` API keys, quoted password or token assignments). `warn` notifies you and copies the file anyway. `block` skips it. Paths in `secret_allow` (gitignore globs, such as `test/fixtures/**`) are never flagged.
- **Trash** (`--trash`): deletions synced to the other side also go to the OS recycle bin (Windows), Trash (macOS) or the freedesktop trash (Linux), as well as Ferry's own backups.
- **Large-batch handling.** Bursts like `npm install` or `git checkout` wait for activity to stop before syncing: batches over `--batch-limit 200` need `--batch-settle 3s` of quiet. `--batch-action confirm` holds them until you press `y`, and `--max-ops 100` throttles file operations per second.
- **Atomic writes.** Files go to a temp file first and are then renamed. On Windows, file locks get retries.
- **Identical files are never rewritten.**
- **Loop guards.** It refuses to run if one folder is inside the other, or if two pairs share a target. `.git` is never synced.

### History and undo
- **Every sync pass is recorded**: what was added, updated, deleted or renamed, on which side, and where the backup of the old version is. The last 200 passes per pair are kept.
- `ferry history [--pair NAME] [-n 20] [--json]` lists them. In the dashboard, press `H`.
- `ferry undo` reverses the newest pass: files Ferry created are removed, overwritten or deleted files come back from their backups, and renames are reversed. It asks first (`--yes` skips the question), and `--batch ID` undoes an older pass. In the dashboard, press `u` twice in the history view.
- The versions being replaced are backed up first, so an undo can be reverted with `ferry backups restore`.
- In two-way mode the reverted files count as new edits and sync back to the other side, so both sides return to their earlier versions. In one-way mode only the target is reverted; the source keeps your edits, and they are copied again the next time the file changes or on a full resync.
- Undo needs backups (`backups` > 0) to restore updated or deleted files. It isn't available for remote (ssh) targets.

### Git
- **Commit from the dashboard**: `c` to commit, `C` to commit and push. There is also `ferry commit -m "msg" [--push] [--sign] [--author "Name <email>"] <repo>`.
- **Per-file staging**: press `a` on a file to stage or unstage it. When anything is staged, `c` commits only the staged files.
- **Generated commit messages.** The `{summary}` placeholder becomes something like `add README.md; update 3 files in src/api; delete old.txt`. `ferry commit` without `-m` uses it too.
- **Auto-commit** on a timer: `--auto-commit "sync: {summary}" --auto-commit-interval 10m --push`. Placeholders: `{summary} {count} {files} {source} {target} {pair} {date} {time} {datetime}`.
- **Checks before committing**: `--before-commit "npm test"` runs in the target before every commit (manual or automatic). If it fails, the commit is skipped and you get an error with the last lines of its output.
- **Pull before push**: `--pull-rebase` runs `git pull --rebase --autostash` before every push. If the rebase fails it is aborted and nothing is pushed.
- **Pull requests**: `--pr` opens a pull request with the `gh` CLI after pushing, unless one is already open for the branch (`--pr-base main` picks the base). Combine it with `--branch` to keep synced work on its own branch.
- **Signed commits and author**: `--sign` (git commit -S) and `--author "Sync Bot <bot@example.com>"`.
- **Branch**: `--branch feature/x` switches to the branch before syncing. If it doesn't exist, it tracks `origin/feature/x` or creates the branch.
- **Diff view**: press `d` on a file to see the target file against the last commit. On a conflict, `d` shows target against source. From the CLI: `ferry diff [--sides] <src> <dst> <file>`.
- **Pull guard**: syncing pauses automatically while the target is mid merge, rebase, cherry-pick, revert or bisect, or while `index.lock` exists. With `--check-upstream 5m` it fetches periodically and pauses while the target is behind its upstream. Add `--auto-pull` to pull with `--rebase --autostash` instead of pausing. Changes made in the meantime are applied once the repo is clear.

### Remote targets over ssh
- A target can be **`user@host:path`** or **`ssh://user@host:port/path`**: `ferry ./site deploy@example.com:/srv/site`.
- Ferry syncs into a local shadow copy (in its data folder) exactly as it would into a local folder, then streams each batch's changed files to the host as one `tar` archive over `ssh` and removes deleted files with `rm`. A failed push is retried with the next pass.
- It uses your system `ssh`, so keys, agents and `~/.ssh/config` work as usual. Ferry runs ssh with `BatchMode=yes`, so it never waits for a password; use keys. The host needs `tar` and a POSIX shell.
- If the remote folder is a git repo, the git features work over ssh too: auto-commit, push, branch, `--before-commit` (it runs on the host), and the dashboard's git panel.
- Remote targets are one-way. Full resync (`r`) re-sends every file. Changes made directly on the host aren't detected.

### Scheduling
- **Timer instead of watching**: `--every 15m` scans and syncs every 15 minutes and doesn't use a file watcher at all.
- **Sync window**: `--window 09:00-18:00` and `--days mon-fri` (also `sat,sun`, `weekdays`, `weekends`; overnight windows such as `22:00-06:00` work). Outside the window the pair shows as paused, and changes made meanwhile are applied when the window opens.

### Dashboard
- **Live screen**: a pairs panel, a tree of changed files with conflicts at the top, git status, and an activity log. Hotkeys pause, resync, approve, resolve, diff, stage and commit. Press `?` for help.
- **Filter** (`/`): type to narrow both the file tree and the activity log. `esc` clears it.
- **Open in your editor** (`e`): uses `$VISUAL` or `$EDITOR` inside the terminal, otherwise VS Code (`code -g`), otherwise the OS default app.
- **Diffs**: `v` switches between unified and side-by-side. Keywords, strings, numbers and comments are highlighted for common languages (Go, JS/TS, Python, Rust, Java, C/C++, C#, Ruby, shell, SQL, YAML and more).
- **History view** (`H`) with undo (`u`).
- **Themes**: `--theme auto|dark|light|mono` (or `theme:` in the config), and `T` cycles them live. `auto` follows the terminal background, and `mono` uses no colors.
- **Desktop notifications** on conflicts, errors, pauses, possible secrets and batches waiting for approval. They use the tools each OS already has: a Windows toast, `osascript`, or `notify-send`. Turn them off with `--no-notify`.

### Status, plan and doctor
- **`ferry status`**: every pair that has run, whether its process is still alive, its state (watching, paused, conflicts…), the time of the last sync, counts, branch, uncommitted and staged files, and held conflicts. It works while the background service runs. `--json` is meant for scripts and editors, and `--running` hides stopped pairs.
- **`ferry plan`**: a dry run that writes nothing and lists exactly what the next pass would do, as `text` (default), `markdown` or `json`. `--diff` adds a diff for each file. The Markdown output uses collapsible sections, so you can paste it into a pull request or an issue.
- **`ferry doctor`**: checks git and your git identity, optional tools (git-lfs, gh, ssh, notify-send), the data folder, held conflicts and the background service. For each pair it also checks that the source exists, that the target is a git repo, whether native file events work (with the inotify limit on Linux and `/mnt/c` inside WSL), that ssh reaches remote targets, and the sync window. Each problem comes with a fix. It exits with 1 if anything is broken.

### Integrations
- **`--json`**: NDJSON events on stdout, for scripts, CI or an editor extension:
  ```json
  {"time":"2026-10-29T12:00:58+05:30","pair":"web","kind":"add","path":"src/a.ts","direction":"→"}
  ```
- **Local HTTP API** (`--serve 127.0.0.1:7878`, or `serve:` in the config):

  | Request | Does |
  |---|---|
  | `GET /status` | every pair's status (JSON) |
  | `GET /events` | live events as server-sent events |
  | `GET /pairs/{name}/diff?path=…[&conflict=1]` | a file's diff, as text |
  | `GET /pairs/{name}/history` | recorded sync passes |
  | `POST /pairs/{name}/pause` · `resume` · `resync` · `approve` | control a pair |
  | `POST /pairs/{name}/commit?message=…&push=1` | commit (and push) the target |
  | `POST /pairs/{name}/resolve` with `{"path": "...", "choice": "source\|target\|newer\|both\|merge"}` | resolve a conflict |
  | `POST /pairs/{name}/undo` | undo the last pass |

  Without a token, the API only answers requests addressed to `localhost`, and POST requests must send an `X-Ferry` header (a web page can't send one to another site). Set `serve_token` (or `FERRY_TOKEN`) to require `Authorization: Bearer <token>`, which is also how you allow other hosts. URL-encode pair names, since mapped pairs contain `/`.
  ```bash
  curl -s localhost:7878/status
  curl -s -X POST -H 'X-Ferry: 1' 'localhost:7878/pairs/web-app/commit?message=wip&push=1'
  ```
- **Webhooks**: post conflicts, errors, pauses and commits to Slack, Discord, ntfy or any URL. The format is detected from the URL (`hooks.slack.com`, `discord.com`, `ntfy`), or set `format: slack|discord|ntfy|json`. Other URLs receive the raw event JSON. The same message is sent at most once every 10 s.
  ```yaml
  webhooks:
    - url: https://hooks.slack.com/services/XXX
      events: [conflict, error, paused, commit]   # or [all]
    - url: https://ntfy.sh/my-ferry
  ```
  From the command line: `--webhook URL` (repeatable).
- **VS Code extension** (in [`editors/vscode`](editors/vscode)): a status bar item, conflict resolution through VS Code's diff view (including merge), undo, history, a plan preview, doctor, and pause, resume, resync and commit through the HTTP API, plus pop-up notifications for conflicts and errors.

### Background service
```bash
ferry service install --config ~/ferry.yaml     # or: service install <src> <dst> --two-way
ferry service status | logs | stop | start | uninstall
```

| OS | How it runs |
|---|---|
| Linux | `systemd --user` unit |
| macOS | LaunchAgent |
| Windows | Task Scheduler logon task, with a hidden window |

No admin rights are needed. Logs go to the ferry data folder. `ferry status` shows what the service is doing, and its HTTP API and webhooks work if they are set in the config.

## Commands

| Command | |
|---|---|
| `ferry [run] [flags] <source> <target>` | sync one pair and watch (dashboard in a terminal) |
| `ferry [run] --config ferry.yaml [--pair NAME]` | sync the pairs in a config file (`ferry` alone uses `./ferry.yaml`) |
| `ferry init [file]` | write a commented sample config |
| `ferry status [--json] [--running]` | what every pair is doing |
| `ferry plan [--diff] [--format text\|markdown\|json] …` | what the next pass would do, without writing |
| `ferry commit [-m msg] [--push] [--sign] [--author A] [dir]` | commit everything in a target repo |
| `ferry diff [--sides] <source> <target> <file>` | diff a file vs HEAD (or vs the source) |
| `ferry conflicts [--diff]` | conflicts waiting for a decision |
| `ferry resolve <file>… --keep source\|target\|newer\|both\|merge [--all] [--pair NAME]` | settle conflicts |
| `ferry history [--pair NAME] [-n 20] [--json]` | recent sync passes |
| `ferry undo [--pair NAME] [--batch ID] [--yes]` | reverse a sync pass |
| `ferry backups list\|restore\|prune …` | stored versions |
| `ferry doctor [--config file \| <source> <target>]` | check the setup |
| `ferry service install\|uninstall\|start\|stop\|status\|logs` | background service |
| `ferry completion bash\|zsh\|fish\|powershell` | shell completion script |

Run `ferry run -h` for every flag.

## Dashboard keys

| Key | Action |
|---|---|
| `tab` / `shift+tab` | next / previous pair |
| `↑ ↓` `j k` | select a file |
| `/` | filter files and activity (`esc` clears) |
| `d` / `enter` | diff the selected file (`v` in the diff: side by side) |
| `e` | open the selected file in your editor |
| `s` `t` `n` `b` `m` | resolve a conflict: keep source / target / newer / both, or merge |
| | (`◇` in the file list = deleted on one side, kept on the other) |
| `a` | stage / unstage the selected file |
| `c` / `C` | commit / commit and push (only staged files, if any are staged) |
| `p` / `space` | pause or resume the pair |
| `r` | full resync (compares every file by content) |
| `y` | approve a large batch |
| `H` | history; `u` twice undoes the newest pass |
| `T` | cycle theme |
| `PgUp` `PgDn` `End` | scroll the activity log / follow it |
| `?` | help |
| `q` | quit |

## Config file

`ferry init` writes a commented example (see [`ferry.example.yaml`](ferry.example.yaml)). Every pair key can be set under `defaults:` and overridden per pair. Command-line flags override both. Durations accept `ms`, `s`, `m`, `h`, `d` and `w`.

```yaml
notify: true
theme: auto                # auto | dark | light | mono
serve: 127.0.0.1:7878      # local HTTP API (optional)
serve_token: ""            # require this bearer token
webhooks:
  - url: https://hooks.slack.com/services/XXX
    events: [conflict, error, paused, commit]

defaults:
  mode: one-way            # one-way | two-way
  on_delete: keep          # keep | restore (two-way) | propagate   (delete: true = propagate)
  conflict: ask            # when someone can be asked: ask | hold | source | target | newer | keep-both
  headless_conflict: hold  # when nobody can: hold | keep-both | source | target | newer
  merge: false             # two-way: three-way merge before calling it a conflict
  use_gitignore: true
  ignore: [dist, "*.log"]  # merged with each pair's own list
  only: []                 # include globs, e.g. ["src/**", "*.md"]
  git_guard: true
  check_upstream: 0        # e.g. 5m
  auto_pull: false
  max_size: 50MB
  binary: warn             # allow | warn | skip
  lfs: false
  secrets: warn            # warn | block | off
  secret_allow: []
  eol: keep                # keep | lf | crlf
  symlinks: skip           # skip | follow | link
  batch_limit: 200
  batch_action: apply      # apply | confirm
  batch_settle: 3s
  max_ops_per_sec: 0
  backups: 5
  backup_max_age: 0        # e.g. 30d
  backup_max_size: 0       # e.g. 1GB
  trash: false
  watcher: auto            # auto | native | poll
  interval: 500ms          # poll interval
  settle: 300ms            # quiet time before applying
  every: 0                 # e.g. 15m: timer instead of a watcher
  window: ""               # e.g. "09:00-18:00"
  days: []                 # e.g. [mon-fri]
  before_commit: ""        # e.g. "npm test"
  pull_rebase: false
  pr: false
  pr_base: ""
  sign_commits: false
  commit_author: ""
  auto_commit: {enabled: false, interval: 10m, message: "sync: {summary}", push: false}
pairs:
  - name: web-app
    source: ~/scratch/web-app     # relative paths are relative to the config file
    target: ~/code/web-app
    branch: feature/sync
  - name: notes
    source: ./notes-draft
    target: ./notes-repo
    mode: two-way
    merge: true
    on_delete: propagate
  - name: monorepo
    source: ~/scratch
    target: ~/code/monorepo
    map: {app: packages/app, docs: docs}
  - name: server
    source: ./site
    target: deploy@example.com:/srv/site
```

## Behaviour notes
- **One-way** overwrites target files that differ from the source; backups keep the old versions. Deleting a file in the source leaves the target copy alone unless `on_delete: propagate`.
- **Two-way deletions**: by default (`keep`) a deletion stays local, and the other copy is kept but not copied back. Use `restore` to copy it back, or `propagate` to delete it on both sides. Renames are synced under every setting.
- **Two-way conflicts**: nothing is ever overwritten silently by default. The dashboard or terminal asks you; without either, the conflict is held until you run `ferry resolve`. With `merge: true`, edits that don't overlap are merged without asking.
- **Data folder.** State, backups, history, the hash cache, status files, merge bases, remote shadow copies and logs live in your user cache folder (`~/.cache/ferry`, `~/Library/Caches/ferry` or `%LocalAppData%\ferry`). You can override it with `FERRY_HOME`.
- **Exit codes:** `--once` exits with 1 if any file failed, and with 3 if conflicts were left for you to resolve. `ferry doctor` exits with 1 if it finds a problem.

## Development

```
main.go, commands.go    CLI and subcommands (completion.go: shell completions)
internal/engine         sync loop: scanning, planning, two-way state, conflicts, renames, backups,
                        history/undo, secrets, eol, hash cache, ssh push, trash, plan, status files, watcher
internal/merge          line-based three-way merge (diff3)
internal/ignore         gitignore-syntax matcher
internal/config         YAML config, validation, sync windows, path mapping
internal/gitx           git CLI wrapper (status, commit, staging, branch, guard, upstream, LFS, PRs), local or over ssh
internal/remote         ssh target parsing and commands
internal/api            local HTTP API
internal/webhook        Slack / Discord / ntfy / JSON webhooks
internal/tui            Bubble Tea dashboard (diffview.go: side-by-side diffs and highlighting)
internal/ui             plain and JSON output
internal/notify         desktop notifications
internal/service        systemd / launchd / Task Scheduler
editors/vscode          VS Code extension (plain JavaScript, no build step)
```

```bash
go test -race ./...         # unit and integration tests (needs git on PATH)
./scripts/build.sh          # or .\scripts\build.ps1 — binaries for 6 platforms into dist/
```

Dependencies are vendored (`vendor/`). After changing them, run `go mod tidy && go mod vendor` with network access.

## Releasing

1. Create the GitHub repo `anupam42/Ferry` and push this folder.
2. For package managers, create these repos and secrets (skip any you don't want, and delete its section from `.goreleaser.yaml`):

   | Package manager | Repo to create | Secret |
   |---|---|---|
   | Homebrew | `anupam42/homebrew-tap` | `HOMEBREW_TAP_TOKEN` |
   | Scoop | `anupam42/scoop-bucket` | `SCOOP_BUCKET_TOKEN` |
   | winget | a fork of `microsoft/winget-pkgs` | `WINGET_TOKEN` (PR to Microsoft) |

   Each token is a PAT with `repo` scope.
3. `git tag v1.2.0 && git push --tags`. The release workflow builds every platform, attaches archives, `.deb`, `.rpm` and `.apk` packages and checksums, and updates the tap, the bucket and winget.
4. CI (`.github/workflows/ci.yml`) runs vet, race tests and a build on Ubuntu, macOS and Windows for every push and pull request.

## License

MIT
