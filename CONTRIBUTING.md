# Contributing to Ferry

Thanks for helping. Bug reports, fixes, docs and new features are all welcome. This guide covers how to report problems, set up the project, and get a change merged.

By taking part you agree to be respectful and constructive: assume good intent, keep criticism about the code, and don't harass anyone. Maintainers may remove comments or block people who don't.

## Reporting a bug

Open an issue with the **Bug report** template. The most useful reports include:

- what you ran (the full `ferry …` command or your `ferry.yaml`, with private paths and tokens removed);
- what you expected and what happened instead;
- the output of `ferry version` and `ferry doctor`;
- your OS, and whether the folders are local, on a network drive, in WSL, over ssh or in cloud storage.

If files were lost or overwritten, say so in the title. Ferry keeps backups, so `ferry history` and `ferry backups list <source> <target>` usually show what happened and let you get the files back.

## Reporting a security problem

Don't open a public issue for anything that could expose files, credentials or the HTTP API to someone else. Use **Report a vulnerability** on the repository's Security tab instead. We'll reply there, fix it, and credit you if you like.

## Suggesting a feature

Open an issue with the **Feature request** template before writing a large change. Describe the problem you want solved, not only the solution: there may be an existing flag that does it, or a simpler way. Small fixes don't need an issue first. Looking for something to work on? The [roadmap](ROADMAP.md) lists ideas, and marks which ones Ferry already does.

## Setting up

You need [Bun](https://bun.sh) (the version in `.bun-version`) and git.

```bash
git clone https://github.com/anupam42/Ferry.git
cd Ferry
bun install
bun src/main.ts --help        # run from source
bun src/main.ts ui            # the web app
bun run dev                   # the web app with hot reload, for working on it
```

Before you open a pull request, run the same checks as CI:

```bash
bun run typecheck
bun test                      # needs git on PATH, with user.name and user.email set
```

CI also runs these on Ubuntu, macOS and Windows and smoke-tests a compiled binary, so your change must work on all three.

To try a change without touching your real data, point Ferry at a scratch data folder:

```bash
FERRY_HOME=/tmp/ferry-dev bun src/main.ts ./some-folder ./some-repo
```

## Finding your way around

The [Development section of the README](README.md#development) maps the source tree. In short:

- `src/engine/engine.ts` is the sync loop. Each pair has a serial task queue: timers, the watcher, the dashboard and the HTTP API queue work with `do()` / `schedule()` rather than changing state directly. Keep it that way.
- `src/config.ts` holds every pair option. A new option goes in the `Pair` type, `defaults()`, the `FIELDS` table (its YAML key), `normalize()` (validation), and usually a flag in `src/cli/runflags.ts`.
- `src/cli/` contains the commands, `src/tui/` the terminal dashboard, `src/web/index.html` the web app (one self-contained file, no build step), and `src/api.ts` the HTTP API both use. While you work on the web app, `bun run dev` (`ferry ui --dev`) keeps the browser up to date: saving `src/web/index.html` swaps in new styles without a reload, or reloads the page on the same tab and scroll position for any other change, and saving a `.ts` file restarts Ferry on the same port, after which the page reloads by itself.
- `test/` uses `bun:test`. `setup()` in `test/helpers.ts` gives you a fresh source, target and `FERRY_HOME` for each test.

## Making a change

1. Fork the repo and create a branch from `main` (`fix/rename-on-windows`, `feat/sftp-targets`).
2. Keep each pull request to one change. A refactor and a feature are easier to review as two PRs.
3. Add or update tests. Bug fixes should come with a test that failed before the fix.
4. Update the docs in the same PR when behaviour changes:
   - `README.md` (features, commands, the config reference);
   - `src/cli/usage.ts` and the flag help text;
   - `src/cli/completion.ts` for new commands, flags or values;
   - `ferry.example.yaml` and the `SAMPLE` config in `src/config.ts` for new config keys.
5. Run `bun run typecheck` and `bun test`, then open the PR and fill in the template.

### Code guidelines

- **Never lose a file.** Anything that overwrites or deletes a file must back it up first (`backupFile`) and record it in the journal, so `ferry undo` and `ferry restore` keep working. Write files atomically (`writeFileAtomic`, `copyFile`, `replaceFile`).
- **Work everywhere.** Paths inside a pair are slash-separated; convert with `fromSlash`/`toSlash` at the edges. Don't assume a case-sensitive filesystem, a POSIX shell, or that `fs.watch` events arrive.
- **Keep old data readable.** State, history and status files must stay compatible with earlier versions, including the Go version. Add fields, don't rename them.
- **Dependencies:** the compiled binary must stay self-contained. Prefer Bun and Node built-ins; discuss a new dependency in an issue first.
- **TypeScript:** strict mode, explicit `.ts` import extensions, `import type` for types. Match the style of the file you're editing.
- **Comments** explain why, not what. Exported functions get a one-line doc comment.
- **Messages people read** (errors, warnings, the dashboard, the web app) should be plain and say what to do next, e.g. `source "./x" is not a folder` rather than `ENOENT`.
- **Security:** the HTTP API only answers localhost unless a token is set, and POSTs need the `X-Ferry` header. Keep new endpoints behind the same guard, and never send file contents anywhere unless the user turned that feature on (like `{ai}` commit messages).

### Commit messages

Use a short imperative subject, optionally with a type prefix:

```
fix: keep executable bit when syncing to Windows targets
feat(web): show upload progress for cloud targets
docs: explain on_delete in the config reference
```

Explain why in the body if it isn't obvious. Reference issues with `Fixes #123`.

## Reviews and releases

A maintainer reviews every pull request. Expect questions; they're about the change, not about you. When CI is green and the review is approved, a maintainer merges it, usually as a squash commit. Releases are cut from `main` by pushing a version tag (see [Releasing](README.md#releasing)), and notable changes are listed in the release notes.

## License

Ferry is [MIT licensed](LICENSE). By contributing, you agree that your contributions are released under the same license.
