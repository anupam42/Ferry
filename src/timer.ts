// The Time tab's timer and everything around it, kept in one small file in Ferry's data folder:
// the running timer (or focus session), its entries and the ones you add or pin yourself, which
// projects are billable, daily and weekly goals, hourly rates per project, and a calendar's address.
// The automatic estimate (see shared/work.ts) fills in the rest, and leaves out whatever an entry
// already covers.
import fs from "node:fs";
import path from "node:path";

import { replaceFile } from "./engine/fsops.ts";
import type { Rate, TimeEntry, TimerState } from "./shared/work.ts";

export type { Rate, TimeEntry, TimerState } from "./shared/work.ts";

export class TimerError extends Error {}

/** Entries older than this are dropped. */
const KEEP_DAYS = 400;
/** A timer stopped before this many ms made no entry. */
const MIN_ENTRY_MS = 60_000;
const DAY = 86_400_000;

const file = (dir: string) => path.join(dir, "time.json");

const empty = (): TimerState => ({
  running: null,
  entries: [],
  billable: {},
  goals: { day: 0, week: 0 },
  rates: {},
  calendar: "",
});

export function readTimer(dir: string): TimerState {
  try {
    const t = JSON.parse(fs.readFileSync(file(dir), "utf8")) as Partial<TimerState>;
    const e = empty();
    return {
      running: t.running ?? null,
      entries: Array.isArray(t.entries) ? t.entries : [],
      billable: t.billable && typeof t.billable === "object" ? t.billable : {},
      goals: { ...e.goals, ...(t.goals ?? {}) },
      rates: t.rates && typeof t.rates === "object" ? t.rates : {},
      calendar: typeof t.calendar === "string" ? t.calendar : "",
    };
  } catch {
    return empty();
  }
}

