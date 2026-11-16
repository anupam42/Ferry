// The Time tab: how long you worked on what. Two sources:
//  - automatic, from real activity: every sync Ferry made (each one is a save in a working folder)
//    and every commit of yours, with no timer to forget;
//  - a timer you start and stop (see timer.ts), which counts exactly.
// Where a timer ran, it wins: saves and commits inside it are left out of the estimate.
//
// Estimating: events less than GAP apart are one sitting. Each event gets the time since the one
// before it, so time spent going back and forth between projects goes to the one you were busy
// with. The first event of a sitting also gets a lead-in for the work before it: a few minutes
// before a save, more before a commit (Ferry didn't see that work happen). A timer ends a sitting.
// No imports: the server, the web app and the tests all use this.

export interface WorkEvent {
  /** when (ms) */
  t: number;
  kind: "sync" | "commit";
  /** the repository's (or pair's) name, as shown */
  repo: string;
  /** the branch it happened on ("" when not known) */
  branch: string;
  /** a sync: files written; a commit: 0 */
  files: number;
  /** a sync: a few of the files it wrote; a commit: the files it changed (at most a few) */
  paths: string[];
  /** a commit's subject line */
  subject?: string;
}

/** Time a timer counted (see timer.ts). */
export interface TimeEntry {
  id: string;
  start: number;
  end: number;
  project: string;
  task: string;
  billable: boolean;
}

export interface TimerState {
  running: { start: number; project: string; task: string; billable: boolean } | null;
  entries: TimeEntry[];
  /** projects whose time is billable (their automatic time, and new timers for them) */
  billable: Record<string, boolean>;
}

export interface WorkResponse {
  events: WorkEvent[];
  /** the oldest day the work log has (YYYY-MM-DD), "" when it's empty */
  since: string;
  /** the timer, its entries and which projects are billable */
  timer: TimerState;
}

/** A stretch of work on one thing: worked out from saves and commits, or counted by a timer. */
export interface Block {
  start: number;
  end: number;
  minutes: number;
  repo: string;
  branch: string;
  issue: string;
  /** what the timer was for ("" for automatic time) */
  task: string;
  kind: "auto" | "timer";
  /** a timer entry's id; "running" for the timer that's still going; "" for automatic time */
  id: string;
  billable: boolean;
  /** subjects of the commits made, oldest first */
  commits: string[];
  /** the files changed most, busiest first */
  files: string[];
}

/** One thing worked on in a day: a repository's branch (or Jira issue), or a timer's task. */
export interface WorkLine {
  repo: string;
  branch: string;
  /** a Jira-style key (PROJ-123) from the branch name, a commit or a timer's task, or "" */
  issue: string;
  /** a timer's task, "" for automatic time */
  task: string;
  minutes: number;
  /** of which billable */
  billable: number;
  commits: string[];
  files: string[];
}

export interface WorkDay {
  /** YYYY-MM-DD, local time */
  day: string;
  minutes: number;
  billable: number;
  /** busiest first */
  lines: WorkLine[];
}

const MIN = 60_000;
/** Longer than this between two events ends a sitting. */
export const GAP_MIN = 25;
/** Added before the first save of a sitting, and before a sitting that starts with a commit. */
export const LEAD_SYNC_MIN = 10;
export const LEAD_COMMIT_MIN = 30;

const ISSUE = /\b([A-Z][A-Z0-9]{1,9})-(\d+)\b/g;
// look like keys but aren't: utf-8, iso-8601, sha-256, rfc-3339, cve-2024, es-2022, ipv-6
const NOT_ISSUES = new Set(["UTF", "ISO", "SHA", "RFC", "CVE", "ES", "IPV", "MD", "WIN", "X86", "HTTP", "TLS"]);

/** A Jira-style issue key in a branch name ("feature/PROJ-12-login") or a commit message. */
export function issueKey(s: string): string {
  for (const m of s.toUpperCase().replace(/[_/]/g, " ").matchAll(ISSUE))
    if (!NOT_ISSUES.has(m[1]!)) return `${m[1]}-${m[2]}`;
  return "";
}

