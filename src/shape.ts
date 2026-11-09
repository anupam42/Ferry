// "Shape my history": turn the work Ferry synced into a repository since its
// last commit into a few clean commits.
//
// Ferry journals every sync it makes into a target, and backs up each version
// it replaces. So for any file it wrote, it knows the file's content after
// each sync: the backup taken by the next sync of that file, or the file as it
// is now if nothing touched it since. Grouping the syncs (where you paused,
// say) and taking each file's content at the end of each group gives a
// series of trees; each becomes a commit.
//
// The commits are built with git's plumbing in a scratch index, so neither the
// files in your folder nor your staged changes are touched while they're made.
// At the end the branch moves to the last one (only if it hasn't moved in the
// meantime), and the shaped files' index entries are reset to match it.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { diff as lineDiff, type Line } from "./difftext.ts";
import type { Engine } from "./engine/engine.ts";
import { batchTime, history } from "./engine/journal.ts";
import { GitClientError, state } from "./gitclient.ts";
import { exec } from "./proc.ts";

const baseEnv = () => ({ ...process.env, LC_ALL: "C", GIT_TERMINAL_PROMPT: "0" });

async function git(root: string, args: string[], o: { env?: Record<string, string>; stdin?: Uint8Array | string } = {}): Promise<string> {
  const r = await exec(["git", "-C", root, ...args], { env: { ...baseEnv(), ...(o.env ?? {}) }, stdin: o.stdin, timeoutMs: 120_000 });
  if (r.code !== 0) throw new GitClientError((r.stderr || r.stdout || r.error || "git failed").trim().split("\n")[0]!.replace(/^(error|fatal): /, ""));
  return r.stdout;
}

/** One sync, as the timeline shows it. */
export interface ShapeBatch {
  id: string;
  pair: string;
  time: string;
  files: { path: string; op: "add" | "update" | "delete" }[];
}

export interface ShapeTimeline {
  /** the commit the shaped commits go on top of ("" for a repository with no commits yet) */
  head: string;
  branch: string;
  /** when that commit was made, so the timeline starts there */
  since: string;
  batches: ShapeBatch[];
  /** changed files Ferry didn't write (edited in the repository directly): they stay uncommitted */
  unrecorded: string[];
  /** pairs that sync into this repository */
  pairs: string[];
}

/** A file's content after a sync: bytes, null (the file was gone), or unknown (no backup of it). */
type Content = Buffer | null | "unknown";

interface Event {
  batch: number; // index into the timeline's batches
  op: "add" | "update" | "delete";
  backup: string; // the version this sync replaced ("" when there's none)
}

const toPosix = (p: string) => p.split(path.sep).join("/");

/** Everything needed to shape: the timeline, and each file's events in it. */
async function load(root: string, engines: Engine[]): Promise<{ t: ShapeTimeline; events: Map<string, Event[]> }> {
  const st = await state(root);
  if (st.detached) throw new GitClientError("switch to a branch first: shaped commits go on a branch", "detached");
  if (st.operation) throw new GitClientError(`finish or abort the ${st.operation} first`, "operation");
  const hasHead = st.head !== "";
  const head = hasHead ? (await git(root, ["rev-parse", "HEAD"])).trim() : "";
  const since = hasHead ? Number((await git(root, ["log", "-1", "--format=%ct", "HEAD"])).trim()) * 1000 : 0;

  const pairs = engines.filter((e) => {
    if (e.cfg.remote || e.cfg.cloud) return false;
    const t = path.resolve(e.cfg.target);
    return t === root || t.startsWith(root + path.sep);
  });
  // only files that differ from the last commit now: work you undid needn't become history
  const changed = new Set(st.files.map((f) => f.path));
  type Raw = { b: ReturnType<typeof history>[number]; prefix: string; pair: string };
  const raw: Raw[] = [];
  for (const e of pairs) {
    const prefix = toPosix(path.relative(root, path.resolve(e.cfg.target)));
    for (const b of history(e.dataDir, e.id)) if (!b.undone && batchTime(b) > since) raw.push({ b, prefix, pair: e.name });
  }
  raw.sort((x, y) => batchTime(x.b) - batchTime(y.b));

  const batches: ShapeBatch[] = [];
  const events = new Map<string, Event[]>();
  const unknownFiles = new Set<string>(); // renames: their content history can't be followed
  for (const { b, prefix, pair } of raw) {
    const files: ShapeBatch["files"] = [];
    const idx = batches.length;
    for (const en of b.entries) {
      if (en.side !== "target") continue;
      const rel = (p: string) => (prefix ? prefix + "/" + p : p);
      const add = (p: string, op: Event["op"], backup: string) => {
        if (!changed.has(p)) return;
        files.push({ path: p, op });
        const list = events.get(p) ?? [];
        list.push({ batch: idx, op, backup });
        events.set(p, list);
      };
      if (en.op === "rename") {
        // a move: the old path is gone and the new one appears; their in-between versions aren't backed up
        add(rel(en.path), "delete", "");
        add(rel(en.to ?? ""), "add", "");
        unknownFiles.add(rel(en.path));
        unknownFiles.add(rel(en.to ?? ""));
      } else if (en.op === "add" || en.op === "update" || en.op === "delete") {
        add(rel(en.path), en.op, en.backup ?? "");
      }
    }
    if (files.length) batches.push({ id: b.id, pair, time: b.time, files });
  }
  const recorded = new Set(events.keys());
  return {
    t: { head, branch: st.branch, since: since ? new Date(since).toISOString() : "", batches, unrecorded: [...changed].filter((p) => !recorded.has(p)).sort(), pairs: pairs.map((e) => e.name) },
    events,
  };
}

