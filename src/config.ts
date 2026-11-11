// Loads ferry.yaml and validates pair configs.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML, { isMap, isScalar, isSeq, LineCounter, type Node, type Pair as YPair, type YAMLMap } from "yaml";

import * as cloud from "./cloud.ts";
import * as remote from "./remote.ts";
import { formatDuration, humanSize, parseDuration, parseSize } from "./util.ts";

export interface AutoCommit {
  enabled: boolean;
  interval: number; // ms
  message: string;
  push: boolean;
}

/** One source→target sync job. Durations are milliseconds, sizes bytes. */
export interface Pair {
  name: string;
  source: string;
  target: string;

  mode: string; // one-way | two-way
  delete: boolean; // shorthand for onDelete: propagate
  onDelete: string; // keep | restore | propagate
  mirror: boolean; // on start, delete target files that aren't in source (asks first)

  /** Used when someone can be asked: ask | hold | source | target | newer | keep-both. */
  conflict: string;
  /** Replaces "ask" when nobody can answer: hold | keep-both | source | target | newer. */
  headlessConflict: string;
  merge: boolean; // two-way: try a three-way merge before calling it a conflict

  ignore: string[];
  useGitignore: boolean;
  defaultIgnores: boolean;
  only: string[]; // include globs (gitignore syntax); empty = everything
  map: Record<string, string> | null; // source subfolder -> target subfolder; one pair each
  targets: string[]; // extra targets: one one-way pair per target, all from the same source
  /** glob -> shell command; matching text files are piped through it on the way to the target (one-way). */
  transform: Record<string, string> | null;

  branch: string;
  autoCommit: AutoCommit;
  gitGuard: boolean; // pause during merge/rebase
  checkUpstream: number; // fetch interval; pause while behind. 0 = off
  autoPull: boolean; // with checkUpstream: pull --rebase instead of pausing
  pullRebase: boolean; // pull --rebase before every push
  beforeCommit: string; // command run in the target first; failure skips the commit
  pr: boolean; // open a pull request after pushing (gh CLI)
  prBase: string;
  signCommits: boolean;
  commitAuthor: string; // "Name <email>"
  lfs: boolean; // track large/binary files with git LFS instead of skipping them

  maxSize: number;
  binary: string; // allow | warn | skip
  secrets: string; // warn | block | redact | off
  secretAllow: string[];
  eol: string; // keep | lf | crlf
  symlinks: string; // skip | follow | link
  batchLimit: number;
  batchAction: string; // apply | confirm
  batchSettle: number;
  maxOpsPerSec: number;

  backups: number; // versions kept per file; 0 = off
  backupMaxAge: number; // 0 = keep
  backupMaxSize: number; // 0 = no cap
  trash: boolean;

  watcher: string; // auto | native | poll
  interval: number; // poll interval
  settle: number; // quiet time before applying changes
  every: number; // sync on a timer instead of watching
  window: string; // e.g. "09:00-18:00"
  days: string[]; // e.g. ["mon-fri"]

  remote: string; // ssh target; set from target: user@host:path
  cloud: string; // object storage target; set from target: s3://bucket/prefix
  dryRun: boolean;
}

export interface Webhook {
  url: string;
  format?: string; // auto | slack | discord | ntfy | json
  events?: string[];
}

/** Top-level (not per-pair) options of a config file. */
export interface Settings {
  notify: boolean | null;
  serve: string;
  serveToken: string;
  theme: string;
  webhooks: Webhook[];
  /** Repositories opened in the web app's Git client (not synced from anywhere). */
  repos: string[];
}

export const emptySettings = (): Settings => ({ notify: null, serve: "", serveToken: "", theme: "", webhooks: [], repos: [] });

export const DEFAULT_COMMIT_MESSAGE = "sync: {count} file(s) from {source} at {datetime}";

export function defaults(): Pair {
  return {
    name: "", source: "", target: "",
    mode: "one-way", delete: false, onDelete: "", mirror: false,
    conflict: "ask", headlessConflict: "hold", merge: false,
    ignore: [], useGitignore: true, defaultIgnores: true, only: [], map: null, targets: [], transform: null,
    branch: "",
    autoCommit: { enabled: false, interval: 10 * 60_000, message: DEFAULT_COMMIT_MESSAGE, push: false },
    gitGuard: true, checkUpstream: 0, autoPull: false, pullRebase: false, beforeCommit: "",
    pr: false, prBase: "", signCommits: false, commitAuthor: "", lfs: false,
    maxSize: 50 * 2 ** 20, binary: "warn", secrets: "warn", secretAllow: [], eol: "keep", symlinks: "skip",
    batchLimit: 200, batchAction: "apply", batchSettle: 3000, maxOpsPerSec: 0,
    backups: 5, backupMaxAge: 0, backupMaxSize: 0, trash: false,
    watcher: "auto", interval: 500, settle: 300, every: 0, window: "", days: [],
    remote: "", cloud: "", dryRun: false,
  };
}

