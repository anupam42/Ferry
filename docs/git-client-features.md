# Using Ferry as your Git client

A checklist of what a desktop Git client does, based on GitHub Desktop (3.6, June 2026), with what GitLab offers and what Ferry does today. It shows what Ferry would need before it could replace GitHub Desktop for everyday personal use.

GitLab doesn't make a desktop app. Its users work in the web interface (and the Web IDE) or in a third-party client, so the GitLab column describes the website.

> **Update, 9 November 2026:** Ferry now has a Git client: the **Git** button in `ferry ui`. It covers cloning and creating repositories, commit history, branches, fetch / pull / push, committing single lines, discard, stash, amend and undo, merging with conflict help, your pull requests and their checks, cherry-pick, revert, tags and worktrees. The tables below describe Ferry before that, and are kept for comparison.

**Legend:** ✅ yes · 🟡 partly (the note says how) · ❌ no

## Getting a repository

| Feature | GitHub Desktop | GitLab (web) | Ferry today |
|---|---|---|---|
| Clone a repository from GitHub / GitLab | ✅ pick from your account | ✅ shows the clone URL | ❌ |
| Create a new repository | ✅ local, then publish | ✅ on the website | ❌ |
| Add an existing local repository | ✅ | – | 🟡 only as the target of a folder pair |
| Several repositories in one window | ✅ repository switcher | ✅ | ✅ one pair per repository |
| Sign in to GitHub / GitLab accounts | ✅ GitHub.com and Enterprise | ✅ | ❌ uses your system git and `gh` |

## Seeing what changed

| Feature | GitHub Desktop | GitLab (web) | Ferry today |
|---|---|---|---|
| List of changed files | ✅ | ✅ in merge requests | ✅ Commit tab, dashboard git panel |
| Diff of a file against the last commit | ✅ | ✅ | ✅ change story (plain words, word-level highlights, change map) |
| Split and unified diff | ✅ | ✅ | ✅ Story and Classic views; side by side in the terminal |
| Image diffs | ✅ | ✅ | ❌ |
| Hide whitespace changes | ✅ | ✅ | ❌ |
| Syntax highlighting in diffs | ✅ | ✅ | 🟡 terminal dashboard only |
| Explain a change in plain words | ❌ | ❌ | ✅ Relay's summary in the change story |

## Committing

