// Throwaway experiments: "try something" in a pair's working folder without it reaching the target.
// Starting one copies every file the pair syncs into the data folder and pauses the pair. Keeping
// it throws the copy away and syncing carries on with the result; dropping it puts the working
// folder back exactly as it was (changed and deleted files restored, new ones moved aside into
// the data folder, where they can still be fetched) and then carries on. Files the pair ignores
// (node_modules, build output) are left alone either way.
// The state is a folder per pair, so an experiment survives a restart.
import fs from "node:fs";
import path from "node:path";

import { copyFile, fromSlash, removeEmptyParents, replaceFile, type Snapshot } from "./fsops.ts";

export interface ExperimentFile {
  size: number;
  /** mtime, unix nanoseconds */
  mod: number;
  /** sha256 of the content */
  hash: string;
}

export interface Experiment {
  /** RFC 3339 */
  since: string;
  /** what's being tried ("" when not said) */
  name: string;
  files: Record<string, ExperimentFile>;
}

export interface ExperimentChanges {
  added: string[];
  changed: string[];
  deleted: string[];
}

/** Bigger working folders than this aren't copied: the experiment would take too long and too much room. */
export const MAX_EXPERIMENT_BYTES = 2 * 1024 ** 3;

export const experimentDir = (dataDir: string, id: string) => path.join(dataDir, id, "experiment");
const metaPath = (dir: string) => path.join(dir, "experiment.json");
const copyPath = (dir: string, rel: string) => path.join(dir, "files", fromSlash(rel));

export class ExperimentError extends Error {}

/** The experiment under way in `dir`, or null. */
export function loadExperiment(dir: string): Experiment | null {
  try {
    const e = JSON.parse(fs.readFileSync(metaPath(dir), "utf8")) as Experiment;
    return e && typeof e.since === "string" && e.files ? e : null;
  } catch {
    return null;
  }
}

/** Copies every file in `snap` (paths under `root`) into `dir`, and records the experiment. */
export function startExperiment(dir: string, root: string, snap: Snapshot, name: string): Experiment {
  if (loadExperiment(dir)) throw new ExperimentError("an experiment is already under way");
  let bytes = 0;
  for (const st of snap.values()) bytes += st.size;
  if (bytes > MAX_EXPERIMENT_BYTES)
    throw new ExperimentError(
      `the working folder holds ${(bytes / 1024 ** 3).toFixed(1)} GB; experiments copy it first and stop at 2 GB`,
    );
  fs.rmSync(dir, { recursive: true, force: true }); // a half-made copy from an earlier try
  const files: Record<string, ExperimentFile> = {};
  try {
    for (const [rel, st] of snap) {
      const src = path.join(root, fromSlash(rel));
      let hash: string;
      try {
        hash = copyFile(src, copyPath(dir, rel));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") continue; // deleted since the scan
        throw e;
      }
      files[rel] = { size: st.size, mod: st.mod, hash };
    }
  } catch (e) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw new ExperimentError(`couldn't copy the working folder: ${(e as Error).message}`);
  }
  const exp: Experiment = { since: new Date().toISOString(), name: name.trim().slice(0, 200), files };
  // written last: a copy without it is ignored and cleaned up next time
  const tmp = metaPath(dir) + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(exp));
  replaceFile(tmp, metaPath(dir));
  return exp;
}

/** What the experiment has changed so far, comparing the working folder (`now`) with the copy. */
export function experimentChanges(dir: string, exp: Experiment, root: string, now: Snapshot): ExperimentChanges {
  const out: ExperimentChanges = { added: [], changed: [], deleted: [] };
  for (const [rel, st] of now) {
    const was = exp.files[rel];
    if (!was) out.added.push(rel);
    else if (
      st.size !== was.size ||
      (st.mod !== was.mod && !sameBytes(path.join(root, fromSlash(rel)), copyPath(dir, rel)))
    )
      out.changed.push(rel);
  }
  for (const rel of Object.keys(exp.files)) if (!now.has(rel)) out.deleted.push(rel);
  for (const l of Object.values(out)) l.sort();
  return out;
}

function sameBytes(a: string, b: string): boolean {
  try {
    return fs.readFileSync(a).equals(fs.readFileSync(b));
  } catch {
    return false;
  }
}

/** Ends the experiment keeping what it did: the copy is thrown away. */
export function keepExperiment(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

/**
 * Ends the experiment throwing away what it did: changed and deleted files come back from the
 * copy, and files it added are moved into `aside` (kept in the data folder, not deleted). Returns
 * what was done, and any file that couldn't be put back (the copy is then kept, and the
 * experiment stays under way, so nothing is lost).
 */
export function dropExperiment(
  dir: string,
  exp: Experiment,
  root: string,
  now: Snapshot,
  aside: string,
): ExperimentChanges & { problems: string[] } {
  const ch = experimentChanges(dir, exp, root, now);
  const problems: string[] = [];
  for (const rel of [...ch.changed, ...ch.deleted]) {
    try {
      copyFile(copyPath(dir, rel), path.join(root, fromSlash(rel)));
    } catch (e) {
      problems.push(`${rel}: ${(e as Error).message}`);
    }
  }
  for (const rel of ch.added) {
    const p = path.join(root, fromSlash(rel));
    const to = path.join(aside, fromSlash(rel));
    try {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      try {
        fs.renameSync(p, to);
      } catch {
        copyFile(p, to); // another drive
        fs.rmSync(p, { force: true });
      }
      removeEmptyParents(root, p);
    } catch (e) {
      problems.push(`${rel}: ${(e as Error).message}`);
    }
  }
  if (!problems.length) fs.rmSync(dir, { recursive: true, force: true });
  return { ...ch, problems };
}