export function clonePair(p: Pair): Pair {
  return structuredClone(p);
}

// ---------- YAML decoding ----------

type FieldType = "str" | "bool" | "int" | "dur" | "size" | "list" | "map" | "auto";

/** YAML key → [Pair field, type], in the order fields are written back out. */
const FIELDS: [string, keyof Pair, FieldType][] = [
  ["name", "name", "str"], ["source", "source", "str"], ["target", "target", "str"],
  ["mode", "mode", "str"], ["delete", "delete", "bool"], ["on_delete", "onDelete", "str"], ["mirror", "mirror", "bool"],
  ["conflict", "conflict", "str"], ["headless_conflict", "headlessConflict", "str"], ["merge", "merge", "bool"],
  ["ignore", "ignore", "list"], ["use_gitignore", "useGitignore", "bool"], ["default_ignores", "defaultIgnores", "bool"],
  ["only", "only", "list"], ["map", "map", "map"], ["targets", "targets", "list"], ["transform", "transform", "map"],
  ["branch", "branch", "str"], ["auto_commit", "autoCommit", "auto"], ["git_guard", "gitGuard", "bool"],
  ["check_upstream", "checkUpstream", "dur"], ["auto_pull", "autoPull", "bool"], ["pull_rebase", "pullRebase", "bool"],
  ["before_commit", "beforeCommit", "str"], ["pr", "pr", "bool"], ["pr_base", "prBase", "str"],
  ["sign_commits", "signCommits", "bool"], ["commit_author", "commitAuthor", "str"], ["lfs", "lfs", "bool"],
  ["max_size", "maxSize", "size"], ["binary", "binary", "str"], ["secrets", "secrets", "str"],
  ["secret_allow", "secretAllow", "list"], ["eol", "eol", "str"], ["symlinks", "symlinks", "str"],
  ["batch_limit", "batchLimit", "int"], ["batch_action", "batchAction", "str"], ["batch_settle", "batchSettle", "dur"],
  ["max_ops_per_sec", "maxOpsPerSec", "int"],
  ["backups", "backups", "int"], ["backup_max_age", "backupMaxAge", "dur"], ["backup_max_size", "backupMaxSize", "size"],
  ["trash", "trash", "bool"],
  ["watcher", "watcher", "str"], ["interval", "interval", "dur"], ["settle", "settle", "dur"], ["every", "every", "dur"],
  ["window", "window", "str"], ["days", "days", "list"],
  ["remote", "remote", "str"], ["cloud", "cloud", "str"],
];

class Decoder {
  constructor(private lc: LineCounter) {}

  line(n: Node | null | undefined): number {
    const off = n && "range" in n && n.range ? n.range[0] : 0;
    return this.lc.linePos(off).line;
  }

  fail(n: Node | null | undefined, msg: string): never {
    throw new Error(`line ${this.line(n)}: ${msg}`);
  }

  scalar(n: unknown): unknown {
    if (n == null) return null;
    if (isScalar(n)) return n.value;
    this.fail(n as Node, "expected a single value");
  }

  str(n: unknown, key: string): string {
    const v = this.scalar(n);
    if (v == null) return "";
    if (typeof v === "object") this.fail(n as Node, `${key}: expected text`);
    return String(v);
  }

  bool(n: unknown, key: string): boolean {
    const v = this.scalar(n);
    if (v == null) return false;
    if (typeof v !== "boolean") this.fail(n as Node, `${key}: expected true or false, got ${JSON.stringify(v)}`);
    return v;
  }

  int(n: unknown, key: string): number {
    const v = this.scalar(n);
    if (v == null) return 0;
    if (typeof v !== "number" || !Number.isInteger(v)) this.fail(n as Node, `${key}: expected a whole number, got ${JSON.stringify(v)}`);
    return v;
  }

  dur(n: unknown): number {
    const v = this.scalar(n);
    if (v == null) return 0;
    try {
      return parseDuration(typeof v === "number" ? (v === 0 ? 0 : String(v)) : String(v));
    } catch {
      this.fail(n as Node, `bad duration "${String(v)}"`);
    }
  }

  size(n: unknown): number {
    const v = this.scalar(n);
    if (v == null) return 0;
    try {
      return parseSize(typeof v === "number" ? v : String(v));
    } catch (e) {
      this.fail(n as Node, (e as Error).message);
    }
  }

  list(n: unknown, key: string): string[] {
    if (n == null) return [];
    if (isSeq(n)) return n.items.map((it) => this.str(it, key));
    if (isScalar(n)) return n.value == null ? [] : [this.str(n, key)];
    this.fail(n as Node, `${key}: expected a list`);
  }

  map(n: unknown, key: string): Record<string, string> | null {
    if (n == null || (isScalar(n) && n.value == null)) return null;
    if (!isMap(n)) this.fail(n as Node, `${key}: expected a mapping`);
    const out: Record<string, string> = {};
    for (const it of n.items) out[this.str(it.key, key)] = this.str(it.value, key);
    return out;
  }

