// Meetings for the Time tab, from a calendar's ICS address (Google Calendar's "secret address in
// iCal format", Outlook's "publish calendar" link, an iCloud public calendar, or any .ics URL).
// No sign-in: Ferry reads the address you give it, and keeps the result for a few minutes.
// Handles plain and recurring events (daily, weekly and monthly rules with an interval, BYDAY,
// COUNT, UNTIL and EXDATE), time zones by name, UTC and floating times. All-day events, declined
// ones and cancelled ones are left out: they aren't time spent.
import type { Meeting } from "./shared/work.ts";

export type { Meeting } from "./shared/work.ts";

const CACHE_MS = 10 * 60_000;
const cache = new Map<string, { at: number; text: string }>();

/** Meetings between `from` and `to` (ms). Throws with a readable message when the calendar can't be read. */
export async function meetings(
  url: string,
  from: number,
  to: number,
  fetchFn: typeof fetch = fetch,
): Promise<Meeting[]> {
  const u = url.replace(/^webcal:\/\//i, "https://");
  let hit = cache.get(u);
  if (!hit || Date.now() - hit.at > CACHE_MS) {
    let res: Response;
    try {
      res = await fetchFn(u, { headers: { Accept: "text/calendar" }, signal: AbortSignal.timeout(15_000) });
    } catch (e) {
      throw new Error(`couldn't reach the calendar: ${(e as Error).message}`, { cause: e });
    }
    if (!res.ok)
      throw new Error(`the calendar answered ${res.status}${res.status === 404 ? ": check the address" : ""}`);
    const text = await res.text();
    if (!text.includes("BEGIN:VCALENDAR")) throw new Error("that address doesn't give a calendar (ICS)");
    hit = { at: Date.now(), text };
    cache.set(u, hit);
  }
  return parseIcs(hit.text, from, to);
}

interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}

/** The lines of an ICS file, unfolded (a line starting with a space continues the one before). */
function props(text: string): Prop[] {
  const lines = text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  const out: Prop[] = [];
  for (const l of lines) {
    const i = l.indexOf(":");
    if (i < 0) continue;
    const [name, ...params] = l.slice(0, i).split(";");
    const p: Record<string, string> = {};
    for (const x of params) {
      const j = x.indexOf("=");
      if (j > 0) p[x.slice(0, j).toUpperCase()] = x.slice(j + 1).replace(/^"|"$/g, "");
    }
    out.push({ name: name!.toUpperCase(), params: p, value: l.slice(i + 1) });
  }
  return out;
}

/** How far a time zone is ahead of UTC at a moment (ms). */
function offset(tz: string, utc: number): number {
  try {
    const f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const parts = Object.fromEntries(f.formatToParts(new Date(utc)).map((p) => [p.type, p.value]));
    const asUtc = Date.UTC(+parts.year!, +parts.month! - 1, +parts.day!, +parts.hour!, +parts.minute!, +parts.second!);
    return asUtc - utc;
  } catch {
    return -new Date(utc).getTimezoneOffset() * 60_000; // an unknown zone: this computer's
  }
}

/** A DTSTART-style value as ms; null for an all-day date. */
export function icsTime(value: string, tz?: string): number | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim());
  if (!m || m[4] === undefined) return null;
  const [y, mo, d, h, mi, s] = [+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +(m[6] ?? 0)];
  if (m[7]) return Date.UTC(y, mo, d, h, mi, s);
  if (!tz) return new Date(y, mo, d, h, mi, s).getTime(); // floating: local time
  const wall = Date.UTC(y, mo, d, h, mi, s);
  // the offset at the wall time, checked once more for daylight-saving edges
  const first = wall - offset(tz, wall);
  return wall - offset(tz, first);
}

const DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

type Wall = [number, number, number, number, number, number]; // year, month (0-11), day, h, m, s

/** A moment's wall-clock time in a zone (or this computer's, with none). */
function wallOf(ms: number, tz?: string): Wall {
  if (!tz) {
    const d = new Date(ms);
    return [d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()];
  }
  const w = ms + offset(tz, ms);
  const d = new Date(w);
  return [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()];
}

/** The moment a wall-clock time in a zone (or this computer's) happens. */
function fromWall([y, mo, d, h, mi, s]: Wall, tz?: string): number {
  if (!tz) return new Date(y, mo, d, h, mi, s).getTime();
  const wall = Date.UTC(y, mo, d, h, mi, s);
  // the offset at the wall time, checked once more for daylight-saving edges
  return wall - offset(tz, wall - offset(tz, wall));
}

/**
 * Every start of a recurring event between `from` and `to`, given its first start and its RRULE.
 * It steps through wall-clock dates in the event's own zone, so a 9:00 meeting stays at 9:00
 * when daylight saving starts or ends.
 */