/** YYYY-MM-DD for ms, in local time. */
export function dayOf(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * The minutes each event earns, in the order given (events sorted by time). `breaks` are spans
 * (a timer's) that end a sitting: an event after one starts afresh, and its lead-in doesn't reach
 * back into it.
 */
export function attribute(events: WorkEvent[], gapMin = GAP_MIN, breaks: [number, number][] = []): number[] {
  return events.map((e, i) => {
    const prev = events[i - 1];
    const gap = prev ? (e.t - prev.t) / MIN : Infinity;
    const broken = prev && breaks.some(([s]) => s > prev.t && s < e.t);
    if (gap <= gapMin && !broken) return gap;
    const lead = e.kind === "commit" ? LEAD_COMMIT_MIN : LEAD_SYNC_MIN;
    const lastEnd = Math.max(-Infinity, ...breaks.map(([, end]) => end).filter((end) => end <= e.t));
    return Math.max(0, Math.min(lead, (e.t - lastEnd) / MIN));
  });
}

const DEFAULT_BRANCH = /^(main|master|trunk|develop)?$/;
const branchKey = (b: string) => (DEFAULT_BRANCH.test(b) ? "" : b);

/**
 * Syncs from before the work log began don't know their branch: they get the one of the nearest
 * event in the same repository that does (the one before, or else the one after).
 */
function fillBranches(events: WorkEvent[]): WorkEvent[] {
  const last = new Map<string, string>();
  const out = events.map((e) => {
    if (e.branch) last.set(e.repo, e.branch);
    return e.branch || !last.has(e.repo) ? e : { ...e, branch: last.get(e.repo)! };
  });
  const next = new Map<string, string>();
  for (let i = out.length - 1; i >= 0; i--) {
    const e = out[i]!;
    if (e.branch) next.set(e.repo, e.branch);
    else if (next.has(e.repo)) out[i] = { ...e, branch: next.get(e.repo)! };
  }
  return out;
}

const topFiles = (touched: Map<string, number>) =>
  [...touched.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([p]) => p);

/** Every stretch of work, oldest first: automatic ones from events, and the timer's. */
export function blocks(input: WorkEvent[], timer: TimerState | null = null, now = Date.now()): Block[] {
  const timed: TimeEntry[] = [...(timer?.entries ?? [])];
  if (timer?.running) timed.push({ id: "running", ...timer.running, end: Math.max(now, timer.running.start) });
  const spans = timed.map((t) => [t.start, t.end] as [number, number]);
  const inSpan = (t: number) => spans.some(([s, e]) => t >= s && t <= e);
  const events = fillBranches([...input].sort((a, b) => a.t - b.t)).filter((e) => !inSpan(e.t));
  const mins = attribute(events, GAP_MIN, spans);
  const billable = timer?.billable ?? {};

  const out: (Block & { touched?: Map<string, number> })[] = [];
  let cur: (Block & { touched: Map<string, number> }) | null = null;
  events.forEach((e, i) => {
    const m = mins[i]!;
    const prev = events[i - 1];
    const continues = !!prev && prev.t + m * MIN >= e.t - 1; // the time since the last event counted
    if (!cur || !continues || cur.repo !== e.repo || branchKey(cur.branch) !== branchKey(e.branch)) {
      cur = {
        start: e.t - m * MIN,
        end: e.t,
        minutes: 0,
        repo: e.repo,
        branch: e.branch,
        issue: issueKey(e.branch),
        task: "",
        kind: "auto",
        id: "",
        billable: !!billable[e.repo],
        commits: [],
        files: [],
        touched: new Map(),
      };
      out.push(cur);
    }
    cur.end = e.t;
    cur.minutes += m;
    if (e.kind === "commit" && e.subject) {
      cur.commits.push(e.subject);
      if (!cur.issue) cur.issue = issueKey(e.subject);
    }
    for (const p of e.paths) cur.touched.set(p, (cur.touched.get(p) ?? 0) + 1);
  });
  for (const t of timed)
    out.push({
      start: t.start,
      end: t.end,
      minutes: (t.end - t.start) / MIN,
      repo: t.project,
      branch: "",
      issue: issueKey(t.task),
      task: t.task,
      kind: "timer",
      id: t.id,
      billable: t.billable,
      commits: [],
      files: [],
    });
  return out
    .map(({ touched, ...b }) => ({ ...b, files: touched ? topFiles(touched) : b.files }))
    .sort((a, b) => a.start - b.start);
}

/** Work per day, newest day first, each day's lines busiest first. A block counts on the day it began. */
export function workDays(events: WorkEvent[], timer: TimerState | null = null, now = Date.now()): WorkDay[] {
  const days = new Map<string, Map<string, WorkLine & { touched: Map<string, number> }>>();
  for (const b of blocks(events, timer, now)) {
    const day = dayOf(b.start);
    const lines = days.get(day) ?? new Map();
    days.set(day, lines);
    // the default branch is one line whatever it's called; a timer's task is a line of its own
    const key = b.repo + "\0" + (b.kind === "timer" ? "task:" + b.task : branchKey(b.branch));
    const line = lines.get(key) ?? {
      repo: b.repo,
      branch: b.branch,
      issue: b.issue,
      task: b.task,
      minutes: 0,
      billable: 0,
      commits: [],
      files: [],
      touched: new Map<string, number>(),
    };
    lines.set(key, line);
    line.minutes += b.minutes;
    if (b.billable) line.billable += b.minutes;
    if (!line.issue) line.issue = b.issue;
    line.commits.push(...b.commits);
    b.files.forEach((f, i) => line.touched.set(f, (line.touched.get(f) ?? 0) + 3 - i));
  }
  return [...days.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([day, lines]) => {
      const out = [...lines.values()].map(({ touched, ...l }) => ({
        ...l,
        minutes: Math.round(l.minutes),
        billable: Math.round(l.billable),
        files: topFiles(touched),
      }));
      out.sort((a, b) => b.minutes - a.minutes || a.repo.localeCompare(b.repo));
      return {
        day,
        minutes: out.reduce((n, l) => n + l.minutes, 0),
        billable: out.reduce((n, l) => n + l.billable, 0),
        lines: out,
      };
    });
}

/** Minutes per project for each of `range`'s days (YYYY-MM-DD), and the projects busiest first. */
export function byProject(
  days: WorkDay[],
  range: string[],
): { projects: { name: string; minutes: number }[]; days: { day: string; minutes: Record<string, number> }[] } {
  const totals = new Map<string, number>();
  const out = range.map((day) => {
    const d = days.find((x) => x.day === day);
    const minutes: Record<string, number> = {};
    for (const l of d?.lines ?? []) {
      minutes[l.repo] = (minutes[l.repo] ?? 0) + l.minutes;
      totals.set(l.repo, (totals.get(l.repo) ?? 0) + l.minutes);
    }
    return { day, minutes };
  });
  const projects = [...totals.entries()]
    .map(([name, minutes]) => ({ name, minutes }))
    .sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name));
  return { projects, days: out };
}

