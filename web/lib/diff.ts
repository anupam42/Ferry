// The change story's logic: unified-diff lines grouped into changes, word-level
// differences, a plain-words summary, and the change map's layout. No DOM here,
// so it's unit-tested on its own (test/webdiff.test.ts).
import type { Line } from "./types.ts";

export interface Row { text: string; oldNo?: number; newNo?: number }
export interface Change {
  removed: { text: string; oldNo: number }[];
  added: { text: string; newNo: number }[];
  before: Row[];
  after: Row[];
  /** the line (in the new version) where it starts */
  at: number;
  kind: "edit" | "add" | "del";
}
export interface Parsed { notes: string[]; changes: Change[]; maxNo: number }

/** Groups unified-diff lines into changes, each with a little context before and after. */
export function parseDiff(lines: Line[]): Parsed {
  const notes: string[] = [], changes: Change[] = [];
  let oldNo = 1, newNo = 1, maxNo = 0, ctx: Row[] = [];
  let cur: Omit<Change, "kind"> | null = null;
  const close = () => {
    if (cur) {
      changes.push({ ...cur, kind: cur.removed.length && cur.added.length ? "edit" : cur.added.length ? "add" : "del" });
      cur = null;
    }
  };
  for (const l of lines) {
    if (l.op === "@") {
      const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(l.text);
      if (m) { close(); oldNo = +m[1]!; newNo = +m[2]!; ctx = []; continue; }
      notes.push(l.text);
      continue;
    }
    if (l.op === " ") {
      const row = { text: l.text, oldNo, newNo };
      if (cur) {
        (cur as Omit<Change, "kind">).after.push(row);
        if ((cur as Omit<Change, "kind">).after.length >= 2) close();
      }
      ctx.push(row);
      if (ctx.length > 2) ctx.shift();
      oldNo++; newNo++;
    } else {
      if (cur && (cur as Omit<Change, "kind">).after.length) close();
      if (!cur) cur = { removed: [], added: [], before: ctx.slice(), after: [], at: newNo };
      if (l.op === "-") { cur.removed.push({ text: l.text, oldNo }); oldNo++; }
      else { cur.added.push({ text: l.text, newNo }); newNo++; }
    }
    maxNo = Math.max(maxNo, oldNo - 1, newNo - 1);
  }
  close();
  return { notes, changes, maxNo };
}

export interface Part { t: string; op: "" | "+" | "-" }