function occurrences(start: number, rule: string, from: number, to: number, tz?: string): number[] {
  const r = Object.fromEntries(rule.split(";").map((x) => x.split("=") as [string, string]));
  const freq = r.FREQ;
  const interval = Math.max(1, +(r.INTERVAL ?? 1));
  const count = r.COUNT ? +r.COUNT : Infinity;
  const until = r.UNTIL ? (icsTime(r.UNTIL.length === 8 ? r.UNTIL + "T235959Z" : r.UNTIL) ?? Infinity) : Infinity;
  const byday = r.BYDAY ? r.BYDAY.split(",").map((d) => DAYS.indexOf(d.slice(-2))) : null;
  const [y, mo, d, h, mi, s] = wallOf(start, tz);
  const weekday = new Date(Date.UTC(y, mo, d)).getUTCDay();
  // the wall date shifted by days or months, at the event's time of day
  const at = (dayShift: number, monthShift = 0) => {
    const day = new Date(Date.UTC(y, mo + monthShift, d + dayShift));
    return fromWall([day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), h, mi, s], tz);
  };
  const out: number[] = [];
  let n = 0;
  for (let step = 0; step < 3000 && n < count; step++) {
    let starts: number[];
    if (freq === "DAILY") starts = [at(step * interval)];
    else if (freq === "WEEKLY") {
      const days = byday?.filter((x) => x >= 0) ?? [weekday];
      starts = days
        .map((wd) => at(step * 7 * interval + ((wd - weekday + 7) % 7)))
        .filter((t) => t >= start)
        .sort((a, b) => a - b);
    } else if (freq === "MONTHLY") starts = [at(0, step * interval)];
    else if (freq === "YEARLY") starts = [at(0, step * 12 * interval)];
    else return start >= from && start <= to ? [start] : [];
    for (const t of starts) {
      if (t > until || n >= count) return out;
      n++;
      if (t >= from && t <= to) out.push(t);
    }
    if (starts.length && starts[0]! > to) break;
  }
  return out;
}

/** Meetings in an ICS calendar's text between `from` and `to` (ms), earliest first. */
export function parseIcs(text: string, from: number, to: number): Meeting[] {
  const out: Meeting[] = [];
  const overridden = new Set<string>(); // UID|start of a recurring meeting moved by a RECURRENCE-ID
  let ev: Prop[] | null = null;
  const events: Prop[][] = [];
  for (const p of props(text)) {
    if (p.name === "BEGIN" && p.value === "VEVENT") ev = [];
    else if (p.name === "END" && p.value === "VEVENT") {
      if (ev) events.push(ev);
      ev = null;
    } else if (ev) ev.push(p);
  }
  for (const e of events) {
    const get = (n: string) => e.find((p) => p.name === n);
    const rid = get("RECURRENCE-ID");
    if (rid) overridden.add(get("UID")?.value + "|" + icsTime(rid.value, rid.params.TZID));
  }
  for (const e of events) {
    const get = (n: string) => e.find((p) => p.name === n);
    const status = get("STATUS")?.value.toUpperCase();
    if (status === "CANCELLED") continue;
    // free time (TRANSP:TRANSPARENT, "show me as available") isn't a meeting you sat in
    if (get("TRANSP")?.value.toUpperCase() === "TRANSPARENT") continue;
    const ds = get("DTSTART");
    if (!ds) continue;
    const tz = ds.params.TZID ?? (ds.value.trim().endsWith("Z") ? "UTC" : undefined);
    const start = icsTime(ds.value, tz);
    if (start === null) continue; // all day
    const de = get("DTEND");
    let end = de ? icsTime(de.value, de.params.TZID) : null;
    const dur = get("DURATION")?.value;
    if (end === null && dur) {
      const m = /P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/.exec(dur);
      if (m) end = start + ((+(m[1] ?? 0) * 24 + +(m[2] ?? 0)) * 60 + +(m[3] ?? 0)) * 60_000;
    }
    if (end === null || end <= start) continue;
    const length = end - start;
    if (length > 12 * 3_600_000) continue; // a multi-day block isn't a meeting
    const title =
      (get("SUMMARY")?.value ?? "Meeting")
        .replace(/\\([,;\\])/g, "$1")
        .replace(/\\n/gi, " ")
        .trim() || "Meeting";
    const uid = get("UID")?.value ?? "";
    const exdates = new Set(
      e
        .filter((p) => p.name === "EXDATE")
        .flatMap((p) => p.value.split(",").map((v) => icsTime(v, p.params.TZID ?? tz))),
    );
    const rule = get("RRULE")?.value;
    const starts = rule ? occurrences(start, rule, from - length, to, tz) : [start];
    for (const s of starts) {
      if (exdates.has(s)) continue;
      if (rule && !get("RECURRENCE-ID") && overridden.has(uid + "|" + s)) continue;
      if (s + length < from || s > to) continue;
      out.push({ start: s, end: s + length, title });
    }
  }
  return out.sort((a, b) => a.start - b.start || a.end - b.end);
}

/** An ICS address as it may be shown: its host and no secret path. */
export function maskCalendar(url: string): string {
  if (!url) return "";
  try {
    const u = new URL(url.replace(/^webcal:\/\//i, "https://"));
    return u.host + "/…";
  } catch {
    return "a calendar";
  }
}
