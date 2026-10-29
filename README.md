# Ferry

Work in one folder, commit from another. **Ferry** watches a working folder and mirrors every change into your git repo folder. It can also sync in both directions, with conflict detection. It runs from any terminal (PowerShell, cmd, bash, zsh, fish) on Windows, macOS and Linux as a single binary with no runtime.

```
⇄ ferry 1.0.0                                              2 pair(s) · ? help · q quit
╭──────────────────────────────────────────────────────────────────────────────────────────╮
│ ▸ ● web-app  one-way · native ⎇ feature/sync  +12 ~3 -1 ↻1  last 12:01:53  watching      │
│   ! notes    two-way · native ⎇ main          +2 ~0 -0 ↻0   last 11:58:10  1 conflict(s) │
╰──────────────────────────────────────────────────────────────────────────────────────────╯
╭ Changed this session (4) ───────────────╮╭ Activity ───────────────────────────────────╮
│ ! doc.md  (s/t/n/b to resolve)          ││ 12:01:53 + → src/app/main.ts                 │
│ src/                                    ││ 12:01:53 ↻ → old.ts → new.ts                 │
│   app/                                  ││ 12:01:56 ! doc.md changed on both sides      │
│     + main.ts →                         ││ 12:02:06 ● 4072182 my dashboard commit       │
│ git ⎇ main · 3 uncommitted  c commit    ││                                              │
╰─────────────────────────────────────────╯╰──────────────────────────────────────────────╯
```

## Install

| Platform | Command |
|---|---|
| Prebuilt binary | grab the file for your OS from `dist/` and put it on your PATH |
| macOS / Linux script | `curl -fsSL https://raw.githubusercontent.com/anupam42/Ferry/main/scripts/install.sh \| sh` |
| Windows script | `irm https://raw.githubusercontent.com/anupam42/Ferry/main/scripts/install.ps1 \| iex` |
| Homebrew | `brew install anupam42/tap/ferry` |
| Scoop | `scoop bucket add anupam42 https://github.com/anupam42/scoop-bucket; scoop install ferry` |
| winget | `winget install anupam42.ferry` |
| From source | `go build .` (Go 1.24+; dependencies are vendored, so no network is needed) |