/** Word-level differences between two lines. */
export function wordDiff(a: string, b: string): Part[] {
  const A = a.match(/\s+|\w+|[^\w\s]/g) || [], B = b.match(/\s+|\w+|[^\w\s]/g) || [];
  if (A.length * B.length > 60_000) return [{ t: a, op: "-" }, { t: b, op: "+" }];
  const dp = Array.from({ length: A.length + 1 }, () => new Int32Array(B.length + 1));
  for (let i = A.length - 1; i >= 0; i--) for (let j = B.length - 1; j >= 0; j--) dp[i]![j] = A[i] === B[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const out: Part[] = [];
  let i = 0, j = 0;
  const push = (t: string, op: Part["op"]) => {
    const last = out[out.length - 1];
    if (last && last.op === op) last.t += t;
    else out.push({ t, op });
  };
  while (i < A.length || j < B.length) {
    if (i < A.length && j < B.length && A[i] === B[j]) { push(A[i]!, ""); i++; j++; }
    else if (j < B.length && (i >= A.length || dp[i]![j + 1]! >= dp[i + 1]![j]!)) { push(B[j]!, "+"); j++; }
    else { push(A[i]!, "-"); i++; }
  }
  return out;
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** One plain sentence about what changed, for people who don't read diffs. */
export function story(d: Parsed, file: string): { title: string; detail: string; added: number; removed: number; edited: number } {
  let added = 0, removed = 0, edited = 0;
  for (const c of d.changes) {
    const pairs = c.kind === "edit" ? Math.min(c.removed.length, c.added.length) : 0;
    edited += pairs;
    added += c.added.length - pairs;
    removed += c.removed.length - pairs;
  }
  const parts: string[] = [];
  if (added) parts.push(`added ${plural(added, "new line")}`);
  if (edited) parts.push(`edited ${plural(edited, "line")}`);
  if (removed) parts.push(`removed ${plural(removed, "line")}`);
  const what = parts.length > 1 ? parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1] : parts[0] || "changed nothing visible";
  let where = "";
  if (d.changes.length && d.maxNo > 20) {
    const pos = d.changes.map((c) => c.at / d.maxNo);
    const avg = pos.reduce((a, b) => a + b, 0) / pos.length;
    where = d.changes.length > 1 && Math.max(...pos) - Math.min(...pos) > .5 ? ", in different parts of the file"
      : avg < .33 ? " near the top" : avg > .66 ? " near the end" : " in the middle";
  }
  return { title: `I found ${plural(d.changes.length, "change")} in ${file}.`, detail: `You ${what}${where}.`, added, removed, edited };
}

export interface Mark {
  left: number; width: number; // % of the track
  pin: number; // where the number pin sits, % of the mark's own width
  side: "left" | "mid" | "right"; // which way the tooltip opens
  background: string;
  where: string; what: string; sample: string;
  kinds: ("edit" | "add" | "del")[];
}

/**
 * The change map's layout: each change as a mark on a track that is the whole
 * file, coloured by what happened in proportion (edited, new, removed), with
 * number pins nudged apart so neighbours never cover each other.
 */
export function mapLayout(parsed: Parsed): { marks: Mark[]; ticks: number[]; total: number } {
  const total = Math.max(1, parsed.maxNo);
  const pct = (line: number) => Math.max(0, Math.min(100, ((line - 1) / total) * 100));
  const n = parsed.changes.length;
  const centres = parsed.changes.map((c) => pct(c.at) + Math.max(1.2, ((c.added.length || c.removed.length) / total) * 100) / 2);
  const gap = Math.min(4.2, 100 / Math.max(1, n));
  const pins = centres.slice();
  for (let k = 1; k < n; k++) pins[k] = Math.max(pins[k]!, pins[k - 1]! + gap);
  for (let k = n - 1; k >= 0; k--) pins[k] = Math.min(pins[k]!, k === n - 1 ? 99 : pins[k + 1]! - gap);
  const marks = parsed.changes.map((c, k): Mark => {
    const edited = Math.min(c.added.length, c.removed.length);
    const extraAdd = c.added.length - edited, extraDel = c.removed.length - edited;
    const size = edited + extraAdd + extraDel;
    const left = pct(c.at);
    const width = Math.min(100 - left, Math.max(1.2, ((c.added.length || c.removed.length) / total) * 100));
    const parts = ([[edited, "var(--map-edit)"], [extraAdd, "var(--map-add)"], [extraDel, "var(--map-del)"]] as const).filter(([v]) => v > 0);
    let acc = 0;
    const background = parts.length === 1 ? parts[0]![1] : "linear-gradient(90deg," + parts.map(([v, col]) => { const a = acc; acc += (v / size) * 100; return `${col} ${a}% ${acc}%`; }).join(",") + ")";
    const first = c.added[0], last = c.added[c.added.length - 1];
    const where = first && last ? (first.newNo === last.newNo ? `Line ${first.newNo}` : `Lines ${first.newNo}–${last.newNo}`) : `After line ${Math.max(1, c.at - 1)}`;
    const what = [edited ? plural(edited, "line") + " edited" : "", extraAdd ? `${extraAdd} new` : "", extraDel ? `${extraDel} removed` : ""].filter(Boolean).join(", ");
    const sample = (c.added[0] || c.removed[0] || { text: "" }).text.trim();
    const kinds = [edited ? "edit" : "", extraAdd ? "add" : "", extraDel ? "del" : ""].filter(Boolean) as Mark["kinds"];
    return { left, width, pin: ((pins[k]! - left) / width) * 100, side: pins[k]! > 72 ? "right" : pins[k]! < 28 ? "left" : "mid", background, where, what, sample: sample.length > 60 ? sample.slice(0, 60) + "…" : sample, kinds };
  });
  // a ruler with round line numbers
  const raw = total / 5, mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = Math.max(1, Math.round([1, 2, 2.5, 5, 10].map((m) => m * mag).find((v) => v >= raw) || mag * 10));
  const ticks: number[] = [];
  for (let v = step; v < total - step * 0.4; v += step) ticks.push(v);
  return { marks, ticks, total };
}

/** Rows for the side-by-side view: unchanged lines pair up, and each change's removed and added lines pair up row by row. */
export type SplitRow =
  | { kind: "hunk"; line: number; text: string }
  | { kind: "row"; start: boolean; left: { no?: number; text: string; type: "" | "del" | "gap"; parts?: Part[] }; right: { no?: number; text: string; type: "" | "add" | "gap"; parts?: Part[] } };

export function splitRows(lines: Line[]): SplitRow[] {
  const out: SplitRow[] = [];
  let oldNo = 1, newNo = 1, ctxSince = 99;
  let del: { no: number; text: string }[] = [], add: { no: number; text: string }[] = [];
  const flush = () => {
    if (!del.length && !add.length) return;
    const n = Math.max(del.length, add.length);
    for (let i = 0; i < n; i++) {
      const a = del[i], b = add[i];
      const w = a && b ? wordDiff(a.text, b.text) : undefined;
      out.push({
        kind: "row", start: i === 0 && ctxSince >= 1,
        left: a ? { no: a.no, text: a.text, type: "del", parts: w?.filter((x) => x.op !== "+") } : { text: "", type: "gap" },
        right: b ? { no: b.no, text: b.text, type: "add", parts: w?.filter((x) => x.op !== "-") } : { text: "", type: "gap" },
      });
    }
    del = []; add = []; ctxSince = 0;
  };
  for (const l of lines) {
    if (l.op === "@") {
      const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(l.text);
      if (!m) continue;
      flush();
      oldNo = +m[1]!; newNo = +m[2]!; ctxSince = 99;
      out.push({ kind: "hunk", line: newNo, text: l.text.replace(/^@@[^@]*@@\s?/, "") });
    } else if (l.op === " ") {
      flush();
      out.push({ kind: "row", start: false, left: { no: oldNo, text: l.text, type: "" }, right: { no: newNo, text: l.text, type: "" } });
      oldNo++; newNo++; ctxSince++;
    } else if (l.op === "-") del.push({ no: oldNo++, text: l.text });
    else add.push({ no: newNo++, text: l.text });
  }
  flush();
  return out;
}