  items(n: unknown, what: string): YPair[] {
    if (n == null || (isScalar(n) && n.value == null)) return [];
    if (!isMap(n)) this.fail(n as Node, `${what}: expected a mapping`);
    return (n as YAMLMap).items as YPair[];
  }

  /** Decodes a mapping onto p, leaving fields that aren't mentioned alone (like yaml.v3). */
  pair(n: unknown, p: Pair): void {
    for (const it of this.items(n, "pair")) {
      const key = this.str(it.key, "key");
      const f = FIELDS.find((x) => x[0] === key);
      if (!f) continue; // unknown keys are ignored
      const [, field, type] = f;
      const v = it.value;
      const rec = p as unknown as Record<string, unknown>;
      switch (type) {
        case "str": rec[field] = this.str(v, key); break;
        case "bool": rec[field] = this.bool(v, key); break;
        case "int": rec[field] = this.int(v, key); break;
        case "dur": rec[field] = this.dur(v); break;
        case "size": rec[field] = this.size(v); break;
        case "list": rec[field] = this.list(v, key); break;
        case "map": rec[field] = this.map(v, key); break;
        case "auto":
          for (const a of this.items(v, key)) {
            const k = this.str(a.key, "key");
            if (k === "enabled") p.autoCommit.enabled = this.bool(a.value, "auto_commit.enabled");
            else if (k === "interval") p.autoCommit.interval = this.dur(a.value);
            else if (k === "message") p.autoCommit.message = this.str(a.value, "auto_commit.message");
            else if (k === "push") p.autoCommit.push = this.bool(a.value, "auto_commit.push");
          }
          break;
      }
    }
  }
}

/** Reads a YAML config. Relative source/target paths are resolved against the file's folder. */
export function loadFile(
  file: string,
  opts: { allowEmpty?: boolean; lenient?: boolean } = {},
): { pairs: Pair[]; settings: Settings; dropped: { pair: Pair; reason: string }[] } {
  const text = fs.readFileSync(file, "utf8");
  const lc = new LineCounter();
  const doc = YAML.parseDocument(text, { lineCounter: lc, uniqueKeys: false });
  if (doc.errors.length > 0) throw new Error(`${file}: ${doc.errors[0]!.message}`);
  const dec = new Decoder(lc);
  const settings = emptySettings();
  let defaultsNode: unknown = null;
  let pairNodes: unknown[] = [];
  try {
    for (const it of dec.items(doc.contents, "config")) {
      const key = dec.str(it.key, "key");
      const v = it.value;
      switch (key) {
        case "notify": settings.notify = dec.scalar(v) == null ? null : dec.bool(v, key); break;
        case "serve": settings.serve = dec.str(v, key); break;
        case "serve_token": settings.serveToken = dec.str(v, key); break;
        case "theme": settings.theme = dec.str(v, key); break;
        case "webhooks":
          if (v != null && !isSeq(v)) dec.fail(v as Node, "webhooks: expected a list");
          for (const w of isSeq(v) ? v.items : []) {
            const hook: Webhook = { url: "" };
            for (const f of dec.items(w, "webhook")) {
              const k = dec.str(f.key, "key");
              if (k === "url") hook.url = dec.str(f.value, k);
              else if (k === "format") hook.format = dec.str(f.value, k);
              else if (k === "events") hook.events = dec.list(f.value, k);
            }
            settings.webhooks.push(hook);
          }
          break;
        case "repos": settings.repos = dec.list(v, key).map((r) => path.resolve(path.dirname(path.resolve(file)), expandHome(r))); break;
        case "defaults": defaultsNode = v; break;
        case "pairs":
          if (v != null && !isSeq(v)) dec.fail(v as Node, "pairs: expected a list");
          pairNodes = isSeq(v) ? v.items : [];
          break;
      }
    }
  } catch (e) {
    throw new Error(`${file}: ${(e as Error).message}`, { cause: e });
  }
  for (const w of settings.webhooks) {
    if (!w.url) throw new Error(`${file}: every webhook needs a url`);
  }
  const base = defaults();
  if (defaultsNode != null) {
    try {
      dec.pair(defaultsNode, base);
    } catch (e) {
      throw new Error(`${file} defaults: ${(e as Error).message}`, { cause: e });
    }
  }
  if (pairNodes.length === 0 && !opts.allowEmpty) throw new Error(`${file}: no pairs defined`);
  const dir = path.dirname(path.resolve(file));
  const pairs: Pair[] = [];
  pairNodes.forEach((n, i) => {
    const p = clonePair(base);
    p.ignore = [];
    p.map = null;
    p.name = "";
    try {
      dec.pair(n, p);
    } catch (e) {
      throw new Error(`${file} pair ${i + 1}: ${(e as Error).message}`, { cause: e });
    }
    p.ignore = [...base.ignore, ...p.ignore];
    const resolve = (t: string) =>
      t !== "" && !isRemoteSpec(t) && !path.isAbsolute(expandHome(t)) ? path.join(dir, t) : t;
    p.source = resolve(p.source);
    p.target = resolve(p.target);
    p.targets = p.targets.map(resolve);
    try {
      for (const q of expandTargets(p)) pairs.push(...expandMap(q));
    } catch (e) {
      throw new Error(`${file} pair ${i + 1}: ${(e as Error).message}`, { cause: e });
    }
  });
  for (const p of pairs) normalize(p);
  if (opts.lenient) {
    const { kept, dropped } = dropOverlaps(pairs);
    return { pairs: kept, settings, dropped };
  }
  checkOverlaps(pairs);
  return { pairs, settings, dropped: [] };
}

