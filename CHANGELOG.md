# Changelog

What changed in each version of Ferry, newest first. The web app shows this file under
Settings → Updates, and in "What's new" after an update.

How an entry is written:

- `## <version> - <YYYY-MM-DD>`, or `## <version> - Unreleased` while it's being built (the date may be left off).
  When a release is scheduled, write `## <version> - Planned <YYYY-MM-DD> <HH:MM>`: the app hangs a
  notice at the top with a countdown to it.
- A line starting with `>` right after it: the release in one sentence.
- Sections `### New`, `### Improved`, `### Fixed` and `### Breaking`.
- One change per line: `- **Title**: one or two plain sentences.` Add `[try: <place>]` to show a
  "Try it" button. Places: `git-files`, `git-changes`, `git-history`, `git-undo`, `git-prs`,
  `git-branches`, `pairs`, `settings-appearance`, `settings-updates`, `settings-about`.

## 1.3.0 - Unreleased

> Git that has your back: undo anything, a check before every push, and code reviews without leaving Ferry.

### New

- **Try something, then keep it or drop it**: "Try something…" in a folder pair's menu copies the working folder and holds syncing while you experiment. Keep it and it syncs; drop it and every file goes back as it was, with new files moved aside instead of deleted. [try: pairs]
- **Time, a tab of its own**: how long you worked on each repository, branch and Jira issue, counted from the saves Ferry synced and your commits, with no timer to forget. Charts per project and day, a ribbon of today, a standup to copy and a weekly timesheet with a CSV download.
- **A timer, when you want it exact**: start and stop it in the Time tab, mark work billable, and carry on with anything from earlier. While it runs, Ferry's own count steps aside so nothing is counted twice, and if you forgot to start it, Relay offers to start it from when you began.
- **Focus sessions**: 25 or 50 minutes counting down in a ring, with notifications held until it's over and a chime at the end.
- **Idle time**: when the saves stop while a timer runs, Relay asks whether to keep the time, drop it, or stop at your last save.
- **Edit, split and join time**: change any block's task, project, times or billable flag, split it, join it with the one before, or add time you forgot.
- **Goals**: a daily and weekly target, with progress rings next to the totals.
- **Rates and invoices**: an hourly rate and client per project, and an invoice per client and month as CSV or a page to print.
- **Jira worklogs**: send an entry's time to its issue in one click.
- **Meetings from your calendar**: paste an ICS address and meetings show next to your work, ready to log.
- **Your week**: Relay's Monday recap of last week.
- **Time per todo item and pull request**: time a todo item from the Todo tab, and see the time on each pull request's branch.
- **`ferry timer`**: start, stop and check the timer from a terminal; it also shows in the dashboard and in VS Code's status bar.
- **TODO comments in the Todo tab**: `TODO`, `FIXME`, `HACK` and `XXX` comments in a project's code are listed under "In the code", oldest first, with who wrote them and when. "Add to list" moves one into the README's list, and Relay reminds you about ones older than six months.
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

- **Rewrite recent commits**: reorder, reword, squash or drop them from a list (an interactive rebase), with no editor to fight. Commits already on the remote are marked and need a press-and-hold, and Undo anything takes you back. [try: git-history]
- **Settle conflicts change by change**: for each place two branches disagree, keep yours, theirs, both, or write it yourself, and see what it was before both changes. [try: git-changes]
- **Compare branches**: what one branch has that another doesn't, and what it changed since they split, file by file. [try: git-branches]
- **Find the commit that broke it**: say where something worked and where it's broken, test the commit Ferry checks out, and it halves the range until it names the first broken commit (git bisect). [try: git-history]

- **Public or private**: each repository shows whether it's public, private, internal or only on this computer, beside its name. GitHub through `gh` (or its public API), GitLab and Azure DevOps through their connections. [try: git-files]
- **Meet Relay**: the first time you open the web app, Relay introduces Ferry in a few short scenes: why it exists, what it does, and where things are. It opens like a film: Relay flies across the dark and lights up FERRY letter by letter, with sound (pick Voyage or Swell). Watch it again from Settings → About. [try: settings-about]
- **Todo**: a new tab with each project's todo list, read from the checklists in its README and grouped by heading. Tick items off or give them a date, right in the README, and Relay reminds you about late ones and ones left waiting.

### Improved

- **A new web app, built with Svelte**: `ferry ui` now runs a new app built with Svelte 5, TypeScript and SCSS, in place of the old single-file page. Every page moved over with the same features and your settings, and links to the old `/next` preview still work. When you reach Ferry from another computer with an access token, Relay's pictures show up now too.
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
