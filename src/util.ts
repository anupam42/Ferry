// Small helpers shared by every module: time formatting, durations, sizes.

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** 2006-01-02 */
export function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
/** 15:04:05 */
export function fmtClock(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
/** 15:04 */
export function fmtHM(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
/** 2006-01-02 15:04:05 */
export function fmtDateTime(d: Date): string {
  return `${fmtDate(d)} ${fmtClock(d)}`;
}
/** 2006-01-02 15:04 */
export function fmtDateHM(d: Date): string {
  return `${fmtDate(d)} ${fmtHM(d)}`;
}
/** 20060102-150405, optionally with fractional seconds (3 = ms, 6 = µs). */
export function fmtStamp(d: Date, frac: 0 | 3 | 6 = 0, micros = 0): string {
  let s =
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  if (frac === 3) s += "." + pad(d.getMilliseconds(), 3);
  if (frac === 6) s += "." + pad(d.getMilliseconds(), 3) + pad(micros % 1000, 3);
  return s;
}
/** Parses 20060102-150405.000 in local time (NaN if malformed). */
export function parseStamp(s: string): number {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})(?:\.(\d{1,9}))?$/.exec(s);
  if (!m) return NaN;
  const ms = m[7] ? Number(m[7].slice(0, 3).padEnd(3, "0")) : 0;
  return new Date(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!, ms).getTime();
}

/** JSON timestamp; zero (never) is written the way Go writes a zero time. */
export const ZERO_TIME = "0001-01-01T00:00:00Z";
export function isoTime(ms: number): string {
  return ms > 0 ? new Date(ms).toISOString() : ZERO_TIME;
}
export function parseTime(s: unknown): number {
  if (typeof s !== "string" || s === "" || s.startsWith("0001-01-01")) return 0;
  const t = Date.parse(s);
  return Number.isNaN(t) ? 0 : t;
}

// ---------- durations (milliseconds) ----------

const units: Record<string, number> = {
  ns: 1e-6,
  us: 1e-3,
  µs: 1e-3,
  μs: 1e-3,
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

/** Go-style durations ("500ms", "1h30m", "2.5s") plus "d" (days) and "w" (weeks). */
export function parseDuration(input: string | number): number {
  if (typeof input === "number") {
    if (input === 0) return 0;
    throw new Error(`bad duration ${input} (add a unit, e.g. ${input}s)`);
  }
  let s = input.trim();
  if (s === "" || s === "0") return 0;
  let sign = 1;
  if (s[0] === "-" || s[0] === "+") {
    if (s[0] === "-") sign = -1;
    s = s.slice(1);
  }
  const re = /(\d+(?:\.\d*)?|\.\d+)(ns|us|µs|μs|ms|s|m|h|d|w)/y;
  let total = 0;
  let pos = 0;
  while (pos < s.length) {
    re.lastIndex = pos;
    const m = re.exec(s);
    if (!m) throw new Error(`bad duration "${input}"`);
    total += parseFloat(m[1]!) * units[m[2]!]!;
    pos = re.lastIndex;
  }
  if (pos === 0) throw new Error(`bad duration "${input}"`);
  return sign * total;
}

/** Formats like Go's time.Duration.String(): 15m0s, 1h30m0s, 500ms, 2.5s. */
export function formatDuration(ms: number): string {
  if (ms === 0) return "0s";
  const neg = ms < 0;
  ms = Math.abs(ms);
  let out: string;
  if (ms < 1000) {
    if (ms >= 1) out = trimNum(ms) + "ms";
    else if (ms >= 1e-3) out = trimNum(ms * 1000) + "µs";
    else out = trimNum(ms * 1e6) + "ns";
  } else {
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    const s = (ms % 60_000) / 1000;
    out = (h > 0 ? `${h}h${m}m` : m > 0 ? `${m}m` : "") + trimNum(s) + "s";
  }
  return (neg ? "-" : "") + out;
}

function trimNum(n: number): string {
  return String(Math.round(n * 1e9) / 1e9);
}

// ---------- sizes (bytes) ----------

/** Accepts "50MB", "1.5GB", "800KB", "1024". */
export function parseSize(input: string | number): number {
  if (typeof input === "number") return Math.trunc(input);
  let s = input.trim().toUpperCase();
  if (s === "" || s === "0") return 0;
  let mult = 1;
  for (const [suf, m] of [
    ["GB", 2 ** 30],
    ["MB", 2 ** 20],
    ["KB", 2 ** 10],
    ["G", 2 ** 30],
    ["M", 2 ** 20],
    ["K", 2 ** 10],
    ["B", 1],
  ] as const) {
    if (s.endsWith(suf)) {
      mult = m;
      s = s.slice(0, -suf.length).trim();
      break;
    }
  }
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?$/i.test(s)) throw new Error(`bad size "${s}"`);
  return Math.trunc(parseFloat(s) * mult);
}