The install scripts, Homebrew, Scoop and winget only work once you publish a release (see [Releasing](#releasing)).

## Quick start

```bash
# one-way: working folder -> repo, watch with the live dashboard
ferry ./scratch ./my-repo

# two-way with conflict detection, deletions mirrored to the other side
ferry --two-way --on-delete propagate ./scratch ./my-repo

# preview, then do a single pass
ferry --once --dry-run ./scratch ./my-repo
ferry --once ./scratch ./my-repo

# several pairs from a config file
ferry init                    # writes ferry.yaml
ferry                         # picks up ./ferry.yaml
```

PowerShell is the same: `ferry C:\work\scratch C:\code\my-repo --two-way`. Flags can go before or after the folders.

## Features

### Sync
- **One-way or two-way** (`--two-way`). Two-way keeps a record of the last-synced state, so it can tell "edited here" from "edited there". A file edited on both sides is a **conflict**.
- **Deletions** (`--on-delete`, default `keep`). This decides what happens when you delete a file on one side:
  - `keep` — the copy on the other side is left alone, and the file stays deleted where you deleted it. It is never copied back unless you edit the kept copy again. This works across restarts.
  - `restore` (two-way only) — the file is copied back from the other side.
  - `propagate` — it is deleted on the other side too (backups are kept). `--delete` is shorthand for this.
- **Conflict policies.** A conflict is a file edited on both sides since the last sync.
  - `--conflict` applies when someone can be asked:
    - `ask` (default) — the dashboard (`s`/`t`/`n`/`b`) or, in a plain terminal, a prompt with a `d` diff option.
    - `hold`, `source`, `target`, `newer`.
    - `keep-both` — the target version keeps the name, and the source version is saved as `name.conflict-source-<time>.ext` on both sides.
  - `--headless-conflict` applies when nobody can be asked (background service, piped output, `--json`):
    - `hold` (default) — both files stay exactly as they are. You get a desktop notification, and the conflict is saved, even across restarts.
    - `keep-both`, `source`, `target`, `newer`.
- **Resolve held conflicts from any terminal**, even while the service is running:
  ```bash
  ferry conflicts --diff                 # what's waiting, with diffs
  ferry resolve doc.md --keep target     # the running process applies it within ~2 s
  ferry resolve --all --keep both --pair notes
  ```
  If no ferry process is running for that pair, `resolve` applies the change itself using the pair's saved settings.
- **Native file events with polling as backup.** `--watcher auto` uses OS events plus a 10 s safety rescan. If events aren't available (network drives, WSL `/mnt/c`, Docker volumes, inotify limits), it switches to polling.
- **Multiple pairs** from `ferry.yaml`, each with its own settings.
- **`.gitignore` support.** It reads `.gitignore` files in the source (including nested ones) and the target. It also reads `.syncignore` files and `--ignore` globs, all in full gitignore syntax (`!negation`, `dir/`, `**`). Edits to these files apply live.
- **Renames are synced as renames.** A delete plus an add with identical content becomes one `mv` in the target, so git shows a rename.
- **`--mirror`**: on start, make the target exactly match the source. It lists what it will delete and asks first; use `--yes` in scripts.

### Git
- **Commit from the dashboard**: `c` to commit, `C` to commit and push. There is also `ferry commit -m "msg" [--push] <repo>`.
- **Auto-commit** on a timer: `--auto-commit "sync: {count} file(s) from {source}" --auto-commit-interval 10m --push`. Placeholders: `{count} {files} {source} {target} {pair} {date} {time} {datetime}`.
- **Branch**: `--branch feature/x` switches to the branch before syncing. If it doesn't exist, it tracks `origin/feature/x` or creates the branch.
- **Diff view**: press `d` on a file to see the target file against the last commit. On a conflict, `d` shows target against source. From the CLI: `ferry diff [--sides] <src> <dst> <file>`.
- **Pull guard**: syncing pauses automatically while the target is mid merge, rebase, cherry-pick, revert or bisect, or while `index.lock` exists. With `--check-upstream 5m` it fetches periodically and pauses while the target is behind its upstream. Changes made in the meantime are applied once the repo is clear.

### Dashboard
- **Live screen**: a pairs panel, a tree of changed files with conflicts at the top, git status, and an activity log. Hotkeys pause, resync, approve, resolve, diff and commit. Press `?` for help.
- **Desktop notifications** on conflicts, errors, pauses and batches waiting for approval. They use the tools each OS already has: a Windows toast, `osascript`, or `notify-send`. Turn them off with `--no-notify`.
- **`--json`**: NDJSON events on stdout, for scripts, CI or an editor extension:
  ```json
  {"time":"2026-10-29T12:00:58+05:30","pair":"web","kind":"add","path":"src/a.ts","direction":"→"}
  ```

### Safety and scale
- **Backups before every overwrite or delete.** The last 5 versions of each file are kept outside both folders (`--backups N`). Use `ferry backups list|restore <src> <dst> [file] [--version N]`.
- **Size limit and binary detection**: `--max-size 50MB` skips large files, and `--binary warn|skip|allow` controls binaries. The default warns when a new binary file shows up.
- **Large-batch handling.** Bursts like `npm install` or `git checkout` wait for activity to stop before syncing: batches over `--batch-limit 200` need `--batch-settle 3s` of quiet. `--batch-action confirm` holds them until you press `y`, and `--max-ops 100` throttles file operations per second.
- **Atomic writes.** Files go to a temp file first and are then renamed. On Windows, file locks get retries.
- **Identical files are never rewritten.**
- **Loop guards.** It refuses to run if one folder is inside the other, or if two pairs share a target. `.git` is never synced.

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

No admin rights are needed. Logs go to the ferry data folder.

## Dashboard keys

| Key | Action |
|---|---|
| `tab` / `shift+tab` | next / previous pair |
| `↑ ↓` `j k` | select a file |
| `d` / `enter` | diff the selected file |
| `s` `t` `n` `b` | resolve a conflict: keep source / target / newer / both |
| | (`◇` in the file list = deleted on one side, kept on the other) |
| `p` / `space` | pause or resume the pair |
| `r` | full resync (compares every file by content) |
| `y` | approve a large batch |
| `c` / `C` | commit / commit and push |
| `PgUp` `PgDn` `End` | scroll the activity log / follow it |
| `?` | help |
| `q` | quit |

## Config file

`ferry init` writes a commented example (see `ferry.example.yaml`). Every key can be set under `defaults:` and overridden per pair. Command-line flags override both.

```yaml
notify: true
defaults:
  mode: one-way            # one-way | two-way
  on_delete: keep          # keep | restore (two-way) | propagate   (delete: true = propagate)
  conflict: ask            # when someone can be asked: ask | hold | source | target | newer | keep-both
  headless_conflict: hold  # when nobody can: hold | keep-both | source | target | newer
  use_gitignore: true
  ignore: [dist, "*.log"]  # merged with each pair's own list
  git_guard: true
  check_upstream: 0        # e.g. 5m
  max_size: 50MB
  binary: warn             # allow | warn | skip
  batch_limit: 200
  batch_action: apply      # apply | confirm
  batch_settle: 3s
  max_ops_per_sec: 0
  backups: 5
  watcher: auto            # auto | native | poll
  interval: 500ms          # poll interval
  settle: 300ms            # quiet time before applying
  auto_commit: {enabled: false, interval: 10m, message: "sync: {count} file(s)", push: false}
pairs:
  - name: web-app
    source: ~/scratch/web-app     # relative paths are relative to the config file
    target: ~/code/web-app
    branch: feature/sync
  - name: notes
    source: ./notes-draft
    target: ./notes-repo
    mode: two-way
    on_delete: propagate
```

## Behaviour notes
- **One-way** overwrites target files that differ from the source; backups keep the old versions. Deleting a file in the source leaves the target copy alone unless `on_delete: propagate`.
- **Two-way deletions**: by default (`keep`) a deletion stays local, and the other copy is kept but not copied back. Use `restore` to copy it back, or `propagate` to delete it on both sides. Renames are synced under every setting.
- **Two-way conflicts**: nothing is ever overwritten silently by default. The dashboard or terminal asks you; without either, the conflict is held until you run `ferry resolve`.
- **Symlinks are skipped.** State, backups and logs live in your user cache folder (`~/.cache/ferry`, `~/Library/Caches/ferry` or `%LocalAppData%\ferry`). You can override it with `FERRY_HOME`.
- **Exit codes:** `--once` exits with 1 if any file failed, and with 3 if conflicts were left for you to resolve.

## Development

```
main.go                 CLI and subcommands
internal/engine         sync loop: scanning, planning, two-way state, conflicts, renames, backups, watcher
internal/ignore         gitignore-syntax matcher
internal/config         YAML config and validation
internal/gitx           git CLI wrapper (status, commit, branch, guard, upstream)
internal/tui            Bubble Tea dashboard
internal/ui             plain and JSON output
internal/notify         desktop notifications
internal/service        systemd / launchd / Task Scheduler
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
3. `git tag v1.0.0 && git push --tags`. The release workflow builds every platform, attaches archives, `.deb`, `.rpm` and `.apk` packages and checksums, and updates the tap, the bucket and winget.
4. CI (`.github/workflows/ci.yml`) runs vet, race tests and a build on Ubuntu, macOS and Windows for every push and pull request.

## License

MIT