/**
 * checkOverlaps without the error: when two pairs share a name or a target,
 * the one listed later wins (in the web app's config that is the one added
 * last) and the earlier one is returned in dropped.
 */
export function dropOverlaps(pairs: Pair[]): { kept: Pair[]; dropped: { pair: Pair; reason: string }[] } {
  const kept: Pair[] = [];
  const dropped: { pair: Pair; reason: string }[] = [];
  for (let i = pairs.length - 1; i >= 0; i--) {
    const p = pairs[i]!;
    const clash = kept.find((q) => q.name === p.name || samePath(q.target, p.target));
    if (clash) {
      dropped.unshift({ pair: p, reason: clash.name === p.name ? `has the same name as "${clash.name}"` : `writes to the same target as "${clash.name}"` });
    } else kept.unshift(p);
  }
  return { kept, dropped };
}

/** An ssh or cloud target (not a local path). */
export function isRemoteSpec(s: string): boolean {
  return remote.isSpec(s) || cloud.isSpec(s);
}

/**
 * Turns a pair with `targets:` into one one-way pair per target, all reading
 * the same source. `target:`, if also set, is the first of them.
 */
export function expandTargets(p: Pair): Pair[] {
  if (p.targets.length === 0) return [p];
  const all = [...(p.target !== "" ? [p.target] : []), ...p.targets];
  if (p.mode === "two-way" || p.mode === "twoway" || p.mode === "bidirectional") {
    throw new Error("targets: (several targets) only works in one-way mode");
  }
  if (p.map && Object.keys(p.map).length > 0) throw new Error("use either map or targets in a pair, not both");
  const name = p.name || path.basename(expandHome(p.source));
  const used = new Set<string>();
  return all.map((t, i) => {
    const q = clonePair(p);
    q.targets = [];
    q.target = t;
    let label = targetLabel(t) || String(i + 1);
    if (used.has(label)) label += "-" + (i + 1);
    used.add(label);
    q.name = name + "/" + label;
    return q;
  });
}

function targetLabel(t: string): string {
  const s = t.replace(/[/]+$/, "");
  if (cloud.isSpec(s)) {
    const c = cloud.parse(s);
    return c.prefix ? c.bucket + "/" + path.posix.basename(c.prefix) : c.bucket;
  }
  if (remote.isSpec(s)) return path.posix.basename(remote.parse(s).path) || s;
  return path.basename(s);
}

/** Turns a pair with `map:` into one pair per mapped subfolder. */
function expandMap(p: Pair): Pair[] {
  if (!p.map || Object.keys(p.map).length === 0) return [p];
  const name = p.name || path.basename(p.source);
  const out: Pair[] = [];
  for (const k of Object.keys(p.map).sort()) {
    const q = clonePair(p);
    q.map = null;
    const sub = k.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
    const dest = p.map[k]!.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
    q.name = name + "/" + sub;
    q.source = path.join(p.source, ...k.split(/[\\/]/));
    if (isRemoteSpec(p.target) || p.remote !== "" || p.cloud !== "") {
      const t = p.remote || p.cloud || p.target;
      q.target = t.replace(/\/+$/, "") + "/" + dest;
      q.remote = "";
      q.cloud = "";
    } else {
      q.target = path.join(p.target, ...p.map[k]!.split(/[\\/]/));
    }
    out.push(q);
  }
  return out;
}

export function expandHome(p: string): string {
  if (p === "~" || p.startsWith("~/") || p.startsWith("~\\")) return path.join(os.homedir(), p.slice(1));
  return p;
}

const oneOf = (v: string, ...opts: string[]) => opts.includes(v);