/** The timeline of syncs since the last commit (for the web app). */
export async function timeline(root: string, engines: Engine[]): Promise<ShapeTimeline> {
  return (await load(root, engines)).t;
}

/** Works out each file's content after any sync, from backups and the files as they are now. */
class Versions {
  constructor(private root: string, private events: Map<string, Event[]>) {}

  /** The content after event i of this file. */
  private after(file: string, i: number): Content {
    const ev = this.events.get(file)!;
    const next = ev[i + 1];
    if (!next) {
      // nothing touched it since: it's what's in the folder now
      const p = path.join(this.root, file);
      try {
        const st = fs.lstatSync(p);
        return st.isFile() ? fs.readFileSync(p) : "unknown";
      } catch {
        return null;
      }
    }
    if (next.op === "add") return null; // it didn't exist just before it was added again
    if (!next.backup) return "unknown";
    try {
      return fs.readFileSync(next.backup);
    } catch {
      return "unknown"; // pruned
    }
  }

  /** The file's content once the syncs up to and including batch `upto` are applied; undefined if none of them touched it. */
  at(file: string, upto: number): Content | undefined {
    const ev = this.events.get(file) ?? [];
    let k = -1;
    for (let i = 0; i < ev.length; i++) if (ev[i]!.batch <= upto) k = i;
    if (k < 0) return undefined;
    // an unknown version rolls forward: the change lands in a later commit instead
    return this.after(file, k);
  }
}

/** Splits batch ids into consecutive groups and checks they cover the timeline exactly, in order. */
function checkGroups(t: ShapeTimeline, groups: unknown): string[][] {
  if (!Array.isArray(groups) || !groups.length) throw new GitClientError("there's nothing to commit");
  const out = groups.map((g) => {
    const ids = (g as { batches?: unknown })?.batches;
    if (!Array.isArray(ids) || !ids.length || ids.some((x) => typeof x !== "string")) throw new GitClientError("each commit needs at least one sync");
    return ids as string[];
  });
  const flat = out.flat();
  if (flat.length !== t.batches.length || flat.some((id, i) => id !== t.batches[i]!.id)) {
    throw new GitClientError("the timeline changed while you were shaping it (Ferry synced again); have another look", "stale");
  }
  return out;
}

/** What one group changed in one file (for the web app's preview of a step). */
export async function groupDiff(root: string, engines: Engine[], body: { batches?: unknown; path?: unknown }): Promise<{ lines: Line[]; before: string; after: string }> {
  const { t, events } = await load(root, engines);
  const ids = Array.isArray(body.batches) ? (body.batches as unknown[]).map(String) : [];
  const idx = ids.map((id) => t.batches.findIndex((b) => b.id === id)).filter((i) => i >= 0);
  const file = String(body.path ?? "");
  if (!idx.length || !events.has(file)) throw new GitClientError("that change isn't in the timeline any more", "stale");
  const v = new Versions(root, events);
  const first = Math.min(...idx), last = Math.max(...idx);
  const before = await contentBefore(root, t, v, file, first);
  const after = v.at(file, last);
  if (before === "unknown" || after === "unknown") return { lines: [{ op: "@", text: "Ferry doesn't have a copy of this step (backups were off or pruned); it'll land in a later commit" }], before: "", after: "" };
  return { lines: lineDiff(before ?? Buffer.alloc(0), after ?? Buffer.alloc(0), 3), before: first === 0 ? "Last commit" : "Before this step", after: "After this step" };
}

