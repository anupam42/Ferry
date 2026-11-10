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

export interface CommitDetail extends Commit {
  body: string;
  files: { path: string; from?: string; status: string; added: number; removed: number }[];
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
export interface BranchList { local: Branch[]; remote: { name: string; date: string; subject: string }[] }
/** GET /git/{id}/stashes */
export interface Stash { ref: string; message: string; when: string; branch: string }
/** GET /git/{id}/tags */
export interface Tag { name: string; commit: string; date: string; message: string }
/** GET /git/{id}/worktrees */
export interface Worktree { path: string; branch: string; head: string; main: boolean; locked: boolean; detached: boolean }