/** Validates a pair and makes its paths absolute. Throws on a bad config. */
export function normalize(p: Pair): void {
  const fail = (msg: string): never => {
    throw new Error(`pair "${p.name}": ${msg}`);
  };
  if (p.source === "" || (p.target === "" && p.remote === "" && p.cloud === "")) fail("source and target are required");
  if (p.targets.length > 0) fail("targets: is expanded when a config file is loaded; list them as separate pairs here");
  if (remote.isSpec(p.target)) p.remote = p.target;
  if (cloud.isSpec(p.target)) p.cloud = p.target;
  if (p.cloud !== "") {
    let cs: cloud.Spec;
    try {
      cs = cloud.parse(p.cloud);
    } catch (e) {
      return fail((e as Error).message);
    }
    p.cloud = cs.toString();
    // cloud pairs sync into a local shadow copy, which is uploaded
    p.target = path.join(dataDir(), "cloud", shortHash(p.cloud));
  }
  if (p.remote !== "") {
    let sp: remote.Spec;
    try {
      sp = remote.parse(p.remote);
    } catch (e) {
      return fail((e as Error).message);
    }
    p.remote = sp.toString();
    // remote pairs sync into a local shadow copy, which is pushed over ssh
    p.target = path.join(dataDir(), "remote", shortHash(p.remote));
  }
  p.source = path.resolve(expandHome(p.source));
  p.target = path.resolve(expandHome(p.target));
  if (p.name === "") p.name = path.basename(p.source) + " → " + (p.remote || p.cloud || path.basename(p.target));
  let st: fs.Stats | undefined;
  try {
    st = fs.statSync(p.source);
  } catch {}
  if (!st?.isDirectory()) fail(`source "${p.source}" is not a folder`);
  if (samePath(p.source, p.target)) fail("source and target are the same folder");
  if (inside(p.target, p.source) || inside(p.source, p.target)) fail("one folder is inside the other; that would loop forever");
  if (oneOf(p.mode, "", "one-way", "oneway")) p.mode = "one-way";
  else if (oneOf(p.mode, "two-way", "twoway", "bidirectional")) p.mode = "two-way";
  else fail("mode must be one-way or two-way");
  if (p.remote !== "" && p.mode === "two-way") fail("remote (ssh) targets only support one-way mode");
  if (p.cloud !== "" && p.mode === "two-way") fail("cloud (s3://) targets only support one-way mode");
  if (!oneOf(p.conflict, "ask", "hold", "source", "target", "newer", "keep-both")) {
    fail("conflict must be ask, hold, source, target, newer or keep-both");
  }
  if (p.headlessConflict === "") p.headlessConflict = "hold";
  if (!oneOf(p.headlessConflict, "hold", "source", "target", "newer", "keep-both")) {
    fail("headless_conflict must be hold, source, target, newer or keep-both");
  }
  // on_delete wins; the older delete: true is shorthand for propagate
  if (p.onDelete === "") p.onDelete = p.delete ? "propagate" : "keep";
  if (!oneOf(p.onDelete, "keep", "restore", "propagate")) fail("on_delete must be keep, restore or propagate");
  if (p.onDelete === "restore" && p.mode === "one-way") fail("on_delete: restore only applies to two-way mode");
  p.delete = p.onDelete === "propagate";
  if (!oneOf(p.binary, "allow", "warn", "skip")) fail("binary must be allow, warn or skip");
  if (p.secrets === "") p.secrets = "warn";
  if (!oneOf(p.secrets, "warn", "block", "redact", "off")) fail("secrets must be warn, block, redact or off");
  // a redacted or transformed target differs from its source on purpose; in
  // two-way mode that version would be copied back over the original
  if (p.secrets === "redact" && p.mode === "two-way") fail("secrets: redact only applies to one-way mode");
  if (p.transform && Object.keys(p.transform).length > 0) {
    if (p.mode === "two-way") fail("transform only applies to one-way mode");
    for (const [glob, cmd] of Object.entries(p.transform)) {
      if (glob.trim() === "" || cmd.trim() === "") fail("transform entries need a glob and a command");
    }
  } else p.transform = null;
  if (p.eol === "") p.eol = "keep";
  if (!oneOf(p.eol, "keep", "lf", "crlf")) fail("eol must be keep, lf or crlf");
  if (p.symlinks === "") p.symlinks = "skip";
  if (!oneOf(p.symlinks, "skip", "follow", "link")) fail("symlinks must be skip, follow or link");
  if (!oneOf(p.watcher, "auto", "native", "poll")) fail("watcher must be auto, native or poll");
  if (!oneOf(p.batchAction, "apply", "confirm")) fail("batch_action must be apply or confirm");
  if (p.window !== "") {
    try {
      parseWindow(p.window);
    } catch (e) {
      fail((e as Error).message);
    }
  }
  if (p.days.length > 0) {
    try {
      parseDays(p.days);
    } catch (e) {
      fail((e as Error).message);
    }
  }
  if (p.every < 0) p.every = 0;
  if (p.interval <= 0) p.interval = 500;
  if (p.autoCommit.interval <= 0) p.autoCommit.interval = 10 * 60_000;
  if (p.autoCommit.message === "") p.autoCommit.message = DEFAULT_COMMIT_MESSAGE;
}

// ---------- sync window ----------

/** Whether the pair may sync at time t (window and days). */
export function inWindow(p: Pair, t: Date = new Date()): boolean {
  if (p.days.length > 0) {
    try {
      if (!parseDays(p.days)[t.getDay()]) return false;
    } catch {}
  }
  if (p.window !== "") {
    try {
      const [start, end] = parseWindow(p.window);
      const m = t.getHours() * 60 + t.getMinutes();
      if (start <= end) return m >= start && m < end;
      return m >= start || m < end; // overnight, e.g. 22:00-06:00
    } catch {}
  }
  return true;
}

