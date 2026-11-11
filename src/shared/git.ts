// What the server says about git repositories (GET /git/…), shared by the
// server and the web app. No imports, so both can use it.

/** A repository in the list (GET /git/repos). */
export interface RepoEntry {
  id: string;
  name: string;
  path: string;
  /** folder pairs that sync into it */
  pairs: string[];
  /** opened directly (it can be removed from the list) */
  standalone: boolean;
}

export interface FileChange {
  path: string;
  from?: string; // rename source
  x: string; // index status (porcelain X)
  y: string; // work tree status (porcelain Y)
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  conflicted: boolean;
}

export interface RepoState {
  root: string;
  branch: string; // "" when detached
  head: string; // short commit id, "" before the first commit
  detached: boolean;
  upstream: string;
  ahead: number;
  behind: number;
  operation: "" | "merge" | "rebase" | "cherry-pick" | "revert";
  operationBranch: string; // what is being merged, when known
  files: FileChange[];
  stashes: number;
  remotes: string[];
  lastCommit: { subject: string; hash: string; pushed: boolean } | null;
}

/** GET /git/{id}/state adds the list entry's details. */
export type RepoStateResponse = RepoState & { name: string; pairs: string[]; standalone: boolean };

export interface IncomingCommit {
  hash: string;
  short: string;
  subject: string;
  author: string;
  date: string;
  files: string[];
}

export interface RemoteCheck {
  upstream: string; // "" when the branch doesn't track anything
  fetched: boolean; // this call talked to the remote
  error: string; // why the fetch failed (offline, no access…), "" if it worked
  ahead: number;
  behind: number;
  incoming: IncomingCommit[]; // newest first, at most 30
  overlap: string[]; // files changed both by incoming commits and by you (uncommitted or unpushed)
}

/** GET /git/{id}/remote-check adds when the remote was last asked. */
export type RemoteCheckResponse = RemoteCheck & { checkedAt: string };

export interface PushIssue {
  level: "block" | "warn";
  kind: "secret" | "env-file" | "conflict-marker" | "large-file" | "debug";
  file: string;
  line: number; // 0 when it's about the whole file
  text: string; // what was found, short
  commit: string; // short id of the commit that added it
}

export interface Commit {
  hash: string;
  short: string;
  parents: string[];
  author: string;
  email: string;
  date: string;
  subject: string;
  refs: string[];
  /** the first line of the message body (a merged pull request's title, say) */
  note?: string;
  /** true for the commit HEAD points at */
  head?: boolean;
}

/** One file a commit (or a comparison) changed: A, M, D, R or C, and its line counts. */
export interface CommitFile {
  path: string;
  from?: string;
  status: string;
  added: number;
  removed: number;
}

export interface CommitDetail extends Commit {
  body: string;
  files: CommitFile[];
}

/** GET /git/{id}/compare: what head has that base doesn't, and the other way round. */
export interface Comparison {
  base: string;
  head: string;
  /** where they split ("" when they share no history) */
  mergeBase: string;
  /** commits on head that base doesn't have, newest first (at most 200) */
  ahead: Commit[];
  aheadCount: number;
  /** commits on base that head doesn't have, newest first (at most 200) */
  behind: Commit[];
  behindCount: number;
  /** what head changed since they split (the three-dot diff, like a pull request) */
  files: CommitFile[];
}

export interface Branch {
  name: string;
  current: boolean;
  upstream: string;
  ahead: number;
  behind: number;
  gone: boolean;
  date: string;
  subject: string;
}

/** GET /git/{id}/branches */
export interface BranchList {
  local: Branch[];
  remote: { name: string; date: string; subject: string }[];
}
/** GET /git/{id}/stashes */
export interface Stash {
  ref: string;
  message: string;
  when: string;
  branch: string;
}
/** GET /git/{id}/tags */
export interface Tag {
  name: string;
  commit: string;
  date: string;
  message: string;
}
/** GET /git/{id}/worktrees */
export interface Worktree {
  path: string;
  branch: string;
  head: string;
  main: boolean;
  locked: boolean;
  detached: boolean;
}

export interface ReflogEntry {
  hash: string;
  short: string;
  selector: string; // HEAD@{n}
  date: string;
  action: string; // "commit", "rebase (finish)", "reset", "checkout", "merge feature", …
  detail: string; // the rest of git's note, e.g. "moving from main to feature"
  subject: string; // the commit's own message
  current: boolean;
}

export interface LostBranch {
  name: string;
  hash: string;
  short: string;
  subject: string;
  date: string; // when you last left it
}

export interface BlameChunk {
  start: number; // first line, 1-based
  lines: string[];
  hash: string;
  short: string;
  author: string;
  date: string;
  subject: string;
  uncommitted: boolean;
}

export interface FileVersion {
  hash: string;
  short: string;
  author: string;
  date: string;
  subject: string;
  path: string; // the file's name at that commit (it may have been renamed since)
  status: string; // A, M, D, R…
  added: number;
  removed: number;
}

