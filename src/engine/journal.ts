// Every apply pass is recorded so it can be listed and undone.
import fs from "node:fs";
import path from "node:path";

import { cmp, parseTime } from "../util.ts";
import { backupDir, backupFile, copyFile, fromSlash, removeEmptyParents, removeWithRetry, replaceFile, stat } from "./fsops.ts";

/** One file operation in a sync batch. */
export interface JournalEntry {
  op: string; // add | update | delete | rename
  side: string; // the side that was written: source | target
  path: string;
  to?: string; // rename destination
  backup?: string; // copy of the version that was replaced or deleted
}

/** One apply pass. */
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

export function batchTime(b: Batch): number {
  return parseTime(b.time);
}

/** How many entries of each op the batch has. */
export function counts(b: Batch): { add: number; update: number; del: number; rename: number } {
  const c = { add: 0, update: 0, del: 0, rename: 0 };
  for (const en of b.entries) {
    if (en.op === "add") c.add++;
    else if (en.op === "update") c.update++;
    else if (en.op === "delete") c.del++;
    else if (en.op === "rename") c.rename++;
  }
  return c;
}

export const JOURNAL_KEEP = 200; // batches kept per pair

export function journalPath(dataDir: string, id: string): string {
  return path.join(dataDir, id, "history.jsonl");
}

/** Appends a batch; every 50th append trims the file to JOURNAL_KEEP batches. */
export function appendBatch(file: string, b: Batch, trim: boolean): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(b) + "\n");
    if (trim) {
      const bs = readJournal(file);
      if (bs.length > JOURNAL_KEEP) writeJournal(file, bs.slice(-JOURNAL_KEEP));
    }
  } catch {}
}

/** Batches, oldest first. */
export function readJournal(file: string): Batch[] {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const out: Batch[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const b = JSON.parse(line) as Batch;
      b.entries ??= [];
      out.push(b);
    } catch {}
  }
  return out;
}

function writeJournal(file: string, bs: Batch[]): void {
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, bs.map((b) => JSON.stringify(b) + "\n").join(""));
  replaceFile(tmp, file);
}

/** A pair's batches, newest first. */
export function history(dataDir: string, id: string): Batch[] {
  // the file is in append order; reverse it rather than trust clock resolution
  return readJournal(journalPath(dataDir, id))
    .map((b) => ({ ...b, pair_id: id }))
    .reverse();
}

/** The batches of every pair, newest first. */
export function allHistory(dataDir: string): Batch[] {
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dataDir, { withFileTypes: true });
  } catch {}
  const out: Batch[] = [];
  for (const en of entries.sort((a, b) => cmp(a.name, b.name))) if (en.isDirectory()) out.push(...history(dataDir, en.name));
  // stable sort, newest first
  return out.map((b, i) => [b, i] as const).sort((x, y) => batchTime(y[0]) - batchTime(x[0]) || x[1] - y[1]).map((x) => x[0]);
}

/**
 * Reverses a recorded batch on disk: files ferry created are removed,
 * overwritten or deleted files come back from their backups, and renames are
 * reversed. The versions being replaced are backed up first, so an undo can
 * itself be reverted with "ferry backups restore". problems lists files that
 * could not be put back (for example because backups were off).
 */
