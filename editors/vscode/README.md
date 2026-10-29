# Ferry for VS Code

Shows what [Ferry](https://github.com/anupam42/Ferry) is doing and lets you act on it without leaving the editor.

- **Status bar**: syncing / paused / conflicts, refreshed every few seconds from `ferry status --json`.
- **Resolve conflicts**: opens VS Code's diff (target ↔ source), then keep source, target, newer, both, or a three-way merge.
- **Undo last sync**, **sync history**, **plan preview** (rendered Markdown with diffs), **doctor**.
- **Pause, resume, resync, commit, commit and push**: these go through Ferry's local HTTP API, so start Ferry with `--serve 127.0.0.1:7878` or put `serve: 127.0.0.1:7878` in `ferry.yaml`.
- **Live notifications** for conflicts and errors (also through the API).

## Install

There is no marketplace build yet. From this folder:

```bash
npx @vscode/vsce package      # creates ferry-sync-0.1.0.vsix
code --install-extension ferry-sync-0.1.0.vsix
```

Or copy this folder to `~/.vscode/extensions/anupam42.ferry-sync-0.1.0` and reload VS Code.

## Settings

| Setting | Default | |
|---|---|---|
| `ferry.path` | `ferry` | path to the binary |
| `ferry.apiUrl` | `http://127.0.0.1:7878` | where `ferry --serve` listens |
| `ferry.apiToken` | | token, if Ferry runs with `serve_token` |
| `ferry.pollSeconds` | `3` | status refresh interval |
| `ferry.notifications` | `true` | pop up conflicts and errors |
