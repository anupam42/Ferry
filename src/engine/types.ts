import { plural } from "../util.ts";

/** What an Event is about. */
export type Kind =
  | "info" | "add" | "update" | "delete" | "rename" | "conflict" | "resolved" | "skip"
  | "warn" | "error" | "synced" | "paused" | "resumed" | "git" | "commit"
  | "kept"; // deleted on one side, intentionally kept on the other

/** What the engine reports to the UI, logs and JSON output. */
export interface Event {
  time: number; // ms since epoch
  pair: string;
  kind: Kind;
  path?: string;
  to?: string; // rename destination / conflict copy
  dir?: string; // "→" source→target, "←" target→source, "⇄" both
  msg?: string;
  lines?: string[]; // git status lines
  dryRun?: boolean;
  held?: boolean; // the conflict is waiting for a decision
}

/** Events as JSON, with the same field names the Go version used. */
export function eventJSON(ev: Event): Record<string, unknown> {
  const o: Record<string, unknown> = { time: new Date(ev.time).toISOString(), pair: ev.pair, kind: ev.kind };
  if (ev.path) o.path = ev.path;
  if (ev.to) o.to = ev.to;
  if (ev.dir) o.direction = ev.dir;
  if (ev.msg) o.message = ev.msg;
  if (ev.lines && ev.lines.length) o.lines = ev.lines;
  if (ev.dryRun) o.dry_run = true;
  if (ev.held) o.held = true;
  return o;
}

/** A file touched this session (for the dashboard tree). */
export interface ChangedFile {
  path: string;
  kind: Kind;
  dir: string;
  time: number;
}

/** A point-in-time snapshot of a pair for the dashboard and the API. */
export interface Status {
  name: string;
  source: string;
  target: string;
  remote: string;
  mode: string;
  watcher: string;

  userPaused: boolean;
  guardReason: string; // set while auto-paused (merge, rebase, behind upstream, branch error, sync window)
  conflicts: string[];
  pendingBatch: number; // >0 while a large batch waits for approval
  pending: boolean;
  /** Set while files are being compared by content (a full resync, or the first pass). */
  comparing: { done: number; total: number } | null;

  lastSync: number; // ms, 0 = never
  added: number;
  updated: number;
  deleted: number;
  renamed: number;
  skipped: number;
  failed: number;

  isGit: boolean;
  branch: string;
  gitStatus: string[];
  changed: ChangedFile[];
}

export function isPaused(s: Status): boolean {
  return s.userPaused || s.guardReason !== "";
}

/** A one-line description such as "watching" or "2 conflicts". */
export function stateOf(s: Status): string {
  if (s.conflicts.length > 0) return plural(s.conflicts.length, "conflict");
  if (s.comparing) return `comparing ${s.comparing.done}/${s.comparing.total} files`;
  if (s.pendingBatch > 0) return plural(s.pendingBatch, "change") + " awaiting approval";
  if (s.userPaused) return "paused";
  if (s.guardReason !== "") return "paused: " + s.guardReason;
  if (s.pending) return "settling…";
  return "watching";
}

/** How a conflict is resolved. */
export type Choice = "source" | "target" | "newer" | "keep-both" | "merge";

/** Accepts the long and short spellings used on the command line, in the dashboard and the API. */
export function parseChoice(s: string): Choice | null {
  const m: Record<string, Choice> = {
    source: "source", s: "source",
    target: "target", t: "target",
    newer: "newer", n: "newer",
    both: "keep-both", "keep-both": "keep-both", b: "keep-both",
    merge: "merge", m: "merge",
  };
  return m[s.trim().toLowerCase()] ?? null;
}

/** One planned file operation, reported by plan(). */
export interface Change {
  kind: Kind; // add | update | delete | rename | conflict | kept
  path: string;
  to?: string;
  dir?: string; // → to target, ← to source, ⇄ both
  note?: string;
}
