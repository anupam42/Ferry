// The Time tab's manual timer: a running timer, the entries it made, and which projects are
// billable, kept in one small file in Ferry's data folder. The automatic estimate (see
// shared/work.ts) fills in the rest, and leaves out whatever a timer already covers.
import fs from "node:fs";
import path from "node:path";

import { replaceFile } from "./engine/fsops.ts";
import type { TimeEntry, TimerState } from "./shared/work.ts";

export type { TimeEntry, TimerState } from "./shared/work.ts";

export class TimerError extends Error {}

/** Entries older than this are dropped (the work log keeps the same span). */
const KEEP_DAYS = 400;
/** A timer stopped before this many ms made no entry. */
const MIN_ENTRY_MS = 60_000;

const file = (dir: string) => path.join(dir, "time.json");

export function readTimer(dir: string): TimerState {
  try {
    const t = JSON.parse(fs.readFileSync(file(dir), "utf8")) as Partial<TimerState>;
    return {
      running: t.running ?? null,
      entries: Array.isArray(t.entries) ? t.entries : [],
      billable: t.billable && typeof t.billable === "object" ? t.billable : {},
    };
  } catch {
    return { running: null, entries: [], billable: {} };
  }
}

function save(dir: string, t: TimerState): TimerState {
  const cut = Date.now() - KEEP_DAYS * 86_400_000;
  t.entries = t.entries.filter((e) => e.end >= cut).sort((a, b) => a.start - b.start);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = file(dir) + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(t, null, 1));
  replaceFile(tmp, file(dir));
  return t;
}

const str = (v: unknown, what: string, max = 120): string => {
  if (v === undefined || v === null) return "";
  if (typeof v !== "string") throw new TimerError(`${what} should be text`);
  return v
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, max);
};

/** Stops the running timer (if any) and keeps it as an entry when it ran a minute or more. */
function stopInto(t: TimerState, at: number): TimeEntry | null {
  const r = t.running;
  if (!r) return null;
  t.running = null;
  if (at - r.start < MIN_ENTRY_MS) return null;
  const e: TimeEntry = { id: `t${r.start.toString(36)}${Math.random().toString(36).slice(2, 6)}`, ...r, end: at };
  t.entries.push(e);
  return e;
}

/**
 * Starts a timer for a project and a task (stopping one that's running). `start` (ms) backdates
 * it, as "start from when you began saving" does; it can't be in the future or over a day ago.
 */
export function startTimer(
  dir: string,
  o: { project?: unknown; task?: unknown; billable?: unknown; start?: unknown },
  now = Date.now(),
): TimerState {
  const project = str(o.project, "the project");
  if (!project) throw new TimerError("which project is it for?");
  let start = now;
  if (o.start !== undefined && o.start !== null) {
    if (typeof o.start !== "number" || !Number.isFinite(o.start)) throw new TimerError("start is a time in ms");
    if (o.start > now || now - o.start > 86_400_000) throw new TimerError("a timer can start up to a day ago");
    start = Math.round(o.start);
  }
  const t = readTimer(dir);
  stopInto(t, Math.max(start, t.running?.start ?? 0));
  const billable = typeof o.billable === "boolean" ? o.billable : (t.billable[project] ?? false);
  t.running = { start, project, task: str(o.task, "the task", 200), billable };
  return save(dir, t);
}

export function stopTimer(dir: string, now = Date.now()): { state: TimerState; entry: TimeEntry | null } {
  const t = readTimer(dir);
  if (!t.running) throw new TimerError("no timer is running");
  const entry = stopInto(t, now);
  return { state: save(dir, t), entry };
}

/** Changes an entry's task, project or billable flag, or the running timer's ("running" as the id). */
export function editEntry(
  dir: string,
  id: unknown,
  o: { project?: unknown; task?: unknown; billable?: unknown },
): TimerState {
  const t = readTimer(dir);
  const e = id === "running" ? t.running : t.entries.find((x) => x.id === id);
  if (!e) throw new TimerError("that entry isn't there any more");
  if (o.project !== undefined) {
    const p = str(o.project, "the project");
    if (!p) throw new TimerError("which project is it for?");
    e.project = p;
  }
  if (o.task !== undefined) e.task = str(o.task, "the task", 200);
  if (o.billable !== undefined) {
    if (typeof o.billable !== "boolean") throw new TimerError("billable is true or false");
    e.billable = o.billable;
  }
  return save(dir, t);
}

export function deleteEntry(dir: string, id: unknown): TimerState {
  const t = readTimer(dir);
  const n = t.entries.length;
  t.entries = t.entries.filter((x) => x.id !== id);
  if (t.entries.length === n) throw new TimerError("that entry isn't there any more");
  return save(dir, t);
}

/** Marks a project billable or not: new timers for it start that way, and its automatic time counts so. */
export function setBillable(dir: string, project: unknown, on: unknown): TimerState {
  const p = str(project, "the project");
  if (!p) throw new TimerError("which project?");
  if (typeof on !== "boolean") throw new TimerError("billable is true or false");
  const t = readTimer(dir);
  if (on) t.billable[p] = true;
  else delete t.billable[p];
  return save(dir, t);
}