/** Describes the sync window, e.g. "09:00-18:00 mon-fri". */
export function windowLabel(p: Pair): string {
  const parts: string[] = [];
  if (p.window !== "") parts.push(p.window);
  if (p.days.length > 0) parts.push(p.days.join(","));
  return parts.join(" ");
}

export function parseWindow(s: string): [number, number] {
  const m = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/.exec(s.replaceAll(" ", ""));
  const bad = () => new Error(`window "${s}": expected HH:MM-HH:MM`);
  if (!m) throw bad();
  const [h1, m1, h2, m2] = [+m[1]!, +m[2]!, +m[3]!, +m[4]!];
  if (h1 > 23 || h2 > 23 || m1 > 59 || m2 > 59) throw bad();
  return [h1 * 60 + m1, h2 * 60 + m2];
}

const dayNames: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

export function parseDays(list: string[]): boolean[] {
  const days = [false, false, false, false, false, false, false];
  const day = (s: string): number => {
    s = s.trim().toLowerCase().slice(0, 3);
    const d = dayNames[s];
    if (d === undefined) throw new Error(`unknown day "${s}" (use mon, tue, … or mon-fri)`);
    return d;
  };
  for (const item of list) {
    for (let tok of item.split(",")) {
      tok = tok.trim().toLowerCase();
      if (tok === "") continue;
      if (oneOf(tok, "daily", "all", "everyday")) {
        days.fill(true);
        continue;
      }
      if (tok === "weekdays") tok = "mon-fri";
      if (tok === "weekends" || tok === "weekend") tok = "sat-sun";
      const dash = tok.indexOf("-");
      if (dash >= 0) {
        const a = day(tok.slice(0, dash)), b = day(tok.slice(dash + 1));
        for (let d = a; ; d = (d + 1) % 7) {
          days[d] = true;
          if (d === b) break;
        }
        continue;
      }
      days[day(tok)] = true;
    }
  }
  return days;
}

/** Rejects configs where pairs collide. */
export function checkOverlaps(pairs: Pair[]): void {
  for (let i = 0; i < pairs.length; i++) {
    for (let j = 0; j < pairs.length; j++) {
      if (i === j) continue;
      if (pairs[i]!.name === pairs[j]!.name) throw new Error(`two pairs are named "${pairs[i]!.name}"; names must be unique`);
      if (samePath(pairs[i]!.target, pairs[j]!.target)) {
        throw new Error(`pairs "${pairs[i]!.name}" and "${pairs[j]!.name}" write to the same target`);
      }
    }
  }
}

/** A stable identifier for a pair, used for its state and backup folders. */
export function pairID(p: Pair): string {
  return shortHash(p.source.toLowerCase() + "|" + p.target.toLowerCase());
}

function shortHash(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex").slice(0, 12);
}

function clean(p: string): string {
  let c = path.normalize(p);
  while (c.length > 1 && (c.endsWith("/") || c.endsWith("\\")) && !/^[A-Za-z]:[\\/]$/.test(c)) c = c.slice(0, -1);
  return c;
}

export function samePath(a: string, b: string): boolean {
  return clean(a).toLowerCase() === clean(b).toLowerCase();
}

/** Whether child is strictly inside parent. */
export function inside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/** Where state, backups and logs live (outside both folders). */
export function dataDir(): string {
  if (process.env.FERRY_HOME) return process.env.FERRY_HOME;
  const cache = userCacheDir();
  return cache ? path.join(cache, "ferry") : path.join(os.tmpdir(), "ferry");
}

function userCacheDir(): string {
  switch (process.platform) {
    case "win32":
      return process.env.LocalAppData || process.env.LOCALAPPDATA || "";
    case "darwin":
      return process.env.HOME ? path.join(process.env.HOME, "Library", "Caches") : "";
    default:
      if (process.env.XDG_CACHE_HOME) return process.env.XDG_CACHE_HOME;
      return process.env.HOME ? path.join(process.env.HOME, ".cache") : "";
  }
}

// ---------- serialisation ----------

/** The pair as a YAML mapping (snake_case keys, human durations and sizes). */
export function pairToYAMLObject(p: Pair): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, field, type] of FIELDS) {
    const v = p[field];
    if ((field === "remote" || field === "cloud") && v === "") continue;
    if (field === "targets" && (v as string[]).length === 0) continue;
    if (field === "transform" && v == null) continue;
    switch (type) {
      case "dur": out[key] = formatDuration(v as number); break;
      case "size": out[key] = humanSize(v as number); break;
      case "auto": {
        const a = v as AutoCommit;
        out[key] = { enabled: a.enabled, interval: formatDuration(a.interval), message: a.message, push: a.push };
        break;
      }
      default: out[key] = v ?? {};
    }
  }
  return out;
}