function save(dir: string, t: TimerState): TimerState {
  const cut = Date.now() - KEEP_DAYS * DAY;
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
const project = (v: unknown): string => {
  const p = str(v, "the project");
  if (!p) throw new TimerError("which project is it for?");
  return p;
};
const time = (v: unknown, what: string): number => {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new TimerError(`${what} is a time in ms`);
  return Math.round(v);
};
const newId = (start: number) => `t${start.toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** A span that makes sense: start before end, not in the future, at most a day long. */
function checkSpan(start: number, end: number, now: number): void {
  if (end <= start) throw new TimerError("it has to end after it starts");
  if (end > now + MIN_ENTRY_MS) throw new TimerError("it can't end in the future");
  if (end - start > DAY) throw new TimerError("an entry can be a day long at most");
}

/** Stops the running timer (if any) at `at` and keeps it as an entry when it ran a minute or more. */
function stopInto(t: TimerState, at: number): TimeEntry | null {
  const r = t.running;
  if (!r) return null;
  t.running = null;
  if (at - r.start < MIN_ENTRY_MS) return null;
  const e: TimeEntry = {
    id: newId(r.start),
    start: r.start,
    end: at,
    project: r.project,
    task: r.task,
    billable: r.billable,
    ...(r.focus ? { focus: r.focus } : {}),
  };
  t.entries.push(e);
  return e;
}

/**
 * Starts a timer for a project and a task (stopping one that's running). `start` (ms) backdates
 * it, as "start from when you began saving" does; it can't be in the future or over a day ago.
 * `focus` (minutes) makes it a focus session.
 */
export function startTimer(
  dir: string,
  o: { project?: unknown; task?: unknown; billable?: unknown; start?: unknown; focus?: unknown },
  now = Date.now(),
): TimerState {
  const p = project(o.project);
  let start = now;
  if (o.start !== undefined && o.start !== null) {
    start = time(o.start, "start");
    if (start > now || now - start > DAY) throw new TimerError("a timer can start up to a day ago");
  }
  let focus: number | undefined;
  if (o.focus !== undefined && o.focus !== null && o.focus !== 0) {
    if (typeof o.focus !== "number" || o.focus < 5 || o.focus > 180)
      throw new TimerError("a focus session is 5 to 180 minutes");
    focus = Math.round(o.focus);
  }
  const t = readTimer(dir);
  stopInto(t, Math.max(start, t.running?.start ?? 0));
  const billable = typeof o.billable === "boolean" ? o.billable : (t.billable[p] ?? false);
  t.running = { start, project: p, task: str(o.task, "the task", 200), billable, ...(focus ? { focus } : {}) };
  return save(dir, t);
}

/** Stops the timer now, or at `at` (dropping idle time at the end, or ending a focus session on time). */
export function stopTimer(dir: string, at?: unknown, now = Date.now()): { state: TimerState; entry: TimeEntry | null } {
  const t = readTimer(dir);
  if (!t.running) throw new TimerError("no timer is running");
  let end = now;
  if (at !== undefined && at !== null) {
    end = time(at, "the stop time");
    if (end < t.running.start || end > now) throw new TimerError("it can stop between its start and now");
  }
  const entry = stopInto(t, end);
  return { state: save(dir, t), entry };
}

/**
 * Changes an entry (or the running timer: id "running"): its task, project, billable flag, and for
 * an entry its start and end. For the running timer, `idleOk` (ms) answers "keep the idle time",
 * and `focus: null` turns a finished focus session into a plain timer.
 */
export function editEntry(
  dir: string,
  id: unknown,
  o: {
    project?: unknown;
    task?: unknown;
    billable?: unknown;
    start?: unknown;
    end?: unknown;
    idleOk?: unknown;
    focus?: unknown;
  },
  now = Date.now(),
): TimerState {
  const t = readTimer(dir);
  const run = id === "running" ? t.running : null;
  const e = run ?? t.entries.find((x) => x.id === id);
  if (!e) throw new TimerError("that entry isn't there any more");
  if (o.project !== undefined) e.project = project(o.project);
  if (o.task !== undefined) e.task = str(o.task, "the task", 200);
  if (o.billable !== undefined) {
    if (typeof o.billable !== "boolean") throw new TimerError("billable is true or false");
    e.billable = o.billable;
  }
  if (run) {
    if (o.idleOk !== undefined) run.idleOk = time(o.idleOk, "idleOk");
    if (o.focus === null) delete run.focus;
    if (o.start !== undefined) {
      const s = time(o.start, "start");
      if (s > now || now - s > DAY) throw new TimerError("a timer can start up to a day ago");
      run.start = s;
    }
  } else {
    const entry = e as TimeEntry;
    const start = o.start !== undefined ? time(o.start, "start") : entry.start;
    const end = o.end !== undefined ? time(o.end, "end") : entry.end;
    checkSpan(start, end, now);
    entry.start = start;
    entry.end = end;
    // a changed entry is no longer what Jira was told
    if (o.start !== undefined || o.end !== undefined) delete entry.jira;
  }
  return save(dir, t);
}

/**
 * Adds an entry you didn't time: forgotten work, a meeting from the calendar, or an automatic
 * block pinned so it can be edited (it then covers that span, like a timer would).
 */
export function addEntry(
  dir: string,
  o: { project?: unknown; task?: unknown; billable?: unknown; start?: unknown; end?: unknown; from?: unknown },
  now = Date.now(),
): { state: TimerState; entry: TimeEntry } {
  const start = time(o.start, "start"),
    end = time(o.end, "end");
  checkSpan(start, end, now);
  const t = readTimer(dir);
  const p = project(o.project);
  const from = o.from === "auto" || o.from === "meeting" ? o.from : "added";
  const entry: TimeEntry = {
    id: newId(start),
    start,
    end,
    project: p,
    task: str(o.task, "the task", 200),
    billable: typeof o.billable === "boolean" ? o.billable : !!t.billable[p],
    from,
  };
  t.entries.push(entry);
  return { state: save(dir, t), entry };
}

/** Splits an entry in two at `at`. */
export function splitEntry(dir: string, id: unknown, at: unknown): TimerState {
  const t = readTimer(dir);
  const e = t.entries.find((x) => x.id === id);
  if (!e) throw new TimerError("that entry isn't there any more");
  const cut = time(at, "the split time");
  if (cut - e.start < MIN_ENTRY_MS || e.end - cut < MIN_ENTRY_MS)
    throw new TimerError("split it at least a minute from either end");
  const second: TimeEntry = { ...e, id: newId(cut), start: cut };
  delete second.jira;
  e.end = cut;
  delete e.jira;
  t.entries.push(second);
  return save(dir, t);
}

/** Joins two or more entries into one, from the earliest start to the latest end, with the first one's details. */
export function mergeEntries(dir: string, ids: unknown): TimerState {
  if (!Array.isArray(ids) || ids.length < 2) throw new TimerError("pick two entries to join");
  const t = readTimer(dir);
  const picked = ids.map((id) => t.entries.find((x) => x.id === id));
  if (picked.some((x) => !x)) throw new TimerError("one of those entries isn't there any more");
  const list = (picked as TimeEntry[]).sort((a, b) => a.start - b.start);
  const first = { ...list[0]! };
  first.start = list[0]!.start;
  first.end = Math.max(...list.map((x) => x.end));
  first.billable = list.some((x) => x.billable);
  if (!first.task) first.task = list.find((x) => x.task)?.task ?? "";
  if (first.end - first.start > DAY) throw new TimerError("together they'd be over a day long");
  delete first.jira;
  t.entries = [...t.entries.filter((x) => !ids.includes(x.id)), first];
  return save(dir, t);
}

export function deleteEntry(dir: string, id: unknown): TimerState {
  const t = readTimer(dir);
  const n = t.entries.length;
  t.entries = t.entries.filter((x) => x.id !== id);
  if (t.entries.length === n) throw new TimerError("that entry isn't there any more");
  return save(dir, t);
}

/** Records that an entry went to Jira as a worklog, so it isn't sent twice. */
export function markJira(dir: string, id: string, jira: { key: string; id: string }): TimerState {
  const t = readTimer(dir);
  const e = t.entries.find((x) => x.id === id);
  if (!e) throw new TimerError("that entry isn't there any more");
  e.jira = { ...jira, at: Date.now() };
  return save(dir, t);
}

/** Marks a project billable or not: new timers for it start that way, and its automatic time counts so. */
export function setBillable(dir: string, p: unknown, on: unknown): TimerState {
  const name = project(p);
  if (typeof on !== "boolean") throw new TimerError("billable is true or false");
  const t = readTimer(dir);
  if (on) t.billable[name] = true;
  else delete t.billable[name];
  return save(dir, t);
}

/** Daily and weekly targets, in minutes (0 for none). */
export function setGoals(dir: string, o: { day?: unknown; week?: unknown }): TimerState {
  const t = readTimer(dir);
  for (const k of ["day", "week"] as const) {
    const v = o[k];
    if (v === undefined) continue;
    const max = k === "day" ? 24 * 60 : 7 * 24 * 60;
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > max)
      throw new TimerError(`a ${k === "day" ? "daily" : "weekly"} goal is 0 to ${max / 60} hours`);
    t.goals[k] = Math.round(v);
  }
  return save(dir, t);
}

/** A project's hourly rate and client; a rate of 0 removes it. Billable time is priced with it. */
export function setRate(
  dir: string,
  p: unknown,
  o: { rate?: unknown; currency?: unknown; client?: unknown },
): TimerState {
  const name = project(p);
  const t = readTimer(dir);
  const rate = o.rate;
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0 || rate > 100_000)
    throw new TimerError("a rate is a number of money per hour");
  if (rate === 0) {
    delete t.rates[name];
    return save(dir, t);
  }
  const currency = str(o.currency, "the currency", 8).toUpperCase() || t.rates[name]?.currency || "USD";
  if (!/^[A-Z]{3}$|^[^\w\s]{1,3}$/.test(currency)) throw new TimerError("a currency looks like USD, EUR or INR");
  const r: Rate = { rate: Math.round(rate * 100) / 100, currency, client: str(o.client, "the client", 80) };
  t.rates[name] = r;
  // a project you charge for is billable
  t.billable[name] = true;
  return save(dir, t);
}

/** The calendar to show meetings from: an ICS address (https or webcal), or "" for none. */
export function setCalendar(dir: string, url: unknown): TimerState {
  const u = str(url, "the calendar address", 2000);
  if (u && !/^(https?|webcal):\/\/\S+$/i.test(u))
    throw new TimerError("a calendar address starts with https:// or webcal://");
  const t = readTimer(dir);
  t.calendar = u;
  return save(dir, t);
}