/** The `n` days up to and including `last` (YYYY-MM-DD), oldest first. */
export function lastDays(last: string, n: number): string[] {
  const noon = Date.parse(last + "T12:00:00");
  return Array.from({ length: n }, (_, i) => dayOf(noon - (n - 1 - i) * 86_400_000));
}

/** "2 h 10 m", "40 m", "under a minute"; rounded to 5 minutes from an hour up. */
export function duration(min: number): string {
  if (min < 1) return "under a minute";
  if (min < 60) return `${Math.round(min)} m`;
  const r = Math.round(min / 5) * 5;
  const h = Math.floor(r / 60),
    m = r % 60;
  return m ? `${h} h ${m} m` : `${h} h`;
}

/** "01:04:09": a running timer's clock. */
export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}`;
}

/** What a line (or block) is called: a timer's task, or its issue key and branch; and the repository. */
export function lineName(l: { repo: string; branch: string; issue: string; task?: string }): string {
  if (l.task) return `${l.task} (${l.repo})`;
  const branch = branchKey(l.branch);
  const what =
    l.issue && branch && !branch.toUpperCase().includes(l.issue) ? `${l.issue} ${branch}` : branch || l.issue;
  return what ? `${what} (${l.repo})` : l.repo;
}

/** The thing worked on, without the repository: for a row that shows the repository separately. */
export function blockTitle(b: Block): string {
  if (b.task) return b.task;
  const branch = branchKey(b.branch);
  if (b.commits.length) return b.commits[b.commits.length - 1]!;
  if (branch) return b.issue && !branch.toUpperCase().includes(b.issue) ? `${b.issue} ${branch}` : branch;
  if (b.files.length) return "Worked on " + b.files.map((f) => f.slice(f.lastIndexOf("/") + 1)).join(", ");
  return "Work in " + b.repo;
}

const dayName = (day: string) =>
  new Date(day + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });

function dayText(title: string, d: WorkDay): string {
  const rows = d.lines.map((l) => {
    const did = l.commits.length
      ? ": " + l.commits.map((c) => `"${c}"`).join(", ")
      : l.files.length
        ? ": worked on " + l.files.map((f) => f.slice(f.lastIndexOf("/") + 1)).join(", ")
        : "";
    return `- ${lineName(l)}, ${duration(l.minutes)}${did}`;
  });
  return [`${title}, ${duration(d.minutes)}`, ...rows].join("\n");
}

/**
 * A standup: the last day you worked before today (Friday, on a Monday), and today so far,
 * as plain text to paste into a chat.
 */
export function standupText(days: WorkDay[], today: string): string {
  const t = days.find((d) => d.day === today);
  const before = days.find((d) => d.day < today);
  const parts: string[] = [];
  if (before) parts.push(dayText(`Last time (${dayName(before.day)})`, before));
  if (t) parts.push(dayText("Today so far", t));
  return parts.join("\n\n") || "No work recorded yet.";
}

/** The Monday of the week `day` is in (YYYY-MM-DD). */
export function weekStart(day: string): string {
  const d = new Date(day + "T12:00:00");
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return dayOf(d.getTime());
}

/** The seven days from a Monday. */
export function weekDays(monday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday + "T12:00:00");
    d.setDate(d.getDate() + i);
    return dayOf(d.getTime());
  });
}

export interface SheetRow {
  name: string;
  /** minutes per day of the week, Monday first */
  minutes: number[];
  total: number;
  billable: number;
}

/** A week as a timesheet: one row per thing worked on, minutes per day. */
export function timesheet(days: WorkDay[], monday: string): { days: string[]; rows: SheetRow[]; totals: number[] } {
  const week = weekDays(monday);
  const rows = new Map<string, SheetRow>();
  for (const d of days) {
    const i = week.indexOf(d.day);
    if (i < 0) continue;
    for (const l of d.lines) {
      const name = lineName(l);
      const r = rows.get(name) ?? { name, minutes: [0, 0, 0, 0, 0, 0, 0], total: 0, billable: 0 };
      rows.set(name, r);
      r.minutes[i]! += l.minutes;
      r.total += l.minutes;
      r.billable += l.billable;
    }
  }
  const list = [...rows.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  const totals = week.map((_, i) => list.reduce((n, r) => n + r.minutes[i]!, 0));
  return { days: week, rows: list, totals };
}

/** A timesheet as CSV, in hours to two decimals. */
export function timesheetCsv(sheet: { days: string[]; rows: SheetRow[]; totals: number[] }): string {
  const h = (m: number) => (m / 60).toFixed(2);
  const cell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = [
    ["Work", ...sheet.days, "Total", "Billable"].join(","),
    ...sheet.rows.map((r) => [cell(r.name), ...r.minutes.map(h), h(r.total), h(r.billable)].join(",")),
    [
      "Total",
      ...sheet.totals.map(h),
      h(sheet.totals.reduce((a, b) => a + b, 0)),
      h(sheet.rows.reduce((n, r) => n + r.billable, 0)),
    ].join(","),
  ];
  return lines.join("\n") + "\n";
}

/**
 * When you've been saving for a while with no timer running: the sitting you're in (it began at
 * `since`), so a timer can start from then. Null when there's no such sitting.
 */
export function suggestTimer(
  events: WorkEvent[],
  timer: TimerState | null,
  now = Date.now(),
  minMinutes = 15,
): { since: number; repo: string; minutes: number } | null {
  if (timer?.running) return null;
  const last = blocks(events, timer, now)
    .filter((b) => b.kind === "auto")
    .pop();
  if (!last || now - last.end > GAP_MIN * MIN) return null;
  const minutes = (now - last.start) / MIN;
  return minutes >= minMinutes ? { since: Math.round(last.start), repo: last.repo, minutes } : null;
}