| Feature | GitHub Desktop | GitLab (web) | Ferry today |
|---|---|---|---|
| Commit everything | ✅ | ✅ Web IDE | ✅ web app, dashboard (`c`), `ferry commit` |
| Choose which files to commit | ✅ checkboxes | ✅ | 🟡 dashboard only (`a` stages a file) |
| Commit only some lines of a file | ✅ select lines or hunks | ❌ | ❌ |
| AI-written commit message | ✅ Copilot | 🟡 GitLab Duo, paid | ✅ `{ai}` with your Anthropic key |
| Co-authors | ✅ | ✅ | ❌ |
| Amend the last commit | ✅ | ❌ | ❌ |
| Undo the last commit (keep the changes) | ✅ | ❌ | ❌ (Ferry's undo reverts syncs, not commits) |
| Signed commits | ✅ via your git config | ✅ | ✅ `--sign` |
| Run checks before committing | ❌ | ✅ CI pipelines | ✅ `before_commit` |
| Auto-commit on a timer | ❌ | ❌ | ✅ `auto_commit` |
| Discard changes to a file | ✅ | ❌ | ❌ |
| Stash changes | ✅ | ❌ | ❌ |

## Branches and history

| Feature | GitHub Desktop | GitLab (web) | Ferry today |
|---|---|---|---|
| Create, switch, rename and delete branches | ✅ | ✅ | 🟡 switches to (or creates) one branch per pair via `branch:` |
| Commit history (git log) with diffs | ✅ | ✅ | ❌ (Ferry's history is its sync passes) |
| Compare two branches | ✅ | ✅ | ❌ |
| Merge a branch | ✅ | ✅ through merge requests | ❌ |
| Rebase, squash and reorder commits | ✅ drag and drop | 🟡 squash on merge | ❌ |
| Cherry-pick | ✅ drag a commit onto a branch | ✅ | ❌ |
| Revert a commit | ✅ | ✅ | ❌ |
| Tags | ✅ create and push | ✅ | ❌ |
| Git worktrees | ✅ new in 3.6 | – | ❌ |
| Git LFS | ✅ | ✅ | ✅ `lfs: true` tracks large and binary files |

## Syncing with the remote

| Feature | GitHub Desktop | GitLab (web) | Ferry today |
|---|---|---|---|
| Fetch, pull and push | ✅ | – | 🟡 push after commit, `pull_rebase` before pushing, `auto_pull` |
| "Behind the remote" warning | ✅ | ✅ | ✅ `check_upstream` pauses syncing while behind |
| Publish a branch | ✅ | – | 🟡 push sets it up |
| Merge conflict help | ✅ open in editor; Copilot help in 3.6 | ✅ in the browser for simple conflicts | 🟡 pauses during merges and rebases; conflict tools are for sync conflicts, not git merges |
| Never sync while a merge or rebase is in progress | – | – | ✅ git guard |

## Pull requests and reviews

| Feature | GitHub Desktop | GitLab (web) | Ferry today |
|---|---|---|---|
| Create a pull / merge request | ✅ opens the browser with a preview | ✅ | ✅ `--pr` opens one with `gh` |
| See your open pull requests | ✅ | ✅ | ❌ |
| Check out someone's pull request | ✅ | 🟡 shows the commands | ❌ |
| CI check status, and re-running checks | ✅ | ✅ pipelines | ❌ |
| Notifications for reviews and failed checks | ✅ | ✅ | 🟡 desktop and chat notifications for Ferry's own events |

## Everyday comfort

| Feature | GitHub Desktop | GitLab (web) | Ferry today |
|---|---|---|---|
| Open in your editor, terminal or file manager | ✅ | – | 🟡 dashboard opens files in your editor |
| Dark and light themes | ✅ | ✅ | ✅ web app and dashboard |
| Edit `.gitignore` | ✅ repository settings | ✅ | 🟡 "Ignore" button writes `.syncignore` |
| Edit name and email, remotes | ✅ | ✅ | ❌ (`ferry doctor` checks your git identity) |
| Works in a terminal | ❌ | ❌ | ✅ dashboard, plain output and every command |
| Keep a working folder and a repository in sync | ❌ | ❌ | ✅ Ferry's main job: one way, both ways, ssh, cloud |

## What Ferry would need for everyday personal use

Ferry is built around a *pair*: a working folder copied into a repository. To act as your everyday Git client it needs a way to open a repository on its own, plus the core Git actions. In rough order of how often you'd use them:

1. **Repository-only pairs.** Open a repository with no working folder to sync from, so Ferry is just the Git client for it.
2. **Commit history**, with each commit's diff shown as a change story.
3. **Branch management:** create, switch, rename and delete from the web app.
4. **Fetch, pull and push buttons**, and an "ahead / behind" indicator.
5. **Choosing files, and lines, to commit** in the web app: checkboxes per file, then per change card.
6. **Discard changes and stash**, both with Relay's confirmation prompt.
7. **Amend and undo the last commit.**
8. **Merge, and git merge conflict resolution** using the existing conflict view.
9. **Your pull requests and their checks** (through the `gh` CLI, which Ferry already uses).
10. **Cherry-pick, revert, tags and worktrees.**

Items 1–4 alone would cover most day-to-day use.

---

*Sources: [GitHub Desktop 3.6 changelog](https://github.blog/changelog/2026-06-26-github-desktop-3-6-worktrees-and-deeper-copilot-integration/) (worktrees, Copilot conflict help), [GitHub Desktop 3.5 changelog](https://github.blog/changelog/2025-06-24-github-desktop-3-5-github-copilot-commit-message-generation-now-generally-available) (Copilot commit messages), [GitHub Desktop releases](https://releases.sh/github/github-desktop.md). Other GitHub Desktop and GitLab features are long-standing and listed from their documentation; check the apps for recent changes.*