export function undo(dataDir: string, b: Batch, keep: number): { done: string[]; problems: string[] } {
  if (b.undone) throw new Error("that batch was already undone");
  if (b.remote) throw new Error("undo isn't supported for remote (ssh or cloud) targets");
  if (keep < 1) keep = 5;
  const bdir = backupDir(dataDir, b.pair_id);
  const root = (s: string) => (s === "source" ? b.source : b.target);
  const done: string[] = [], problems: string[] = [];
  for (let i = b.entries.length - 1; i >= 0; i--) {
    const en = b.entries[i]!;
    const r = root(en.side);
    const p = path.join(r, fromSlash(en.path));
    try {
      switch (en.op) {
        case "add":
          backupFile(bdir, en.side, en.path, p, keep);
          removeWithRetry(p);
          removeEmptyParents(r, p);
          break;
        case "update":
        case "delete": {
          if (!en.backup) {
            problems.push(en.path + ": no copy of the earlier version (backups were off)");
            continue;
          }
          if (!stat(en.backup)) {
            problems.push(en.path + ": the backup of the earlier version has been pruned");
            continue;
          }
          // stage the old version first: backing up the current one may prune en.backup
          const tmp = path.join(path.dirname(p), ".ferry-undo-" + path.basename(p));
          copyFile(en.backup, tmp);
          if (en.op === "update") backupFile(bdir, en.side, en.path, p, keep);
          try {
            replaceFile(tmp, p);
          } catch (e) {
            fs.rmSync(tmp, { force: true });
            throw e;
          }
          break;
        }
        case "rename": {
          const to = path.join(r, fromSlash(en.to ?? ""));
          fs.mkdirSync(path.dirname(p), { recursive: true });
          try {
            replaceFile(to, p);
          } catch (e) {
            problems.push((en.to ?? "") + ": " + (e as Error).message);
            continue;
          }
          removeEmptyParents(r, to);
          break;
        }
        default:
          continue;
      }
    } catch (e) {
      problems.push(en.path + ": " + (e as Error).message);
      continue;
    }
    done.push(en.op + " " + en.path);
  }
  markUndone(dataDir, b.pair_id, b.id);
  return { done, problems };
}

function markUndone(dataDir: string, pairID: string, batchID: string): void {
  const file = journalPath(dataDir, pairID);
  const bs = readJournal(file);
  for (const b of bs) if (b.id === batchID) b.undone = true;
  writeJournal(file, bs);
}

/** The batches of a pair recorded after t that haven't been undone, newest first. */
export function batchesSince(dataDir: string, id: string, t: number): Batch[] {
  return history(dataDir, id).filter((b) => !b.undone && batchTime(b) > t);
}

/**
 * Rolls a pair back to how ferry left it at time t by undoing every batch
 * recorded after t, newest first. Each undo backs up what it replaces, so a
 * restore can itself be reverted with "ferry backups restore".
 */
export function restoreTo(
  dataDir: string, id: string, t: number, keep: number,
): { batches: Batch[]; done: string[]; problems: string[] } {
  const batches = batchesSince(dataDir, id, t);
  const done: string[] = [], problems: string[] = [];
  for (const b of batches) {
    const r = undo(dataDir, b, keep);
    done.push(...r.done);
    problems.push(...r.problems);
  }
  return { batches, done, problems };
}

/** What happened in a pair's history, for "ferry stats". */
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

/** Totals over the batches recorded since `since` (ms; 0 = all history). */
export function stats(pair: string, batches: Batch[], since: number, topN = 10): Stats {
  const st: Stats = {
    pair, batches: 0, undone: 0, added: 0, updated: 0, deleted: 0, renamed: 0, toTarget: 0, toSource: 0,
    first: "", last: "", busiestDay: "", busiestDayFiles: 0, topFiles: [], perDay: [],
  };
  const files = new Map<string, number>();
  const days = new Map<string, number>();
  let first = Infinity, last = 0;
  for (const b of batches) {
    const t = batchTime(b);
    if (since > 0 && t < since) continue;
    st.batches++;
    if (b.undone) st.undone++;
    first = Math.min(first, t);
    last = Math.max(last, t);
    const c = counts(b);
    st.added += c.add;
    st.updated += c.update;
    st.deleted += c.del;
    st.renamed += c.rename;
    const d = new Date(t);
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    days.set(day, (days.get(day) ?? 0) + b.entries.length);
    for (const en of b.entries) {
      if (en.side === "source") st.toSource++;
      else st.toTarget++;
      const p = en.op === "rename" && en.to ? en.to : en.path;
      files.set(p, (files.get(p) ?? 0) + 1);
    }
  }
  if (st.batches > 0) {
    st.first = new Date(first).toISOString();
    st.last = new Date(last).toISOString();
  }
  st.topFiles = [...files]
    .sort((a, b) => b[1] - a[1] || cmp(a[0], b[0]))
    .slice(0, topN)
    .map(([path, changes]) => ({ path, changes }));
  st.perDay = [...days].sort((a, b) => cmp(a[0], b[0])).map(([day, n]) => ({ day, files: n }));
  for (const { day, files: n } of st.perDay) {
    if (n > st.busiestDayFiles) {
      st.busiestDay = day;
      st.busiestDayFiles = n;
    }
  }
  return st;
}