export interface FolderEntry {
  name: string;
  path: string;
  dir: boolean;
  size: number | null; // files only, from the working tree
  commit: { hash: string; short: string; subject: string; author: string; date: string } | null; // last commit that touched it
}

export interface FileContent {
  path: string;
  size: number;
  text: string;
  binary: boolean;
  tooBig: boolean;
}

/** GET /git/{id}/folder */
export interface FolderListing {
  dir: string;
  entries: FolderEntry[];
}
/** GET /git/{id}/blame */
export interface Blame {
  path: string;
  chunks: BlameChunk[];
  truncated: boolean;
}
/** GET /git/{id}/undo-timeline */
export interface UndoTimeline {
  entries: ReflogEntry[];
  lost: LostBranch[];
  branch: string;
}

export interface PullRequest {
  number: number;
  title: string;
  branch: string;
  base: string;
  author: string;
  draft: boolean;
  url: string;
  updated: string;
  review: string; // APPROVED | CHANGES_REQUESTED | REVIEW_REQUIRED | ""
  checks: { passed: number; failed: number; pending: number; items: { name: string; state: string; url: string }[] }; // check state: passed | failed | pending
}

export interface ReviewComment {
  id: string;
  author: string;
  body: string; // markdown
  date: string;
  mine: boolean;
}

export interface SnippetLine {
  op: " " | "+" | "-";
  no: number | null; // line number in the new file (old file for removed lines)
  text: string;
  target: boolean; // the line the comment is on
}

export interface ReviewThread {
  id: string;
  path: string;
  line: number | null;
  resolved: boolean;
  outdated: boolean; // the code it pointed at has changed since
  canResolve: boolean;
  snippet: SnippetLine[];
  comments: ReviewComment[];
}

export interface Review {
  author: string;
  state: string; // APPROVED | CHANGES_REQUESTED | COMMENTED | …
  body: string;
  date: string;
}

export interface Conversation {
  provider: "GitHub" | "GitLab" | "Azure DevOps";
  number: number;
  title: string;
  url: string;
  body: string;
  author: string;
  state: string;
  branch: string;
  base: string;
  subjectId: string; // what a new general comment attaches to
  me: string;
  comments: ReviewComment[]; // the general conversation, oldest first
  reviews: Review[];
  threads: ReviewThread[];
}

export interface Issue {
  key: string;
  summary: string;
  status: string;
  category: string; // "new" | "indeterminate" | "done"
  type: string;
  priority: string;
  updated: string;
  url: string;
}

/** GET /git/{id}/prs */
export interface PullRequestList {
  provider: string;
  items: PullRequest[];
}
/** GET /git/{id}/issues */
export interface IssueList {
  site: string;
  issues: Issue[];
}

// ---------- insights: heatmaps of commits and files ----------

export interface Insights {
  /** the day the year ends on (today, in this computer's time zone), YYYY-MM-DD */
  today: string;
  /** commits per author-local day, YYYY-MM-DD → count */
  days: Record<string, number>;
  /** a few commits per day, newest first, for "what happened that day" */
  dayCommits: Record<string, { hash: string; short: string; subject: string; author: string }[]>;
  /** commits by weekday (0 = Monday) and hour (0–23, in the author's own time zone) */
  hours: number[][];
  /** the last 12 months, oldest first, YYYY-MM */
  months: string[];
  /** the files changed in the most commits, with commits per month (same order as months) */
  files: { path: string; commits: number; added: number; removed: number; months: number[] }[];
  authors: { name: string; email: string; commits: number }[];
  /** files by how often they change against how big they are now (lines), for the hotspot chart */
  hotspots: { path: string; commits: number; lines: number; authors: number }[];
  /** pairs of files that keep landing in the same commits */
  together: { a: string; b: string; count: number; share: number }[];
  me: string;
  total: number;
  added: number;
  removed: number;
  activeDays: number;
  streak: number;
  longestStreak: number;
  /** true when the year had more commits than were read */
  partial: boolean;
}

/** GET /git/{id}/insights: Insights, plus Ferry's own record of syncs into this repository (null when no pair syncs here) */
export interface InsightsResponse extends Insights {
  sync: { pairs: string[]; days: Record<string, number>; since: string } | null;
}

// ---------- shape my history: the syncs since the last commit, made into commits ----------

/** One sync, as the timeline shows it. */
export interface ShapeBatch {
  id: string;
  pair: string;
  time: string;
  files: { path: string; op: "add" | "update" | "delete" }[];
}

export interface ShapeTimeline {
  /** the commit the shaped commits go on top of ("" for a repository with no commits yet) */
  head: string;
  branch: string;
  /** when that commit was made, so the timeline starts there */
  since: string;
  batches: ShapeBatch[];
  /** changed files Ferry didn't write (edited in the repository directly): they stay uncommitted */
  unrecorded: string[];
  /** pairs that sync into this repository */
  pairs: string[];
}

/** POST /git/{id}/shape-commit */
export interface ShapeResult {
  commits: { hash: string; message: string; files: number }[];
  skipped: number;
}