/**
 * Reads a pair saved in a state file. Files written by the Go version of
 * ferry use PascalCase keys and nanosecond durations; those are converted.
 */
export function pairFromJSON(raw: unknown): Pair | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const p = defaults();
  if ("source" in r) {
    Object.assign(p, r);
    p.autoCommit = { ...defaults().autoCommit, ...(r.autoCommit as object) };
    return p;
  }
  if (!("Source" in r)) return null;
  const special: Record<string, keyof Pair> = { PR: "pr", PRBase: "prBase", LFS: "lfs", EOL: "eol" };
  const durs = new Set<string>(FIELDS.filter((f) => f[2] === "dur").map((f) => f[1]));
  for (const [k, v] of Object.entries(r)) {
    const field = (special[k] ?? (k[0]!.toLowerCase() + k.slice(1))) as keyof Pair;
    if (!(field in p) || v == null) continue;
    if (field === "autoCommit") {
      const a = v as Record<string, unknown>;
      p.autoCommit = {
        enabled: !!a.Enabled, interval: Number(a.Interval ?? 0) / 1e6,
        message: String(a.Message ?? DEFAULT_COMMIT_MESSAGE), push: !!a.Push,
      };
    } else {
      // the old JSON format: field names map one to one, durations were in nanoseconds
      (p as unknown as Record<string, unknown>)[field] = durs.has(field) ? Number(v) / 1e6 : v;
    }
  }
  return p;
}

/** Written by `ferry init`. */
export const SAMPLE = `# ferry configuration
# Run with:  ferry --config ferry.yaml   (or just "ferry" in this folder)

notify: true            # desktop notifications on conflicts and errors
# theme: auto           # dashboard colors: auto | dark | light | mono
# serve: 127.0.0.1:7878 # local HTTP API for editors and scripts (see README)
# webhooks:             # post conflicts, errors, pauses and commits to chat
#   - url: https://hooks.slack.com/services/XXX
#     events: [conflict, error, paused, commit]

defaults:               # applies to every pair below; any key can be overridden per pair
  mode: one-way         # one-way (source -> target) | two-way
  on_delete: keep       # file deleted on one side: keep (leave the other copy alone)
                        #   | restore (two-way: copy it back) | propagate (delete it on the other side too)
  conflict: ask         # two-way, when you can be asked (dashboard / terminal):
                        #   ask | hold | source | target | newer | keep-both
  headless_conflict: hold   # when nobody can be asked (service, --json, piped):
                            #   hold (leave both files, notify, resolve later with "ferry resolve")
                            #   | keep-both | source | target | newer
  merge: false          # two-way: try a three-way merge of text files before calling it a conflict
  use_gitignore: true   # honor .gitignore files in source and target
  ignore: [dist, coverage, "*.log"]
  # only: ["src/**", "docs/**"]   # sync just these paths (gitignore syntax)
  git_guard: true       # pause while the target repo is merging/rebasing
  check_upstream: 0     # e.g. 5m: fetch and pause while target is behind its upstream
  auto_pull: false      # with check_upstream: pull --rebase instead of pausing
  max_size: 50MB        # skip bigger files
  binary: warn          # allow | warn | skip
  lfs: false            # track large or binary files with git LFS instead of skipping them
  secrets: warn         # files that look like credentials: warn | block | redact (one-way: blank them out) | off
  secret_allow: []      # globs never flagged as secrets, e.g. ["test/fixtures/**"]
  eol: keep             # line endings of text files written to the target: keep | lf | crlf
  symlinks: skip        # skip | follow (copy what they point to) | link (recreate the link)
  batch_limit: 200      # batches bigger than this wait for activity to settle
  batch_action: apply   # apply | confirm (ask in the dashboard first)
  max_ops_per_sec: 0    # throttle file operations, 0 = unlimited
  backups: 5            # versions kept before overwrite/delete, 0 = off
  backup_max_age: 0     # e.g. 30d: prune older versions
  backup_max_size: 0    # e.g. 1GB: prune the oldest versions past this total
  trash: false          # also send deleted files to the OS trash / recycle bin
  watcher: auto         # auto (native events + safety poll) | native | poll
  every: 0              # e.g. 15m: sync on a timer instead of watching
  # window: "09:00-18:00"   # only sync during these hours
  # days: [mon-fri]         # only sync on these days
  before_commit: ""     # e.g. "npm run lint": must pass before ferry commits
  pull_rebase: false    # pull --rebase before pushing
  pr: false             # open a pull request after pushing (needs the gh CLI)
  sign_commits: false   # git commit -S
  commit_author: ""     # e.g. "Sync Bot <bot@example.com>"
  auto_commit:
    enabled: false
    interval: 10m
    message: "sync: {summary}"   # also {count} {files} {source} {target} {pair} {date} {time} {datetime}
                                 # and {ai}: Claude writes the message (needs ANTHROPIC_API_KEY)
    push: false

pairs:
  - name: web-app
    source: ~/scratch/web-app
    target: ~/code/web-app
    branch: feature/sync      # optional: switch/create this branch in the target first

  - name: notes
    source: ./notes-draft
    target: ./notes-repo
    mode: two-way
    on_delete: propagate

  # - name: monorepo
  #   source: ~/scratch
  #   target: ~/code/monorepo
  #   map: {app: packages/app, docs: docs}   # one pair per mapped subfolder

  # - name: server
  #   source: ./site
  #   target: deploy@example.com:/srv/site   # ssh target (one-way)

  # - name: backup
  #   source: ./site
  #   target: s3://my-bucket/site            # S3, R2, MinIO… (one-way; credentials from AWS_* / S3_* env vars)

  # - name: docs
  #   source: ./docs
  #   targets: [~/code/site-a/docs, ~/code/site-b/docs]   # one source into several repos (one-way)
  #   transform: {"*.md": "prettier --stdin-filepath {path}"}   # pipe files through a formatter (one-way)
`;