/** The file before batch `first`: its state after an earlier sync, or as it is in the last commit. */
async function contentBefore(root: string, t: ShapeTimeline, v: Versions, file: string, first: number): Promise<Content> {
  const prev = first > 0 ? v.at(file, first - 1) : undefined;
  if (prev !== undefined) return prev;
  if (!t.head) return null;
  const r = await exec(["git", "-C", root, "show", `${t.head}:${file}`], { env: baseEnv() });
  return r.code === 0 ? Buffer.from(r.stdout) : null;
}

export interface ShapePlan {
  head?: unknown;
  groups?: unknown; // [{ batches: [id...], message }]
}

/** Makes one commit per group, then moves the branch to the last one. Returns the new commits, oldest first. */
export async function shape(root: string, engines: Engine[], plan: ShapePlan): Promise<{ commits: { hash: string; message: string; files: number }[]; skipped: number }> {
  const { t, events } = await load(root, engines);
  if (String(plan.head ?? "") !== t.head) throw new GitClientError("the branch has moved since you opened this (a new commit?); have another look", "stale");
  const groups = checkGroups(t, plan.groups);
  const messages = (plan.groups as { message?: unknown }[]).map((g, i) => {
    const m = typeof g.message === "string" ? g.message.trim() : "";
    if (!m) throw new GitClientError(`commit ${i + 1} needs a message`);
    return m;
  });
  const v = new Versions(root, events);
  const sign = (await exec(["git", "-C", root, "config", "--bool", "commit.gpgsign"], { env: baseEnv() })).stdout.trim() === "true";

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ferry-shape-"));
  const env = { GIT_INDEX_FILE: path.join(tmp, "index") };
  try {
    await git(root, t.head ? ["read-tree", t.head] : ["read-tree", "--empty"], { env });
    // a file keeps its mode from the last commit; a new one is executable if it is in the folder
    const modes = new Map<string, string>();
    const modeOf = async (file: string) => {
      let m = modes.get(file);
      if (m) return m;
      const ls = t.head ? (await git(root, ["ls-tree", t.head, "--", file])).trim() : "";
      if (ls) m = ls.split(" ")[0]!;
      else {
        try {
          m = fs.statSync(path.join(root, file)).mode & 0o111 ? "100755" : "100644";
        } catch {
          m = "100644";
        }
      }
      modes.set(file, m);
      return m;
    };
    let parent = t.head, parentTree = t.head ? (await git(root, ["rev-parse", `${t.head}^{tree}`])).trim() : "";
    const commits: { hash: string; message: string; files: number }[] = [];
    let skipped = 0, end = -1;
    const written = new Map<string, Content>(); // what the scratch index holds for each file, to skip no-ops
    for (let g = 0; g < groups.length; g++) {
      end += groups[g]!.length;
      let touched = 0;
      for (const file of events.keys()) {
        const c = v.at(file, end);
        if (c === undefined || c === "unknown") continue;
        const prev = written.get(file);
        if (prev !== undefined && prev !== "unknown" && (prev === c || (prev && c && prev.equals(c)))) continue;
        if (c === null) await git(root, ["update-index", "--force-remove", "--", file], { env });
        else {
          const sha = (await git(root, ["hash-object", "-w", "--stdin"], { stdin: c })).trim();
          await git(root, ["update-index", "--add", "--cacheinfo", `${await modeOf(file)},${sha},${file}`], { env });
        }
        written.set(file, c);
        touched++;
      }
      const tree = (await git(root, ["write-tree"], { env })).trim();
      if (tree === parentTree) { skipped++; continue; } // this step changed nothing in the end (e.g. undone in the same group)
      const when = t.batches[end]!.time; // the author date is when the work happened
      const args = ["commit-tree", tree, ...(parent ? ["-p", parent] : []), ...(sign ? ["-S"] : []), "-F", "-"];
      const hash = (await git(root, args, { stdin: messages[g]! + "\n", env: { GIT_AUTHOR_DATE: when } })).trim();
      commits.push({ hash, message: messages[g]!.split("\n")[0]!, files: touched });
      parent = hash;
      parentTree = tree;
    }
    if (!commits.length) throw new GitClientError("those steps add up to no change from the last commit");
    // move the branch, but only if nobody else moved it meanwhile
    const ref = "refs/heads/" + t.branch;
    await git(root, ["update-ref", "-m", `ferry: shaped ${commits.length} commit(s)`, ref, parent, t.head || "0".repeat(40)]);
    // the shaped files now match the new commit; other staged or unstaged changes are left alone
    const files = [...events.keys()];
    if (files.length) await git(root, ["reset", "-q", parent, "--pathspec-from-file=-", "--pathspec-file-nul"], { stdin: files.join("\0") });
    return { commits, skipped };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
