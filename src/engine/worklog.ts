// The work log: one line per sync of every pair (when, which pair, which branch, how many files),
// kept for WORKLOG_DAYS so the web app can say how long you worked on what (see shared/work.ts).
// The per-pair journal keeps only the last JOURNAL_KEEP syncs, which can be a single busy day.
import fs from "node:fs";
import path from "node:path";

import { replaceFile } from "./fsops.ts";

/** Days of work kept. */
export const WORKLOG_DAYS = 120;

export interface WorkRecord {
  /** RFC 3339 */
  time: string;
  pair: string;
  pair_id: string;
  /** the folder the pair writes into (a repository, usually) */
  target: string;
  /** the target's branch at the time ("" when it isn't a repository or isn't known) */
  branch: string;
  /** files written */
  files: number;
  /** a few of them */
  paths: string[];
}

export const worklogPath = (dataDir: string) => path.join(dataDir, "worklog.jsonl");

/**
 * The branch checked out in the repository holding `dir`, read straight from its HEAD file (so
 * it's right even just after a switch, and costs no git process): "" when detached or not a
 * repository. Handles worktrees and submodules, whose `.git` is a file naming the real one.
 */
export function headBranch(dir: string): string {
  try {
    let d = path.resolve(dir);
    for (;;) {
      const dotgit = path.join(d, ".git");
      if (fs.existsSync(dotgit)) {
        let gitDir = dotgit;
        if (fs.statSync(dotgit).isFile()) {
          const m = /^gitdir:\s*(.+?)\s*$/m.exec(fs.readFileSync(dotgit, "utf8"));
          if (!m) return "";
          gitDir = path.resolve(d, m[1]!);
        }
        const head = fs.readFileSync(path.join(gitDir, "HEAD"), "utf8");
        return /^ref:\s*refs\/heads\/(.+?)\s*$/m.exec(head)?.[1] ?? "";
      }
      const up = path.dirname(d);
      if (up === d) return "";
      d = up;
    }
  } catch {
    return "";
  }
}

let appends = 0;

/** Adds a sync to the log; now and then drops what's older than WORKLOG_DAYS. Never throws. */
export function appendWork(dataDir: string, r: WorkRecord): void {
  try {
    const file = worklogPath(dataDir);
    fs.mkdirSync(dataDir, { recursive: true });
    fs.appendFileSync(file, JSON.stringify(r) + "\n");
    if (++appends % 200 === 1) trimWork(file, Date.now() - WORKLOG_DAYS * 86_400_000);
  } catch {}
}

/** The log's records since `since` (ms), oldest first. */
export function readWork(dataDir: string, since = 0): WorkRecord[] {
  let text: string;
  try {
    text = fs.readFileSync(worklogPath(dataDir), "utf8");
  } catch {
    return [];
  }
  const out: WorkRecord[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line) as WorkRecord;
      if (Date.parse(r.time) >= since) out.push(r);
    } catch {}
  }
  return out;
}

function trimWork(file: string, before: number): void {
  const keep = readWork(path.dirname(file), before);
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, keep.map((r) => JSON.stringify(r) + "\n").join(""));
  replaceFile(tmp, file);
}