export function humanSize(n: number): string {
  if (n >= 2 ** 30) return String(Math.round((n / 2 ** 30) * 1e6) / 1e6) + "GB";
  if (n >= 2 ** 20) return (n / 2 ** 20).toFixed(1) + "MB";
  if (n >= 2 ** 10) return (n / 2 ** 10).toFixed(1) + "KB";
  return String(n) + "B";
}

// ---------- misc ----------

export function plural(n: number, word: string): string {
  return n === 1 ? `1 ${word}` : `${n} ${word}s`;
}

export function firstLine(s: string): string {
  const i = s.indexOf("\n");
  return i >= 0 ? s.slice(0, i) : s;
}

export function lastLines(s: string, n: number): string {
  let lines = s.trim().split("\n");
  if (lines.length > n) lines = lines.slice(-n);
  return lines.join(" | ");
}

export function sortedKeys(m: Map<string, unknown> | Set<string> | Record<string, unknown>): string[] {
  const ks = m instanceof Map || m instanceof Set ? [...m.keys()] : Object.keys(m);
  return ks.sort(cmp);
}

/** Byte-order string comparison (what Go's sort.Strings does). */
export function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** An error that only carries a process exit code. */
export class ExitError extends Error {
  constructor(public code: number) {
    super(`exit ${code}`);
  }
}

/**
 * A point in time from user input: "2h ago", "2h", "yesterday", "15:30"
 * (today, or yesterday if that is still ahead), "2026-11-07 15:30" or any
 * date Date.parse understands. Throws on anything else.
 */
export function parseWhen(input: string, now: Date = new Date()): number {
  const s = input.trim().toLowerCase();
  if (s === "") throw new Error("expected a time, e.g. 2h ago or 15:30");
  if (s === "now") return now.getTime();
  if (s === "yesterday") return now.getTime() - 86_400_000;
  if (s === "today") return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const ago = s.replace(/\s+ago$/, "").replaceAll(" ", "");
  if (/^(\d+(?:\.\d*)?(ns|us|µs|ms|s|m|h|d|w))+$/.test(ago)) return now.getTime() - parseDuration(ago);
  const hm = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (hm) {
    const t = new Date(now.getFullYear(), now.getMonth(), now.getDate(), +hm[1]!, +hm[2]!).getTime();
    if (+hm[1]! > 23 || +hm[2]! > 59) throw new Error(`bad time "${input}"`);
    return t > now.getTime() ? t - 86_400_000 : t;
  }
  // "2026-11-07 15:30" is read as local time
  const local = /^(\d{4})-(\d{2})-(\d{2})(?:[ t](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
  if (local) {
    const [, y, mo, d, h, mi, se] = local;
    return new Date(+y!, +mo! - 1, +d!, +(h ?? 0), +(mi ?? 0), +(se ?? 0)).getTime();
  }
  const t = Date.parse(input);
  if (Number.isNaN(t)) throw new Error(`can't read the time "${input}" (try 2h ago, 15:30 or 2026-11-07 15:30)`);
  return t;
}
