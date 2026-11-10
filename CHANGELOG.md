# Changelog

What changed in each version of Ferry, newest first. The web app shows this file under
Settings → Updates, and in "What's new" after an update.

How an entry is written:

- `## <version> - <YYYY-MM-DD>`, or `## <version> - Unreleased` while it's being built (the date may be left off).
- A line starting with `>` right after it: the release in one sentence.
- Sections `### New`, `### Improved`, `### Fixed` and `### Breaking`.
- One change per line: `- **Title**: one or two plain sentences.` Add `[try: <place>]` to show a
  "Try it" button. Places: `git-files`, `git-changes`, `git-history`, `git-undo`, `git-prs`,
  `git-branches`, `pairs`, `settings-appearance`, `settings-updates`, `settings-about`.

## 1.3.0 - Unreleased

> Git that has your back: undo anything, a check before every push, and code reviews without leaving Ferry.

### New

- **Undo anything**: every commit, switch, reset, rebase, merge and pull in one timeline. Go back to any of them, make a branch there, or bring back a branch you deleted. Going back can be undone too. [try: git-undo]
- **Checks before you push**: secrets, `.env` files, conflict markers, very large files and leftover `console.log` calls are caught before they leave your machine. Serious ones need a press-and-hold to push anyway.
- **Who changed what**: open any file to see who last changed each line, when, and in which commit, with newer changes glowing brighter. [try: git-files]
- **A file's history**: every commit that changed a file, followed through renames, with the diff at each step. [try: git-files]
- **Search all of history**: find commits by message, or find the commit that added or removed a piece of code. [try: git-history]
- **Read and reply to reviews**: line comments with the code they point at, replies, resolving threads and general comments, for GitHub, GitLab and Azure DevOps. [try: git-prs]
- **Remote watching**: Ferry checks the remote every couple of minutes, tells you who pushed what, and warns when it touches files you're working on.
- **Safe pull and push**: pushing pulls first when the remote moved on; pulling sets your uncommitted edits aside and puts them back.
- **Side-by-side split diff**: before and after next to each other, a divider you can drag, and a big compare window that fills the screen.
- **Pull to refresh**: pull the page down (mouse, trackpad or touch) and Relay refreshes what you're looking at.

### Improved

- **Files**: a folder-at-a-time browser with the last commit for every entry, "go to file" search, and each folder's README underneath. [try: git-files]
- **History graph**: draws itself in, with light flowing up every branch toward HEAD. [try: git-history]
- **Toolbar**: views and actions in one dock you can expand to show names, down the right or across the top. [try: settings-appearance]
- **Sidebar**: thin, regular or wide, down the left or across the top, with animated icons and Relay as the way home. [try: settings-appearance]
- **Folder pair controls**: one command bar with the status, pause, sync now and stop. [try: pairs]
- **Drawers**: drag their edge to any width, or fill the window.
- **Windows**: the folder picker shows every drive, not only C:.

### Fixed

- Pulling no longer stops when your uncommitted edits touch the same files as the incoming commits.
- Paths that start with a dot (`.github`, `.env`) no longer show the dot at the end.
- Typing a bare drive letter like `D:` in the folder picker opens that drive's top folder.

## 1.2.0

> Where this changelog starts. See the GitHub release for what 1.2.0 brought.