/**
 * Pairs from a plain object with config-file keys (snake_case), as sent by
 * the web app. It goes through the same decoding and checks as a ferry.yaml
 * pair; relative paths are resolved against the current folder.
 */
export function pairsFromObject(obj: Record<string, unknown>): Pair[] {
  const lc = new LineCounter();
  const doc = YAML.parseDocument(YAML.stringify(obj), { lineCounter: lc });
  const p = defaults();
  try {
    new Decoder(lc).pair(doc.contents, p);
  } catch (e) {
    throw new Error((e as Error).message.replace(/^line \d+: /, ""), { cause: e });
  }
  const out = expandTargets(p).flatMap(expandMap);
  for (const q of out) normalize(q);
  checkOverlaps(out);
  return out;
}

/**
 * Adds a pair (config-file keys) to the pairs: list of a YAML config,
 * keeping the file's comments and layout. Creates the file if needed.
 */
export function appendPairToFile(file: string, obj: Record<string, unknown>): void {
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {}
  if (text.trim() === "") text = "# ferry configuration (pairs added from the web app are saved here)\n\npairs: []\n";
  const doc = YAML.parseDocument(text);
  if (doc.errors.length > 0) throw new Error(`${file}: ${doc.errors[0]!.message}`);
  const pairs = doc.get("pairs");
  if (pairs == null || (isScalar(pairs) && pairs.value == null)) doc.set("pairs", doc.createNode([obj]));
  else if (isSeq(pairs)) {
    pairs.flow = false;
    pairs.add(doc.createNode(obj));
  } else throw new Error(`${file}: pairs is not a list`);
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, doc.toString());
}

/** Adds or removes a repository in the config file's repos: list (creating the file if needed). */
export function setRepoInFile(file: string, repo: string, present: boolean): void {
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {}
  if (text.trim() === "") text = "# ferry configuration (pairs added from the web app are saved here)\n\npairs: []\n";
  const doc = YAML.parseDocument(text);
  if (doc.errors.length > 0) throw new Error(`${file}: ${doc.errors[0]!.message}`);
  const list = doc.get("repos");
  const items: string[] = isSeq(list) ? list.items.map((it) => String(isScalar(it) ? it.value : it)) : [];
  const next = present ? [...new Set([...items, repo])] : items.filter((r) => path.resolve(expandHome(r)) !== path.resolve(repo));
  if (next.length === items.length && next.every((r, i) => r === items[i])) return;
  doc.set("repos", doc.createNode(next));
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, doc.toString());
}

/**
 * Removes a pair from a config file: the entry with its name, or an unnamed
 * entry with the same source and target. Returns false when no entry
 * matches (for example a pair expanded from map: or targets:).
 */
export function removePairFromFile(file: string, name: string, match?: Pair): boolean {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return false;
  }
  const doc = YAML.parseDocument(text);
  const pairs = doc.get("pairs");
  if (!isSeq(pairs)) return false;
  const dir = path.dirname(path.resolve(file));
  const local = (v: unknown) => {
    const t = String(v ?? "").trim();
    return isRemoteSpec(t) ? t.replace(/\/+$/, "") : path.resolve(dir, expandHome(t));
  };
  const same = (it: YAMLMap) => {
    if (!match || it.get("name") != null || it.get("map") != null || it.get("targets") != null) return false;
    if (!samePath(local(it.get("source")), match.source)) return false;
    const t = local(it.get("target"));
    if (isRemoteSpec(t)) {
      const want = match.remote || match.cloud;
      if (want === "") return false;
      try {
        return (remote.isSpec(t) ? remote.parse(t).toString() : cloud.parse(t).toString()) === want;
      } catch {
        return false;
      }
    }
    return samePath(t, match.target);
  };
  let i = pairs.items.findIndex((it) => isMap(it) && String(it.get("name") ?? "") === name);
  if (i < 0) i = pairs.items.findIndex((it) => isMap(it) && same(it as YAMLMap));
  if (i < 0) return false;
  pairs.items.splice(i, 1);
  fs.writeFileSync(file, doc.toString());
  return true;
}
