// What the server says about folder pairs (GET /status, /pairs/{name}/…),
// shared by the server and the web app. No imports, so both can use it.

/** One rendered diff line. op is " ", "+", "-" or "@" (hunk header / note). */
export interface Line {
  op: " " | "+" | "-" | "@";
  text: string;
}

/** A file Ferry copied this session. */
export interface ChangedFile {
  path: string;
  kind: "add" | "update" | "delete" | "rename" | "kept" | "conflict" | string;
  /** "→" to the target, "←" to the working folder, "⇄" merged both ways */
  direction?: string;
  time: string;
}

/** GET /status: one per pair. */
export interface PairStatus {
  name: string;
  source: string;
  target: string;
  /** ssh or cloud target, instead of a local folder */
  remote?: string;
  mode: "one-way" | "two-way" | string;
  watcher: boolean;
  user_paused: boolean;
  guard_reason?: string;
  conflicts: string[];
  pending_batch: number;
  pending: boolean;
  comparing: { done: number; total: number } | null;
  last_sync: string;
  added: number;
  updated: number;
  deleted: number;
  renamed: number;
  skipped: number;
  failed: number;
  is_git: boolean;
  branch?: string;
  /** porcelain lines: "XY path" */
  git_status: string[] | null;
  changed: ChangedFile[];
}

/** One change inside a sync. */
export interface JournalEntry {
  op: string; // add | update | delete | rename
  side: string; // the side that was written: source | target
  path: string;
  to?: string; // rename destination
  backup?: string; // copy of the version that was replaced or deleted
}

/** One sync (GET /pairs/{name}/history). */
export interface Batch {
  id: string;
  time: string; // RFC 3339
  pair: string;
  pair_id: string;
  source: string;
  target: string;
  remote?: string;
  entries: JournalEntry[];
  undone?: boolean;
}

/** GET /pairs/{name}/stats */
export interface Stats {
  pair: string;
  batches: number;
  undone: number;
  added: number;
  updated: number;
  deleted: number;
  renamed: number;
  toTarget: number; // files written in the target
  toSource: number; // files written in the source (two-way)
  first: string; // RFC 3339, "" if no batches
  last: string;
  busiestDay: string; // YYYY-MM-DD
  busiestDayFiles: number;
  topFiles: { path: string; changes: number }[];
  perDay: { day: string; files: number }[]; // oldest first
}

/** GET /pairs/{name}/diff?format=json, and the Git client's diffs. */
export interface FileDiff {
  path?: string;
  title?: string;
  kind?: string;
  before: string;
  after: string;
  lines: Line[];
  /** lines left out of a very big diff */
  more?: number;
}

/** POST /pairs/{name}/restore (with dry_run: a preview) */
export interface RestoreResult {
  restored_to: string;
  batches: number;
  files?: string[];
  reverted?: number;
  problems?: string[];
  dry_run?: boolean;
}

/** GET /fs: a folder for the folder picker. */
export interface FolderListing {
  path: string;
  parent: string;
  home: string;
  dirs: string[];
  is_git: boolean;
  drives?: string[];
}
