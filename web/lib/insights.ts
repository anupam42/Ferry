// The arithmetic behind the Insights charts (plain TypeScript, unit-tested):
// heat levels, round axes, the year calendar, weekly pace, the story in words,
// hotspots and Ferry's own sync record. The components only draw what this returns.
import type { InsightsResponse } from "../../src/shared/git.ts";
import { plural } from "./format.ts";

export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** A local date as YYYY-MM-DD. */
export const ymd = (t: Date) =>
  `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
/** Noon on a YYYY-MM-DD day, so daylight-saving changes never move it to another day. */
export const noon = (day: string) => new Date(day + "T12:00:00");
export const dayName = (
  day: string,
  o: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" },
) => noon(day).toLocaleDateString(undefined, o);
export const hourName = (hr: number) => new Date(2000, 0, 1, hr).toLocaleTimeString([], { hour: "numeric" });
/** 1234 → "1.2k", 23456 → "23k". */
export const k = (n: number) =>
  n >= 10000 ? Math.round(n / 1000) + "k" : n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n);
/** "src/lib/a.ts" → { name: "a.ts", dir: "src/lib/" } */
export const splitPath = (p: string) => {
  const name = p.split("/").pop() ?? p;
  return { name, dir: p.slice(0, p.length - name.length) };
};

export interface HeatScale {
  level: (x: number) => number;
  ranges: ([number, number] | null)[];
}

/**
 * Splits non-zero values into four levels by quartile, so a few huge days
 * don't wash everything else out. When values repeat (every day has one
 * commit) the levels spread out instead of all landing on the palest.
 */
export function heatScale(values: number[]): HeatScale {
  const v = values.filter((x) => x > 0).sort((a, b) => a - b);
  const q = (p: number) => v[Math.min(v.length - 1, Math.floor(p * v.length))]!;
  const cuts = v.length ? [...new Set([q(0.25), q(0.5), q(0.75)])].filter((c) => c < v[v.length - 1]!) : [];
  const level = (x: number) => {
    if (x <= 0) return 0;
    if (!cuts.length) return 3;
    return 1 + Math.round((cuts.filter((c) => x > c).length * 3) / cuts.length);
  };
  // what each level means, for the legend ("3–5 commits")
  const ranges: ([number, number] | null)[] = [[0, 0], null, null, null, null];
  for (const x of v) {
    const l = level(x);
    ranges[l] = ranges[l] ? [ranges[l]![0], x] : [x, x];
  }
  return { level, ranges };
}

/** A legend swatch's title: "no commits", "1 commit", "3–5 commits". */
export const rangeLabel = (r: [number, number] | null, unit: string) =>
  !r ? "" : r[0] === 0 ? `no ${unit}s` : r[0] === r[1] ? plural(r[0], unit) : `${r[0]}–${r[1]} ${unit}s`;

/** A round axis maximum and its step: 7 → 8 (step 2), 130 → 150 (step 50). */
export function niceMax(v: number): { max: number; step: number } {
  if (v <= 4) return { max: Math.max(1, Math.ceil(v)), step: 1 };
  const mag = Math.pow(10, Math.floor(Math.log10(v / 3)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((x) => v / x <= 4) ?? mag * 10;
  return { max: Math.ceil(v / step) * step, step };
}
/** The tick values from 0 to max. */
export const ticks = ({ max, step }: { max: number; step: number }) =>
  Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step);

/** The Monday 52 weeks before the week of today: the calendar's first cell. */
export function yearStart(today: string): Date {
  const t = noon(today);
  const monday = new Date(t);
  monday.setDate(t.getDate() - ((t.getDay() + 6) % 7));
  const first = new Date(monday);
  first.setDate(monday.getDate() - 52 * 7);
  return first;
}

export interface CalCell {
  day: string;
  week: number;
  row: number;
  n: number;
  level: number;
  future: boolean;
}

/** 53 weeks × 7 days, Monday on top, with a label for each month that starts in view. */
export function yearCalendar(d: Pick<InsightsResponse, "today" | "days">, scale: HeatScale) {
  const first = yearStart(d.today),
    today = noon(d.today);
  const cells: CalCell[] = [];
  const months: { label: string; week: number }[] = [];
  let lastMonth = -1;
  for (let w = 0; w < 53; w++) {
    for (let r = 0; r < 7; r++) {
      const t = new Date(first);
      t.setDate(first.getDate() + w * 7 + r);
      if (r === 0 && t.getMonth() !== lastMonth && (w < 52 || t.getDate() <= 7)) {
        lastMonth = t.getMonth();
        if (w <= 50) months.push({ label: t.toLocaleDateString(undefined, { month: "short" }), week: w });
      }
      const day = ymd(t),
        n = d.days[day] || 0;
      cells.push({ day, week: w, row: r, n, level: scale.level(n), future: t > today });
    }
  }
  return { cells, months };
}

export interface Week {
  start: Date;
  n: number;
  avg: number;
}

/** Commits per week for the calendar's 53 weeks, with a 4-week running average, and how the last month compares. */
export function weekly(d: Pick<InsightsResponse, "today" | "days">) {
  const first = yearStart(d.today),
    today = noon(d.today);
  const weeks: Week[] = [];
  for (let w = 0; w < 53; w++) {
    const start = new Date(first);
    start.setDate(first.getDate() + w * 7);
    let n = 0;
    for (let r = 0; r < 7; r++) {
      const t = new Date(start);
      t.setDate(start.getDate() + r);
      if (t <= today) n += d.days[ymd(t)] || 0;
    }
    weeks.push({ start, n, avg: 0 });
  }
  weeks.forEach((wk, i) => {
    const win = weeks.slice(Math.max(0, i - 3), i + 1);
    wk.avg = win.reduce((a, b) => a + b.n, 0) / win.length;
  });
  const recent = weeks.slice(-4).reduce((a, b) => a + b.n, 0),
    before = weeks.slice(-8, -4).reduce((a, b) => a + b.n, 0);
  const vs = `(${recent} vs ${before} commits)`;
  const trend = !before
    ? ""
    : recent > before * 1.15
      ? `The last 4 weeks are busier than the 4 before ${vs}.`
      : recent < before * 0.85
        ? `The last 4 weeks are quieter than the 4 before ${vs}.`
        : `The last 4 weeks are about as busy as the 4 before ${vs}.`;
  return { weeks, trend };
}

/** The year in two sentences, and the busiest day (the one the calendar opens on). */
export function story(d: InsightsResponse, mine: boolean) {
  const busiest = Object.entries(d.days).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] ?? [d.today, 0];
  const wdSum = d.hours.map((r) => r.reduce((a, b) => a + b, 0));
  const hrSum = Array.from({ length: 24 }, (_, hr) => d.hours.reduce((a, r) => a + (r[hr] ?? 0), 0));
  const favDay = wdSum.indexOf(Math.max(...wdSum)),
    favHour = hrSum.indexOf(Math.max(...hrSum));
  const hot = d.files[0];
  const say = `${mine ? "You" : "This project"} ${mine ? "made" : "had"} ${plural(d.total, "commit")} on ${plural(d.activeDays, "day")} this year.`;
  const hint = [
    `The busiest day was ${dayName(busiest[0], { weekday: "long", day: "numeric", month: "long" })} with ${plural(busiest[1], "commit")}.`,
    `Most commits land on ${WEEKDAYS[favDay]}s around ${hourName(favHour)}.`,
    hot ? `${splitPath(hot.path).name} changes most (${plural(hot.commits, "commit")}).` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return { say, hint, busiest: busiest[0], favDay, favHour };
}

/** Month header: "Nov ’25" for the first column and every January, otherwise "Dec". */
export function monthLabel(m: string, i: number) {
  const t = new Date(m + "-15T12:00:00");
  const name = t.toLocaleDateString(undefined, { month: "short" });
  return i === 0 || t.getMonth() === 0 ? `${name} ’${m.slice(2, 4)}` : name;
}

/** Files with lines, and the five where size and churn together are highest. */
export function hotspots(d: Pick<InsightsResponse, "hotspots">) {
  const pts = d.hotspots.filter((p) => p.lines > 0);
  const lx = (v: number) => Math.log10(Math.max(1, v));
  const score = (p: (typeof pts)[number]) => p.commits * lx(p.lines + 1);
  const top = [...pts].sort((a, b) => score(b) - score(a)).slice(0, 5);
  const med = (arr: number[]) => [...arr].sort((p, q) => p - q)[Math.floor(arr.length / 2)] ?? 0;
  return { pts, top, medLines: med(pts.map((p) => p.lines)), medCommits: med(pts.map((p) => p.commits)) };
}

export interface SyncDay {
  day: string;
  files: number;
  commits: number;
}

/** The last 8 weeks of syncs (from when the record starts), each with that day's commits. */
export function syncDays(d: Pick<InsightsResponse, "today" | "days" | "sync">): SyncDay[] {
  if (!d.sync) return [];
  const today = noon(d.today),
    out: SyncDay[] = [];
  for (let i = 55; i >= 0; i--) {
    const t = new Date(today);
    t.setDate(today.getDate() - i);
    const day = ymd(t);
    if (!d.sync.since || day >= d.sync.since)
      out.push({ day, files: d.sync.days[day] || 0, commits: d.days[day] || 0 });
  }
  return out;
}
