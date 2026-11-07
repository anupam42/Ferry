// The sync loop for one source/target pair.
//
// All loop state is changed only by tasks run through the engine's serial
// queue (do()), the way the Go version kept it on one goroutine. Timers,
// watchers, the dashboard and the HTTP API all enqueue work instead of
// touching state directly.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import * as ai from "../ai.ts";
import { dataDir as configDataDir, inWindow, pairFromJSON, pairID, windowLabel, type Pair } from "../config.ts";
import { diff, isBinary, type Line } from "../difftext.ts";
import * as gitx from "../gitx.ts";
import { Matcher } from "../ignore.ts";
import { merge3 } from "../merge.ts";
import { send as notify } from "../notify.ts";
import { exec, isWindows, processAlive } from "../proc.ts";
import * as cloud from "../cloud.ts";
import * as remote from "../remote.ts";
import {
  cmp, errMsg, firstLine, fmtClock, fmtDate, fmtDateHM, fmtHM, fmtStamp, formatDuration, humanSize, isoTime,
  lastLines, sleep, sortedKeys,
} from "../util.ts";
import {
  backupDir, backupFile, copyFile, copyLink, DEFAULT_IGNORES, fromSlash, HARD_IGNORES, isBinaryFile, isSymlink, lstat,
  MODE_SYMLINK, mtimeNs, pruneBackups, removeEmptyParents, removeWithRetry, replaceFile, sameStat, scanDir,
  snapshotsEqual, stat, writeFileAtomic, type FileStat, type Snapshot,
} from "./fsops.ts";
import { HashCache } from "./hashcache.ts";
import {
  appendBatch, history, journalPath, restoreTo, stats, undo, type Batch, type JournalEntry, type Stats,
} from "./journal.ts";
import { redactSecrets, scanSecretFile, secretNameHit } from "./secrets.ts";
import { TarWriter } from "./tar.ts";
import { moveToTrash } from "./trash.ts";
import {
  isPaused, stateOf, type Change, type ChangedFile, type Choice, type Event, type Kind, type Status,
} from "./types.ts";
import { Watcher } from "./watch.ts";

type Side = 0 | 1;
const SRC: Side = 0, DST: Side = 1;
const sideName = (s: Side) => (s === SRC ? "source" : "target");
const other = (s: Side): Side => (s === SRC ? DST : SRC);
const arrow = (s: Side) => (s === DST ? "→" : "←");

type OpKind =
  | "copy" // rel: from side → to side
  | "delete" // rel on side
  | "rename" // rel → to, on side
  | "dup" // copy rel → to within side (keep-both)
  | "base" // record base for rel (sides already equal)
  | "dropBase" // forget rel
  | "conflict" // hold rel for the user
  | "orphan" // deleted on one side, keep the copy on `side` (on_delete: keep)
  | "merge" // write merged content (data) to both sides
  | "chmod"; // copy permissions only (content already equal)

interface Op {
  kind: OpKind;
  rel: string;
  to?: string;
  side: Side; // the side being written
  isNew?: boolean;
  restore?: boolean; // copy back to the side where the file was deleted
  data?: Buffer; // merge: merged content
  markers?: number; // merge: conflict blocks left in data
}

/** The last-synced state of a file in two-way mode (short keys, as saved). */
interface Base {
  h: string; // hash
  s: number; // size
  sm: number; // source mtime (ns)
  dm: number; // target mtime (ns)
  /** Set when the source copy legitimately differs from the target (eol conversion). */
  sh?: string;
  ss?: number;
  /** 1 = kept in source, 2 = kept in target after a delete on the other side. */
  o?: number;
}

const survivor = (b: Base): Side => ((b.o ?? 1) - 1) as Side;
const sizeOf = (b: Base, s: Side) => (s === SRC && b.sh ? b.ss ?? 0 : b.s);
const hashOf = (b: Base, s: Side) => (s === SRC && b.sh ? b.sh : b.h);

const MERGE_MAX = 2 << 20; // base copies are kept for text files up to this size
const EOL_MAX = 16 << 20;
const TRANSFORM_MAX = 8 << 20; // bigger files are copied as they are
const TRANSFORM_TIMEOUT = 60_000;

/** Go's path.Ext: the suffix from the last dot in the final element (".env" → ".env"). */
function goExt(p: string): string {
  for (let i = p.length - 1; i >= 0 && p[i] !== "/"; i--) if (p[i] === ".") return p.slice(i);
  return "";
}

function convertEOL(data: Buffer, eol: string): Buffer {
  const lf = Buffer.from(data.toString("latin1").replaceAll("\r\n", "\n"), "latin1");
  return eol === "crlf" ? Buffer.from(lf.toString("latin1").replaceAll("\n", "\r\n"), "latin1") : lf;
}

export interface SavedPair {
  id: string;
  pair: Pair;
  conflicts: string[];
  pid: number; // >0 if a ferry process is syncing this pair now
}

export class Engine {
  readonly cfg: Pair;
  private emitFn: ((ev: Event) => void) | null;
  dataDir: string;
  id: string;
  private twoWay: boolean;
  private gitTarget: string; // where git runs: the target, or the ssh spec of a remote pair
  private matcher: Matcher; // rebuilt each scan so .gitignore edits apply live
  private only: Matcher | null;
  private secretAllow: Matcher | null;
  private transforms: [Matcher, string][] | null;
  private rewriteCache = new Map<string, { key: string; out: { data: Buffer | null; block?: string; note?: string } }>();
  private hashes = new HashCache();

  // queue
  private chain: Promise<unknown> = Promise.resolve();
  private queued = new Set<string>();

  // loop-owned state
  private running = false;
  private prevSrc: Snapshot | null = null;
  state = new Map<string, Base>();
  private lastS: Snapshot | null = null;
  private lastT: Snapshot | null = null;
  private needsApply = false;
  private bigSince = 0;
  private approved = false;
  private userPaused = false;
  private guardReason = "";
  private branchErr = "";
  private behindBy = 0;
  conflicts = new Set<string>();
  private mirrorList: string[] = [];
  private skipped = new Map<string, FileStat>(); // skipped for size/binary, so we warn once per change
  private secretSeen = new Map<string, FileStat>(); // flagged as secrets, so we warn once per change
  private lfsTracked = new Map<string, boolean>();
  private watcherKind = "";
  private isGit = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingBatch = 0;
  private remoteAdd = new Set<string>();
  private remoteDel = new Set<string>();
  private remoteFull = false;
  private journalN = 0;
  private lastStatus = 0;

  // published snapshot
  private status: Status;
  private changed = new Map<string, ChangedFile>();

  /** emit receives every event and must not block for long. */
  constructor(cfg: Pair, emit: ((ev: Event) => void) | null) {
    this.cfg = cfg;
    this.emitFn = emit;
    this.dataDir = configDataDir();
    this.id = pairID(cfg);
    this.twoWay = cfg.mode === "two-way";
    this.gitTarget = cfg.remote !== "" ? cfg.remote : cfg.target;
    this.only = cfg.only.length > 0 ? new Matcher(...cfg.only) : null;
    this.secretAllow = cfg.secretAllow.length > 0 ? new Matcher(...cfg.secretAllow) : null;
    this.transforms = cfg.transform && Object.keys(cfg.transform).length > 0
      ? Object.entries(cfg.transform).map(([glob, cmd]) => [new Matcher(glob), cmd] as [Matcher, string])
      : null;
    this.status = {
      name: cfg.name, source: cfg.source, target: cfg.target, remote: cfg.remote || cfg.cloud, mode: cfg.mode, watcher: "",
      userPaused: false, guardReason: "", conflicts: [], pendingBatch: 0, pending: false,
      lastSync: 0, added: 0, updated: 0, deleted: 0, renamed: 0, skipped: 0, failed: 0,
      isGit: false, branch: "", gitStatus: [], changed: [],
    };
    this.matcher = this.buildMatcher();
  }

  get name(): string {
    return this.cfg.name;
  }

  /** A pair-relative path as a real path. For remote pairs the target is the local shadow copy. */
  sourcePath(rel: string): string {
    return this.abs(SRC, rel);
  }
  targetPath(rel: string): string {
    return this.abs(DST, rel);
  }

  private emit(ev: Omit<Event, "time" | "pair">): void {
    const full: Event = { ...ev, time: Date.now(), pair: this.cfg.name };
    if (this.cfg.dryRun && ["add", "update", "delete", "rename"].includes(ev.kind)) full.dryRun = true;
    this.emitFn?.(full);
  }

  private warn(msg: string): void {
    this.emit({ kind: "warn", msg });
  }

  private errorf(p: string, err: unknown): void {
    const msg = errMsg(err);
    this.emit({ kind: "error", path: p || undefined, msg });
    notify(this.cfg.name + "/error", "ferry: error in " + this.cfg.name, (p + " " + msg).trim());
  }

  private buildMatcher(): Matcher {
    const m = new Matcher(...HARD_IGNORES);
    if (this.cfg.defaultIgnores) m.add("", DEFAULT_IGNORES);
    m.add("", this.cfg.ignore);
    const roots = [this.cfg.source];
    if (this.twoWay) roots.push(this.cfg.target);
    for (const r of roots) {
      m.addFile(path.join(r, ".syncignore"), "");
      if (this.cfg.useGitignore) m.addFile(path.join(r, ".gitignore"), "");
    }
    // in one-way mode the target's root .gitignore matters too: no point
    // copying files git will ignore anyway
    if (!this.twoWay && this.cfg.useGitignore) m.addFile(path.join(this.cfg.target, ".gitignore"), "");
    return m;
  }

  private scan(root: string, m: Matcher): Snapshot {
    return scanDir(root, m, this.cfg.useGitignore, this.only, this.cfg.symlinks);
  }

  private root(s: Side): string {
    return s === SRC ? this.cfg.source : this.cfg.target;
  }

  private abs(s: Side, rel: string): string {
    return path.join(this.root(s), fromSlash(rel));
  }

  // ---------- the queue ----------

  /** Runs f after every task queued before it. Never rejects; errors are reported as events. */
  do<T>(f: () => T | Promise<T>): Promise<T | undefined> {
    const p = this.chain.then(f).catch((e) => {
      this.errorf("", e);
      return undefined;
    });
    this.chain = p;
    return p;
  }

  /** Queues f unless a task with the same key is already waiting. */
  private schedule(key: string, f: () => unknown): void {
    if (this.queued.has(key)) return;
    this.queued.add(key);
    void this.do(async () => {
      this.queued.delete(key);
      await f();
    });
  }

  // ---------- public API ----------

  getStatus(): Status {
    const s = { ...this.status };
    s.conflicts = [...s.conflicts];
    s.gitStatus = [...s.gitStatus];
    s.changed = [...this.changed.values()].sort((a, b) => cmp(a.path, b.path));
    return s;
  }

  setPaused(p: boolean): void {
    void this.do(async () => {
      if (this.userPaused === p) return;
      this.userPaused = p;
      if (p) this.emit({ kind: "paused", msg: "paused by user" });
      else {
        this.emit({ kind: "resumed", msg: "resumed" });
        await this.cycle(false, true);
      }
      this.publish();
    });
  }

  togglePause(): void {
    void this.do(() => this.setPaused(!this.userPaused));
  }

  /** Forces a full comparison (content hash) of both folders. Remote pairs also re-send every file. */
  resync(): void {
    void this.do(async () => {
      this.prevSrc = null;
      this.hashes.clear();
      if (this.cfg.remote !== "" || this.cfg.cloud !== "") this.remoteFull = true;
      this.emit({ kind: "info", msg: "full resync" });
      await this.cycle(true, true);
    });
  }

  approveBatch(): void {
    void this.do(async () => {
      if (this.pendingBatch === 0) return;
      this.approved = true;
      await this.cycle(false, true);
    });
  }

  /** Settles a conflict held for the user. */
  resolve(rel: string, c: Choice): void {
    void this.do(async () => {
      if (!this.conflicts.has(rel)) return;
      await this.resolveNow(rel, c, "resolved: ");
      this.saveState();
      this.publish();
    });
  }

  /** Stages and commits everything under the target. */
  commit(msg: string, push: boolean): void {
    void this.do(() => this.doCommit(msg, push, false, false));
  }

  /** Commits only what is already staged in the target. */
  commitStaged(msg: string, push: boolean): void {
    void this.do(() => this.doCommit(msg, push, false, true));
  }

  /** Stages rel in the target repo, or unstages it if it's staged. Returns whether it's staged afterwards. */
  async toggleStage(rel: string): Promise<boolean> {
    if (await gitx.isStaged(this.gitTarget, rel)) {
      await gitx.unstage(this.gitTarget, rel);
      return false;
    }
    await gitx.stage(this.gitTarget, rel);
    return true;
  }

  // ---------- run loop ----------

  /** Syncs until signal is aborted. With once=true it does a single pass. */
  async run(signal: AbortSignal, once: boolean): Promise<void> {
    fs.mkdirSync(this.cfg.target, { recursive: true });
    this.running = true;
    const pidFile = pidPath(this.dataDir, this.id);
    let wrotePid = false;
    const cleanups: (() => void)[] = [];
    try {
      await this.do(async () => {
        this.hashes.load(this.hashPath());
        this.isGit = await gitx.isRepo(this.gitTarget);
        if (this.cfg.branch !== "") {
          if (!this.isGit) this.warn("branch " + this.cfg.branch + " requested but target is not a git repo");
          else {
            try {
              const created = await gitx.ensureBranch(this.gitTarget, this.cfg.branch);
              this.emit({ kind: "info", msg: (created ? "created and switched to branch " : "on branch ") + this.cfg.branch });
            } catch (e) {
              this.branchErr = "can't switch to branch " + this.cfg.branch + ": " + firstLine(errMsg(e));
              this.errorf("", this.branchErr);
            }
          }
        }
        if (this.twoWay) {
          this.loadState();
          if (!this.cfg.dryRun) {
            fs.mkdirSync(path.dirname(pidFile), { recursive: true });
            fs.writeFileSync(pidFile, String(process.pid));
            wrotePid = true;
          }
          for (const c of sortedKeys(this.conflicts)) {
            this.emit({ kind: "conflict", path: c, msg: "still unresolved from an earlier run", held: true });
          }
          await this.processRequests();
        }
        this.doPruneBackups();
        await this.checkGuard();
        if (this.mirrorList.length > 0) await this.applyMirror();
        await this.cycle(true, true);
        await this.refreshGit(false);
      });
      if (once) {
        await this.do(() => this.saveState());
        return;
      }

      const settle = this.settle();
      let debounce: ReturnType<typeof setTimeout> | null = null;
      const cycleSoon = () => this.schedule("cycle", () => this.cycle(false, false));
      const every = (ms: number, f: () => void) => {
        const t = setInterval(f, ms);
        cleanups.push(() => clearInterval(t));
      };

      if (this.cfg.every > 0) {
        every(this.cfg.every, () => this.schedule("every", () => this.cycle(false, true)));
        this.watcherKind = "every " + formatDuration(this.cfg.every);
      } else {
        const roots = [this.cfg.source];
        if (this.twoWay) roots.push(this.cfg.target);
        let pollMode = false;
        const w = new Watcher(this.cfg.watcher, roots, this.cfg.interval, (_root, rel, isDir) => this.matcher.match(rel, isDir), () => {
          if (pollMode) cycleSoon(); // polling already spaces scans out
          else {
            if (debounce) clearTimeout(debounce);
            debounce = setTimeout(cycleSoon, settle);
          }
        }, (m) => this.warn(m));
        pollMode = w.kind === "poll";
        this.watcherKind = w.kind;
        cleanups.push(() => w.close());
      }
      cleanups.push(() => {
        if (debounce) clearTimeout(debounce);
        if (this.retryTimer) clearTimeout(this.retryTimer);
      });
      void this.do(() => this.publish());

      every(2000, () =>
        this.schedule("guard", async () => {
          if (this.twoWay) await this.processRequests();
          await this.checkGuard();
          await this.refreshGit(false);
          this.publish();
        }),
      );
      if (this.cfg.checkUpstream > 0 && this.isGit) {
        every(this.cfg.checkUpstream, () => this.schedule("upstream", () => this.checkUpstream()));
        this.schedule("upstream", () => this.checkUpstream());
      }
      if (this.cfg.autoCommit.enabled && this.isGit) {
        const ac = this.cfg.autoCommit;
        every(ac.interval, () => this.schedule("autocommit", () => this.doCommit(ac.message, ac.push, true, false)));
      }
      if (this.cfg.backupMaxAge > 0 || this.cfg.backupMaxSize > 0) {
        every(3_600_000, () => this.schedule("prune", () => this.doPruneBackups()));
      }

      if (!signal.aborted) await new Promise<void>((r) => signal.addEventListener("abort", () => r(), { once: true }));
      for (const c of cleanups.splice(0)) c();
      await this.do(() => this.saveState());
    } finally {
      for (const c of cleanups) c();
      this.running = false;
      this.writeStatus(false);
      if (wrotePid) fs.rmSync(pidFile, { force: true });
    }
  }

  private scheduleWake(ms: number): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.schedule("cycle", () => this.cycle(false, false)), ms);
  }

  /** Scans, and when the scan is stable, plans and applies changes. initial/force skip the stability check. */
  async cycle(initial: boolean, force: boolean): Promise<void> {
    if (this.paused()) {
      this.needsApply = true;
      this.publish();
      return;
    }
    const m = this.buildMatcher();
    this.matcher = m;
    let S: Snapshot, T: Snapshot | null = null;
    try {
      S = this.scan(this.cfg.source, m);
    } catch (e) {
      this.errorf("", "scan source: " + errMsg(e));
      return;
    }
    if (this.twoWay) {
      try {
        T = this.scan(this.cfg.target, m);
      } catch (e) {
        this.errorf("", "scan target: " + errMsg(e));
        return;
      }
    }

    if (!initial && !force) {
      const changed = !snapshotsEqual(S, this.lastS) || (this.twoWay && !snapshotsEqual(T, this.lastT));
      if (changed) {
        // wait one settle period and make sure nothing is still being written
        this.lastS = S;
        this.lastT = T;
        this.needsApply = true;
        this.bigSince = 0;
        this.scheduleWake(this.settle());
        this.publish();
        return;
      }
      if (!this.needsApply) return;
    }
    this.lastS = S;
    this.lastT = T;

    let ops = this.twoWay ? this.planTwoWay(S, T!) : this.planOneWay(S);
    ops = this.detectRenames(ops);

    // large batches (npm install, git checkout in source, ...): wait for things to calm down
    const n = countWrites(ops);
    if (n > this.cfg.batchLimit && this.cfg.batchLimit > 0 && !initial) {
      if (this.bigSince === 0) {
        this.bigSince = Date.now();
        this.emit({ kind: "warn", msg: `large batch: ${n} changes, waiting ${formatDuration(this.cfg.batchSettle)} for activity to settle` });
      }
      const waited = Date.now() - this.bigSince;
      if (waited < this.cfg.batchSettle) {
        this.scheduleWake(this.cfg.batchSettle - waited + 50);
        return;
      }
      if (this.cfg.batchAction === "confirm" && !this.approved) {
        if (this.pendingBatch !== n) {
          this.emit({ kind: "warn", msg: `${n} changes waiting for approval (press y in the dashboard)` });
          notify(this.cfg.name + "/batch", "ferry: " + this.cfg.name, `${n} changes waiting for approval`);
        }
        this.pendingBatch = n;
        this.publish();
        return;
      }
    }

    this.needsApply = false;
    this.bigSince = 0;
    this.approved = false;
    this.pendingBatch = 0;

    const failed = await this.apply(ops);
    if (!this.twoWay) {
      const next: Snapshot = new Map();
      for (const [k, v] of S) if (!failed.has(k)) next.set(k, v);
      this.prevSrc = next;
    }
    if (failed.size > 0) {
      this.needsApply = true;
      this.scheduleWake(5000);
    }
    try {
      await this.pushRemote();
    } catch (e) {
      this.errorf("", e);
      this.needsApply = true;
      this.scheduleWake(15_000);
    }
    this.saveState();
    if (countWrites(ops) > 0) await this.refreshGit(true);
    this.publish();
  }

  private settle(): number {
    return this.cfg.settle > 0 ? this.cfg.settle : 300;
  }

  private paused(): boolean {
    return this.userPaused || this.guardReason !== "" || this.branchErr !== "";
  }

  // ---------- planning ----------

  private planOneWay(S: Snapshot): Op[] {
    const ops: Op[] = [];
    for (const rel of sortedKeys(S)) {
      const s = S.get(rel)!;
      const p = this.prevSrc?.get(rel);
      if (p && p.size === s.size && p.mod === s.mod) {
        if (p.mode !== s.mode && !(s.mode & MODE_SYMLINK)) ops.push({ kind: "chmod", rel, side: DST });
        continue;
      }
      const d = this.abs(DST, rel);
      const di = lstat(d);
      if (di && this.sameForTarget(rel, this.abs(SRC, rel), d)) {
        if (!(s.mode & MODE_SYMLINK) && !di.isSymbolicLink() && (Number(di.mode) & 0o777) !== (s.mode & 0o777)) {
          ops.push({ kind: "chmod", rel, side: DST });
        }
        continue;
      }
      ops.push({ kind: "copy", rel, side: DST, isNew: !di });
    }
    if (this.cfg.delete && this.prevSrc) {
      for (const rel of sortedKeys(this.prevSrc)) {
        if (S.has(rel)) continue;
        if (lstat(this.abs(DST, rel))) ops.push({ kind: "delete", rel, side: DST });
      }
    }
    return ops;
  }

  /** Whether a side differs from the last-synced base. */
  private changedSince(s: Side, st: FileStat | undefined, b: Base | undefined, rel: string): boolean {
    if (!b) return !!st;
    if (!st) return true;
    const mod = s === SRC ? b.sm : b.dm;
    const size = sizeOf(b, s);
    if (st.size === size && st.mod === mod) return false;
    if (st.size !== size) return true;
    // same size, new mtime: compare content (touch, checkout, editor re-save)
    let h: string;
    try {
      h = this.hash(this.abs(s, rel));
    } catch {
      return true;
    }
    if (h === hashOf(b, s)) {
      const nb = { ...b };
      if (s === SRC) nb.sm = st.mod;
      else nb.dm = st.mod;
      this.state.set(rel, nb);
      return false;
    }
    return true;
  }

  private planTwoWay(S: Snapshot, T: Snapshot): Op[] {
    const keys = new Set<string>([...S.keys(), ...T.keys(), ...this.state.keys()]);
    const ops: Op[] = [];
    for (const rel of sortedKeys(keys)) {
      const s = S.get(rel), t = T.get(rel);
      let b = this.state.get(rel);

      if (this.conflicts.has(rel)) {
        if (s && t && this.same(this.abs(SRC, rel), this.abs(DST, rel))) {
          this.conflicts.delete(rel);
          ops.push({ kind: "base", rel, side: DST });
          this.emit({ kind: "resolved", path: rel, msg: "both sides now match" });
        }
        continue;
      }

      if (b && b.o) {
        const [o, handled] = this.orphanOps(rel, b, s, t);
        ops.push(...o);
        if (handled) continue;
        // recreated on the side where it was deleted: treat as never synced
        this.state.delete(rel);
        b = undefined;
      }

      const sCh = this.changedSince(SRC, s, b, rel);
      if (b) b = this.state.get(rel); // may have been refreshed
      const tCh = this.changedSince(DST, t, b, rel);

      if (!sCh && !tCh) continue;
      if (sCh && !tCh) ops.push(...this.propagate(SRC, rel, !!s, !!t));
      else if (tCh && !sCh) ops.push(...this.propagate(DST, rel, !!t, !!s));
      else if (!s && !t) ops.push({ kind: "dropBase", rel, side: DST });
      else if (s && t && this.same(this.abs(SRC, rel), this.abs(DST, rel))) ops.push({ kind: "base", rel, side: DST });
      else {
        if (this.cfg.merge && s && t) {
          const o = this.mergeOp(rel, true);
          if (o) {
            ops.push(o);
            continue;
          }
        }
        ops.push(...this.conflictOps(rel));
      }
    }
    return ops;
  }

  /** Pushes a change made on `from` to the other side. */
  private propagate(from: Side, rel: string, fromOK: boolean, toOK: boolean): Op[] {
    const to = other(from);
    if (fromOK) return [{ kind: "copy", rel, side: to, isNew: !toOK }];
    // deleted on `from`
    if (!toOK) return [{ kind: "dropBase", rel, side: to }];
    switch (this.cfg.onDelete) {
      case "propagate":
        return [{ kind: "delete", rel, side: to }];
      case "restore":
        return [{ kind: "copy", rel, side: from, isNew: true, restore: true }];
      default: // keep: leave the other copy alone and remember not to copy it back
        return [{ kind: "orphan", rel, side: to }];
    }
  }

  /**
   * A file deleted on one side and kept on the other. handled=false means it
   * was recreated on the deleted side and should be planned as a fresh file.
   */
  private orphanOps(rel: string, b: Base, s: FileStat | undefined, t: FileStat | undefined): [Op[], boolean] {
    const surv = survivor(b);
    const survSt = surv === SRC ? s : t;
    const gone = surv === SRC ? t : s;
    const mod = surv === SRC ? b.sm : b.dm;
    if (gone) return [[], false];
    if (!survSt) return [[{ kind: "dropBase", rel, side: DST }], true];
    if (survSt.size === sizeOf(b, surv) && survSt.mod === mod) return [[], true];
    if (survSt.size === sizeOf(b, surv)) {
      try {
        if (this.hash(this.abs(surv, rel)) === hashOf(b, surv)) {
          const nb = { ...b };
          if (surv === SRC) nb.sm = survSt.mod;
          else nb.dm = survSt.mod;
          this.state.set(rel, nb);
          return [[], true];
        }
      } catch {}
    }
    // the kept copy was edited again: it's live work, bring it back
    this.emit({
      kind: "info", path: rel,
      msg: `edited in ${sideName(surv)} after being deleted in ${sideName(other(surv))}; copying it back`,
    });
    return [[{ kind: "copy", rel, side: other(surv), isNew: true }], true];
  }

  private conflictOps(rel: string): Op[] {
    if (this.cfg.conflict === "ask" || this.cfg.conflict === "hold") return [{ kind: "conflict", rel, side: DST }];
    this.emit({ kind: "conflict", path: rel, msg: "changed on both sides; auto-resolving: " + this.cfg.conflict });
    return this.resolveOps(rel, this.cfg.conflict as Choice);
  }

  /** Turns a conflict choice into concrete operations. */
  resolveOps(rel: string, c: Choice): Op[] {
    const si = stat(this.abs(SRC, rel)), ti = stat(this.abs(DST, rel));
    const winner = (w: Side): Op[] => {
      const wok = w === SRC ? !!si : !!ti;
      const lok = w === SRC ? !!ti : !!si;
      if (wok) return [{ kind: "copy", rel, side: other(w), isNew: !lok }];
      if (lok) return [{ kind: "delete", rel, side: other(w) }];
      return [{ kind: "dropBase", rel, side: DST }];
    };
    if (!si && !ti) return [{ kind: "dropBase", rel, side: DST }];
    if (!si || !ti) {
      if (c === "source") return winner(SRC);
      if (c === "target") return winner(DST);
      // newer / keep-both / merge: a surviving edit beats a deletion
      return winner(si ? SRC : DST);
    }
    if (c === "source") return winner(SRC);
    if (c === "target") return winner(DST);
    if (c === "newer") return winner(si.mtimeNs > ti.mtimeNs ? SRC : DST);
    if (c === "merge") {
      const o = this.mergeOp(rel, false);
      if (o) return [o];
      this.warn(rel + ": can't merge (no saved common version, or not a text file); keeping both instead");
    }
    // keep-both: the target version keeps the name, the source version is saved alongside
    const cp = conflictName(rel, "source");
    return [
      { kind: "dup", rel, to: cp, side: SRC },
      { kind: "copy", rel, side: SRC },
    ];
  }

  /**
   * Replaces delete+add pairs with identical content by a rename. In two-way
   * mode without delete propagation, a "restore" of the old name plus a copy
   * of the new name is also recognised as a rename on the other side.
   */
  private detectRenames(ops: Op[]): Op[] {
    const dels = new Map<string, { idx: number; side: Side }[]>();
    ops.forEach((o, i) => {
      let where: Side;
      if (o.kind === "delete") where = o.side;
      else if (o.kind === "copy" && o.restore) where = other(o.side);
      else if (o.kind === "orphan") where = o.side;
      else return;
      const fi = stat(this.abs(where, o.rel));
      if (!fi) return;
      const k = `${where}|${fi.size}`;
      dels.set(k, [...(dels.get(k) ?? []), { idx: i, side: where }]);
    });
    if (dels.size === 0) return ops;
    const drop = new Set<number>();
    ops.forEach((o, i) => {
      if (o.kind !== "copy" || !o.isNew || o.restore) return;
      const fi = stat(this.abs(other(o.side), o.rel));
      if (!fi) return;
      for (const c of dels.get(`${o.side}|${fi.size}`) ?? []) {
        if (drop.has(c.idx)) continue;
        if (this.same(this.abs(other(o.side), o.rel), this.abs(c.side, ops[c.idx]!.rel))) {
          ops[i] = { kind: "rename", rel: ops[c.idx]!.rel, to: o.rel, side: o.side };
          drop.add(c.idx);
          break;
        }
      }
    });
    return ops.filter((_, i) => !drop.has(i));
  }

  // ---------- three-way merge support ----------

  private baseCopyPath(rel: string): string {
    return path.join(this.dataDir, this.id, "base", fromSlash(rel));
  }

  private saveBaseCopy(rel: string, p: string, size: number): void {
    if (size > MERGE_MAX || isBinaryFile(p)) {
      this.dropBaseCopy(rel);
      return;
    }
    try {
      copyFile(p, this.baseCopyPath(rel));
    } catch {}
  }

  private dropBaseCopy(rel: string): void {
    if (this.cfg.merge) fs.rmSync(this.baseCopyPath(rel), { force: true });
  }

  /** A three-way merge of rel. With clean=true it fails when edits overlap; otherwise overlaps get markers. */
  private mergeOp(rel: string, clean: boolean): Op | null {
    try {
      const baseData = fs.readFileSync(this.baseCopyPath(rel));
      const s = fs.readFileSync(this.abs(SRC, rel));
      const t = fs.readFileSync(this.abs(DST, rel));
      if (s.length > MERGE_MAX || t.length > MERGE_MAX || isBinary(s) || isBinary(t)) return null;
      const { data, conflicts } = merge3(baseData, t, s, { ours: "target", theirs: "source" });
      if (clean && conflicts > 0) return null;
      return { kind: "merge", rel, side: DST, data, markers: conflicts };
    } catch {
      return null;
    }
  }

  // ---------- applying ----------

  private async apply(ops: Op[]): Promise<Set<string>> {
    const failed = new Set<string>();
    const gap = this.cfg.maxOpsPerSec > 0 ? 1000 / this.cfg.maxOpsPerSec : 0;
    let added = 0, updated = 0, deleted = 0, renamed = 0, skipped = 0, errs = 0;
    const bdir = backupDir(this.dataDir, this.id);
    const journal: JournalEntry[] = [];
    const note = (op: string, s: Side, rel: string, to: string, backup: string) => {
      const en: JournalEntry = { op, side: sideName(s), path: rel };
      if (to) en.to = to;
      if (backup) en.backup = backup;
      journal.push(en);
    };
    const count = (isNew: boolean | undefined) => (isNew ? added++ : updated++);
    const dry = this.cfg.dryRun;

    for (const o of ops) {
      if (gap && countWrites([o]) > 0) await sleep(gap);
      switch (o.kind) {
        case "base":
          this.recordBase(o.rel);
          break;
        case "dropBase":
          this.state.delete(o.rel);
          this.dropBaseCopy(o.rel);
          break;
        case "orphan": {
          const kept = `deleted in ${sideName(other(o.side))}; kept in ${sideName(o.side)}`;
          if (dry) {
            this.emit({ kind: "kept", path: o.rel, msg: kept });
            break;
          }
          const p = this.abs(o.side, o.rel);
          const fi = stat(p);
          let h = "";
          try {
            h = this.hash(p);
          } catch {}
          if (!fi || !h) {
            this.state.delete(o.rel);
            break;
          }
          const b: Base = { h, s: Number(fi.size), sm: 0, dm: 0, o: o.side + 1 };
          if (o.side === SRC) b.sm = mtimeNs(fi);
          else b.dm = mtimeNs(fi);
          this.state.set(o.rel, b);
          this.emit({ kind: "kept", path: o.rel, msg: kept + " (on_delete: keep)" });
          this.track(o.rel, "kept", "");
          break;
        }
        case "conflict":
          if (!this.conflicts.has(o.rel)) {
            this.conflicts.add(o.rel);
            const msg = this.cfg.conflict === "hold"
              ? `changed on both sides; both files left as they are. Resolve with: ferry resolve ${o.rel} --keep source|target|newer|both|merge`
              : "changed on both sides; choose a version";
            this.emit({ kind: "conflict", path: o.rel, msg, held: true });
            this.track(o.rel, "conflict", "");
            notify(this.cfg.name + "/conflict", "ferry: conflict in " + this.cfg.name, o.rel + " changed on both sides");
          }
          break;
        case "chmod": {
          if (dry) break;
          const fi = stat(this.abs(SRC, o.rel));
          if (!fi) break;
          const perm = Number(fi.mode) & 0o777;
          try {
            fs.chmodSync(this.abs(DST, o.rel), perm);
            this.emit({ kind: "info", path: o.rel, msg: `permissions updated (${permString(perm)})` });
            this.remoteQueue(o.rel, false);
          } catch {}
          break;
        }
        case "copy": {
          const from = other(o.side);
          const fp = this.abs(from, o.rel), tp = this.abs(o.side, o.rel);
          const kind: Kind = o.isNew ? "add" : "update";
          if (this.cfg.symlinks === "link" && isSymlink(fp)) {
            if (dry) {
              this.emit({ kind, path: o.rel, dir: arrow(o.side), msg: "symlink" });
              count(o.isNew);
              break;
            }
            const bk = o.isNew ? "" : backupFile(bdir, sideName(o.side), o.rel, tp, this.cfg.backups);
            try {
              copyLink(fp, tp);
            } catch (e) {
              failed.add(o.rel);
              errs++;
              this.errorf(o.rel, e);
              break;
            }
            note(kind, o.side, o.rel, "", bk);
            this.recordBase(o.rel);
            this.emit({ kind, path: o.rel, dir: arrow(o.side), msg: "symlink" });
            this.track(o.rel, kind, arrow(o.side));
            this.remoteQueue(o.rel, false);
            count(o.isNew);
            break;
          }
          const fi = stat(fp);
          if (!fi) {
            failed.add(o.rel);
            break;
          }
          const fst: FileStat = { size: Number(fi.size), mod: mtimeNs(fi), mode: Number(fi.mode) & 0o777 };
          const size = fst.size;
          const binary = isBinaryFile(fp);
          const tooBig = this.cfg.maxSize > 0 && size > this.cfg.maxSize;
          let viaLFS = false;
          if (this.cfg.lfs && o.side === DST && this.isGit && (tooBig || (binary && this.cfg.binary !== "allow"))) {
            viaLFS = await this.ensureLFS(o.rel);
          }
          if (tooBig && !viaLFS) {
            if (!sameStat(this.skipped.get(o.rel), fst)) {
              this.emit({ kind: "skip", path: o.rel, msg: `too large (${humanSize(size)} > ${humanSize(this.cfg.maxSize)})` });
              this.skipped.set(o.rel, fst);
            }
            skipped++;
            break;
          }
          if (binary && this.cfg.binary !== "allow" && !viaLFS) {
            if (this.cfg.binary === "skip") {
              if (!sameStat(this.skipped.get(o.rel), fst)) {
                this.emit({ kind: "skip", path: o.rel, msg: "binary file" });
                this.skipped.set(o.rel, fst);
              }
              skipped++;
              break;
            }
            if (o.isNew) this.emit({ kind: "warn", path: o.rel, msg: `binary file (${humanSize(size)}) — are you sure it belongs in git?` });
          }
          // in redact mode secrets are replaced below instead of reported
          let content: Buffer | null = null, rewriteNote = "";
          if (o.side === DST && !binary && this.rewrites(o.rel)) {
            const tc = this.targetContent(o.rel, fp);
            if (tc.block) {
              if (!sameStat(this.secretSeen.get(o.rel), fst)) {
                this.emit({ kind: "skip", path: o.rel, msg: `possible secret: ${tc.block} — not copied (secrets: redact)` });
                notify(this.cfg.name + "/secret", "ferry: held back a possible secret", o.rel);
                this.secretSeen.set(o.rel, fst);
              }
              skipped++;
              break;
            }
            content = tc.data;
            rewriteNote = tc.note ?? "";
          }
          if (o.side === DST && this.cfg.secrets !== "off" && this.cfg.secrets !== "redact" && !binary) {
            const hits = this.checkSecrets(o.rel, fp);
            if (hits.length > 0) {
              const msg = "possible secret: " + hits.join(", ");
              const fresh = !sameStat(this.secretSeen.get(o.rel), fst);
              if (this.cfg.secrets === "block") {
                if (fresh) {
                  this.emit({ kind: "skip", path: o.rel, msg: msg + " — not copied (secrets: block; allow it with secret_allow)" });
                  notify(this.cfg.name + "/secret", "ferry: blocked a possible secret", o.rel);
                  this.secretSeen.set(o.rel, fst);
                }
                skipped++;
                break;
              }
              if (fresh) {
                this.emit({ kind: "warn", path: o.rel, msg: msg + " — check before committing" });
                notify(this.cfg.name + "/secret", "ferry: possible secret in " + this.cfg.name, o.rel);
                this.secretSeen.set(o.rel, fst);
              }
            }
          }
          this.skipped.delete(o.rel);
          if (dry) {
            this.emit({ kind, path: o.rel, dir: arrow(o.side), msg: rewriteNote || undefined });
            count(o.isNew);
            break;
          }
          const bk = o.isNew ? "" : backupFile(bdir, sideName(o.side), o.rel, tp, this.cfg.backups);
          try {
            if (content) {
              writeFileAtomic(tp, this.cfg.eol !== "keep" ? convertEOL(content, this.cfg.eol) : content, fst.mode, fst.mod);
            } else if (o.side === DST && this.cfg.eol !== "keep" && !binary) {
              writeFileAtomic(tp, convertEOL(fs.readFileSync(fp), this.cfg.eol), fst.mode, fst.mod);
            } else {
              copyFile(fp, tp);
            }
          } catch (e) {
            failed.add(o.rel);
            errs++;
            this.errorf(o.rel, e);
            break;
          }
          note(kind, o.side, o.rel, "", bk);
          this.recordBase(o.rel);
          this.emit({ kind, path: o.rel, dir: arrow(o.side), msg: rewriteNote || undefined });
          this.track(o.rel, kind, arrow(o.side));
          this.remoteQueue(o.rel, false);
          count(o.isNew);
          break;
        }
        case "delete": {
          if (dry) {
            this.emit({ kind: "delete", path: o.rel, dir: arrow(o.side) });
            deleted++;
            break;
          }
          const p = this.abs(o.side, o.rel);
          const bk = backupFile(bdir, sideName(o.side), o.rel, p, this.cfg.backups);
          try {
            if (this.cfg.trash) {
              try {
                await moveToTrash(p);
              } catch {
                removeWithRetry(p);
              }
            } else removeWithRetry(p);
          } catch (e) {
            failed.add(o.rel);
            errs++;
            this.errorf(o.rel, e);
            break;
          }
          removeEmptyParents(this.root(o.side), p);
          this.state.delete(o.rel);
          this.dropBaseCopy(o.rel);
          note("delete", o.side, o.rel, "", bk);
          this.emit({ kind: "delete", path: o.rel, dir: arrow(o.side) });
          this.track(o.rel, "delete", arrow(o.side));
          this.remoteQueue(o.rel, true);
          deleted++;
          break;
        }
        case "rename": {
          const to = o.to!;
          if (dry) {
            this.emit({ kind: "rename", path: o.rel, to, dir: arrow(o.side) });
            renamed++;
            break;
          }
          const fromP = this.abs(o.side, o.rel), toP = this.abs(o.side, to);
          try {
            fs.mkdirSync(path.dirname(toP), { recursive: true });
            replaceFile(fromP, toP);
          } catch (e) {
            failed.add(to);
            errs++;
            this.errorf(o.rel, e);
            break;
          }
          removeEmptyParents(this.root(o.side), fromP);
          this.state.delete(o.rel);
          this.dropBaseCopy(o.rel);
          this.recordBase(to);
          note("rename", o.side, o.rel, to, "");
          this.emit({ kind: "rename", path: o.rel, to, dir: arrow(o.side) });
          this.untrack(o.rel);
          this.track(to, "rename", arrow(o.side));
          this.remoteQueue(o.rel, true);
          this.remoteQueue(to, false);
          renamed++;
          break;
        }
        case "dup": {
          if (dry) break;
          try {
            copyFile(this.abs(o.side, o.rel), this.abs(o.side, o.to!));
          } catch (e) {
            failed.add(o.rel);
            errs++;
            this.errorf(o.to!, e);
            break;
          }
          note("add", o.side, o.to!, "", "");
          this.emit({ kind: "info", path: o.to, msg: `kept ${sideName(o.side)} version of ${o.rel}` });
          break;
        }
        case "merge": {
          if (dry) {
            this.emit({ kind: "update", path: o.rel, dir: "⇄", msg: "three-way merge" });
            updated++;
            break;
          }
          let ok = true;
          for (const s of [SRC, DST] as Side[]) {
            const p = this.abs(s, o.rel);
            const fi = stat(p);
            const perm = fi ? Number(fi.mode) & 0o777 : 0;
            const bk = backupFile(bdir, sideName(s), o.rel, p, this.cfg.backups);
            try {
              writeFileAtomic(p, o.data!, perm, 0);
            } catch (e) {
              failed.add(o.rel);
              errs++;
              this.errorf(o.rel, e);
              ok = false;
              break;
            }
            note("update", s, o.rel, "", bk);
          }
          if (!ok) break;
          this.conflicts.delete(o.rel);
          this.recordBase(o.rel);
          if (o.markers! > 0) {
            this.emit({ kind: "warn", path: o.rel, dir: "⇄", msg: `merged with ${o.markers} conflict block(s); fix the <<<<<<< markers on either side` });
          } else {
            this.emit({ kind: "resolved", path: o.rel, dir: "⇄", msg: "merged edits from both sides" });
          }
          this.track(o.rel, "update", "⇄");
          updated++;
          break;
        }
      }
    }
    if (journal.length > 0 && !dry) this.appendJournal(journal);
    if (added + updated + deleted + renamed + skipped + errs > 0) {
      const st = this.status;
      st.added += added;
      st.updated += updated;
      st.deleted += deleted;
      st.renamed += renamed;
      st.skipped += skipped;
      st.failed += errs;
      if (added + updated + deleted + renamed > 0) st.lastSync = Date.now();
      if (added + updated + deleted + renamed + errs > 0 && !dry) {
        this.emit({ kind: "synced", msg: `+${added} ~${updated} -${deleted} ↻${renamed} !${errs}` });
      }
    }
    return failed;
  }

  private recordBase(rel: string): void {
    if (!this.twoWay || this.cfg.dryRun) return;
    const sp = this.abs(SRC, rel), tp = this.abs(DST, rel);
    const si = stat(sp), ti = stat(tp);
    if (!si || !ti) {
      this.state.delete(rel);
      this.dropBaseCopy(rel);
      return;
    }
    let h: string;
    try {
      h = this.hash(tp);
    } catch {
      return;
    }
    const b: Base = { h, s: Number(ti.size), sm: mtimeNs(si), dm: mtimeNs(ti) };
    if (si.size !== ti.size || this.cfg.eol !== "keep") {
      try {
        const sh = this.hash(sp);
        if (sh !== h) {
          b.sh = sh;
          b.ss = Number(si.size);
        }
      } catch {}
    }
    this.state.set(rel, b);
    if (this.cfg.merge) this.saveBaseCopy(rel, tp, Number(ti.size));
  }

  /** Makes sure files like rel are tracked by git LFS in the target. */
  private async ensureLFS(rel: string): Promise<boolean> {
    const ext = goExt(rel);
    const pattern = ext === "" ? "/" + rel : "*" + ext;
    const known = this.lfsTracked.get(pattern);
    if (known !== undefined) return known;
    if (!(await gitx.lfsAvailable(this.gitTarget))) {
      this.warn("lfs: true, but git-lfs is not installed; large and binary files are handled as usual");
      this.lfsTracked.set(pattern, false);
      return false;
    }
    try {
      await gitx.lfsTrack(this.gitTarget, pattern);
    } catch (e) {
      this.warn("git lfs track " + pattern + ": " + firstLine(errMsg(e)));
      this.lfsTracked.set(pattern, false);
      return false;
    }
    this.emit({ kind: "info", msg: "tracking " + pattern + " with git LFS" });
    this.lfsTracked.set(pattern, true);
    return true;
  }

  /** The transform command for rel, if any (first matching glob wins, in config order). */
  private transformFor(rel: string): string {
    if (!this.transforms) return "";
    for (const [m, cmd] of this.transforms) if (m.match(rel, false)) return cmd;
    return "";
  }

  /** Whether files written to the target may differ from their source (transform or redact). */
  private rewrites(rel: string): boolean {
    return this.transformFor(rel) !== "" || this.cfg.secrets === "redact";
  }

  /**
   * The content the target should get for a source file, when it isn't a
   * plain copy: the file piped through its transform command, then with
   * secrets redacted. null means "copy as is"; block means "don't copy".
   * Results are cached by source path, size and mtime.
   */
  private targetContent(rel: string, src: string): { data: Buffer | null; block?: string; note?: string } {
    const cmd = this.transformFor(rel);
    const redact = this.cfg.secrets === "redact" && !this.secretAllow?.match(rel, false);
    if (!cmd && !redact) return { data: null };
    const fi = stat(src);
    if (!fi) return { data: null };
    const key = `${fi.size}|${fi.mtimeNs}`;
    const hit = this.rewriteCache.get(rel);
    if (hit && hit.key === key) return hit.out;
    let out: { data: Buffer | null; block?: string; note?: string } = { data: null };
    if (Number(fi.size) <= TRANSFORM_MAX && !isBinaryFile(src)) {
      let data: Buffer = fs.readFileSync(src);
      const notes: string[] = [];
      let changed = false;
      if (cmd) {
        const r = runTransform(cmd, rel, this.cfg.source, data);
        if (r.ok) {
          data = r.data;
          changed = true;
          notes.push("transformed");
        } else {
          this.warn(`${rel}: transform failed, copying it unchanged: ${r.error}`);
        }
      }
      if (redact) {
        const red = redactSecrets(rel, data);
        if (red.block) out = { data: null, block: secretNameHit(rel) + " that can't be redacted" };
        else if (red.count > 0) {
          data = red.data;
          changed = true;
          notes.push(`${red.count} secret(s) redacted`);
        }
      }
      if (!out.block && changed) out = { data, note: notes.join(", ") };
    } else if (redact && secretNameHit(rel) !== "" && secretNameHit(rel) !== "environment file") {
      out = { data: null, block: secretNameHit(rel) + " that can't be redacted" };
    }
    if (this.rewriteCache.size > 5000) this.rewriteCache.clear();
    this.rewriteCache.set(rel, { key, out });
    return out;
  }

  /** What looks like a credential in a file about to be copied into the target, unless secret_allow matches. */
  private checkSecrets(rel: string, p: string): string[] {
    if (this.secretAllow?.match(rel, false)) return [];
    const hits: string[] = [];
    const h = secretNameHit(rel);
    if (h) hits.push(h);
    hits.push(...scanSecretFile(p));
    return hits;
  }

  private track(rel: string, kind: Kind, dir: string): void {
    if (this.changed.size > 5000) return;
    this.changed.set(rel, { path: rel, kind, dir, time: Date.now() });
  }

  private untrack(rel: string): void {
    this.changed.delete(rel);
  }

  // ---------- hashing ----------

  private hashPath(): string {
    return path.join(this.dataDir, this.id, "hashes.json");
  }

  /** The content hash of p, from the cache when possible. Throws if p can't be read. */
  private hash(p: string): string {
    return this.hashes.get(p);
  }

  /**
   * Whether two files have the same content. Symlinks (in link mode) compare
   * their targets; with eol conversion on, line endings are ignored for text.
   */
  private same(a: string, b: string): boolean {
    if (this.cfg.symlinks === "link") {
      const la = isSymlink(a), lb = isSymlink(b);
      if (la || lb) {
        if (!la || !lb) return false;
        try {
          return fs.readlinkSync(a) === fs.readlinkSync(b);
        } catch {
          return false;
        }
      }
    }
    const ia = stat(a), ib = stat(b);
    if (!ia || !ib) return false;
    if (ia.size === ib.size) {
      try {
        if (this.hash(a) === this.hash(b)) return true;
      } catch {}
    }
    if (this.cfg.eol === "keep") return false;
    return sameIgnoringEOL(a, b, ia, ib);
  }

  /** Whether the target file already holds what the source would produce (after transform/redact). */
  private sameForTarget(rel: string, src: string, dst: string): boolean {
    if (!this.rewrites(rel)) return this.same(src, dst);
    const tc = this.targetContent(rel, src);
    if (tc.block) return false;
    if (!tc.data) return this.same(src, dst);
    let want = tc.data;
    if (this.cfg.eol !== "keep") want = convertEOL(want, this.cfg.eol);
    const di = stat(dst);
    if (!di || Number(di.size) !== want.length) return false;
    try {
      return this.hash(dst) === crypto.createHash("sha256").update(want).digest("hex");
    } catch {
      return false;
    }
  }

  // ---------- mirror ----------

  /** Target files that don't exist in the source (respecting ignores). */
  planMirror(): string[] {
    const m = this.buildMatcher();
    const S = this.scan(this.cfg.source, m);
    const T = this.scan(this.cfg.target, m);
    return sortedKeys(T).filter((rel) => !S.has(rel));
  }

  /** Must be called before run() with the list the user confirmed. */
  approveMirror(list: string[]): void {
    this.mirrorList = list;
  }

  private async applyMirror(): Promise<void> {
    const ops: Op[] = this.mirrorList.map((rel) => ({ kind: "delete", rel, side: DST }));
    this.emit({ kind: "info", msg: `mirror: removing ${ops.length} target files not in source` });
    await this.apply(ops);
    this.mirrorList = [];
  }

  // ---------- plan ----------

  /** What a sync pass would do right now, without writing anything. */
  plan(): Change[] {
    const m = this.buildMatcher();
    const S = this.scan(this.cfg.source, m);
    let ops: Op[];
    if (this.twoWay) {
      this.loadState();
      ops = this.planTwoWay(S, this.scan(this.cfg.target, m));
    } else {
      ops = this.planOneWay(S);
    }
    ops = this.detectRenames(ops);
    const out: Change[] = sortedKeys(this.conflicts).map((c) => ({ kind: "conflict", path: c, note: "held from an earlier run" }));
    for (const o of ops) {
      switch (o.kind) {
        case "copy":
          out.push({ kind: o.isNew ? "add" : "update", path: o.rel, dir: arrow(o.side) });
          break;
        case "delete":
          out.push({ kind: "delete", path: o.rel, dir: arrow(o.side) });
          break;
        case "rename":
          out.push({ kind: "rename", path: o.rel, to: o.to, dir: arrow(o.side) });
          break;
        case "conflict":
          out.push({ kind: "conflict", path: o.rel, note: "changed on both sides" });
          break;
        case "orphan":
          out.push({ kind: "kept", path: o.rel, note: `deleted in ${sideName(other(o.side))}; kept in ${sideName(o.side)}` });
          break;
        case "merge":
          out.push({ kind: "update", path: o.rel, dir: "⇄", note: "three-way merge" + (o.markers! > 0 ? " with conflict markers" : "") });
          break;
        case "dup":
          out.push({ kind: "add", path: o.to!, dir: arrow(o.side), note: "copy of " + o.rel });
          break;
        case "chmod":
          out.push({ kind: "update", path: o.rel, dir: arrow(o.side), note: "permissions only" });
          break;
      }
    }
    return out;
  }

  // ---------- backups ----------

  private doPruneBackups(): void {
    if (this.cfg.dryRun || (this.cfg.backupMaxAge <= 0 && this.cfg.backupMaxSize <= 0)) return;
    const { removed, freed } = pruneBackups(this.dataDir, this.id, this.cfg.backupMaxAge, this.cfg.backupMaxSize);
    if (removed > 0) this.emit({ kind: "info", msg: `pruned ${removed} old backup(s), freed ${humanSize(freed)}` });
  }

  // ---------- git ----------

  private async checkGuard(): Promise<void> {
    let reason = this.branchErr;
    if (reason === "" && this.isGit && this.cfg.gitGuard) reason = await gitx.inProgress(this.gitTarget);
    if (reason === "" && this.isGit && this.behindBy > 0) reason = `target is ${this.behindBy} commit(s) behind upstream — pull first`;
    let windowed = false;
    if (reason === "" && !inWindow(this.cfg, new Date())) {
      reason = "outside the sync window (" + windowLabel(this.cfg) + ")";
      windowed = true;
    }
    if (reason === this.guardReason) return;
    const was = this.guardReason;
    this.guardReason = reason;
    if (reason !== "") {
      this.emit({ kind: "paused", msg: reason });
      if (!windowed) notify(this.cfg.name + "/guard", "ferry paused: " + this.cfg.name, reason);
    } else if (was !== "") {
      this.emit({ kind: "resumed", msg: "clear again; resuming" });
      if (this.needsApply || was.startsWith("outside the sync window")) await this.cycle(false, true);
    }
    this.publish();
  }

  private async checkUpstream(): Promise<void> {
    try {
      await gitx.fetch(this.gitTarget);
    } catch (e) {
      this.warn("fetch failed: " + firstLine(errMsg(e)));
      return;
    }
    this.behindBy = await gitx.behind(this.gitTarget);
    if (this.behindBy > 0 && this.cfg.autoPull && (await gitx.inProgress(this.gitTarget)) === "") {
      try {
        await gitx.pullRebase(this.gitTarget);
        this.emit({ kind: "info", msg: `pulled ${this.behindBy} commit(s) from upstream` });
        this.behindBy = 0;
      } catch (e) {
        this.warn("auto pull failed, pausing instead: " + firstLine(errMsg(e)));
      }
    }
    await this.checkGuard();
  }

  private async refreshGit(emit: boolean): Promise<void> {
    if (!this.isGit) return;
    let lines: string[];
    try {
      lines = await gitx.status(this.gitTarget);
    } catch {
      return;
    }
    const branch = await gitx.currentBranch(this.gitTarget);
    this.status.gitStatus = lines;
    this.status.branch = branch;
    if (emit) this.emit({ kind: "git", lines, msg: branch });
  }

  private async doCommit(tmpl: string, push: boolean, auto: boolean, stagedOnly: boolean): Promise<void> {
    if (!this.isGit) {
      this.warn("target is not a git repo; nothing to commit");
      return;
    }
    const r = await gitx.inProgress(this.gitTarget);
    if (r !== "") {
      if (!auto) this.warn("not committing: " + r);
      return;
    }
    const lines = await gitx.status(this.gitTarget).catch(() => [] as string[]);
    if (lines.length === 0 || (stagedOnly && gitx.stagedCount(lines) === 0)) {
      if (!auto) this.emit({ kind: "info", msg: "nothing to commit" });
      return;
    }
    if (this.cfg.beforeCommit !== "") {
      this.emit({ kind: "info", msg: "running before_commit: " + this.cfg.beforeCommit });
      const res = await this.runHook(this.cfg.beforeCommit);
      if (res.code !== 0) {
        this.errorf("", `not committing: before_commit failed (${res.error}): ${lastLines(res.output, 3)}`);
        return;
      }
    }
    let msg = expandMessage(tmpl, this.cfg, lines);
    if (msg.includes("{ai}")) {
      this.emit({ kind: "info", msg: "asking Claude for a commit message…" });
      const { msg: written, error } = await ai.tryCommitMessage(lines, await gitx.pendingDiff(this.gitTarget, stagedOnly));
      if (written === null) this.warn("AI commit message unavailable (" + error + "); using the generated summary");
      msg = msg.replaceAll("{ai}", written ?? summarizeStatus(lines));
    }
    const opts = { author: this.cfg.commitAuthor, sign: this.cfg.signCommits };
    let hash: string;
    try {
      hash = stagedOnly ? await gitx.commitStaged(this.gitTarget, msg, opts) : await gitx.commitAll(this.gitTarget, msg, opts);
    } catch (e) {
      this.errorf("", "commit failed: " + firstLine(errMsg(e)));
      return;
    }
    if (hash === "") return;
    this.emit({ kind: "commit", msg: `${hash} ${firstLine(msg)}` });
    if (push) await this.push();
    await this.refreshGit(true);
    this.publish();
  }

  private async push(): Promise<void> {
    if (this.cfg.pullRebase) {
      try {
        await gitx.pullRebase(this.gitTarget);
      } catch (e) {
        this.errorf("", "pull --rebase failed, not pushing: " + firstLine(errMsg(e)));
        return;
      }
    }
    try {
      await gitx.push(this.gitTarget);
    } catch (e) {
      this.errorf("", "push failed: " + firstLine(errMsg(e)));
      return;
    }
    this.emit({ kind: "commit", msg: "pushed " + (await gitx.currentBranch(this.gitTarget)) });
    if (this.cfg.pr) {
      try {
        const { url, created } = await gitx.ensurePR(this.gitTarget, this.cfg.prBase);
        if (created) this.emit({ kind: "commit", msg: "opened pull request " + url });
        else this.emit({ kind: "info", msg: "pull request already open: " + url });
      } catch (e) {
        this.warn("pull request: " + firstLine(errMsg(e)));
      }
    }
  }

  /** Runs a shell command in the target folder (on the host for remote pairs), with a 10 minute limit. */
  private async runHook(command: string) {
    const timeoutMs = 10 * 60_000;
    if (this.cfg.remote !== "") {
      try {
        const sp = remote.parse(this.cfg.remote);
        return await sp.run("cd " + sp.dir() + " && " + command, { timeoutMs });
      } catch (e) {
        return { code: -1, stdout: "", stderr: errMsg(e), output: errMsg(e), error: errMsg(e) };
      }
    }
    const cmd = isWindows ? ["cmd", "/C", command] : ["sh", "-c", command];
    return exec(cmd, { cwd: this.cfg.target, timeoutMs });
  }

  // ---------- remote (ssh) targets ----------
  // Remote pairs sync into a local shadow folder exactly like a local target.
  // After each batch the changed files are streamed to the host as one tar
  // archive over ssh, and deletions are applied with rm.

  private remoteQueue(rel: string, deleted: boolean): void {
    if ((this.cfg.remote === "" && this.cfg.cloud === "") || this.cfg.dryRun) return;
    if (deleted) {
      this.remoteAdd.delete(rel);
      this.remoteDel.add(rel);
    } else {
      this.remoteDel.delete(rel);
      this.remoteAdd.add(rel);
    }
  }

  /** Sends queued changes to the ssh target. On failure the queue is kept for the next pass. */
  private async pushRemote(): Promise<void> {
    if (this.cfg.cloud !== "") return this.pushCloud();
    if (this.cfg.remote === "" || this.cfg.dryRun) return;
    if (this.remoteFull) {
      for (const rel of scanDir(this.cfg.target, new Matcher(...HARD_IGNORES), false, null, "link").keys()) this.remoteAdd.add(rel);
    }
    if (this.remoteAdd.size === 0 && this.remoteDel.size === 0) {
      this.remoteFull = false;
      return;
    }
    const sp = remote.parse(this.cfg.remote);
    const adds = sortedKeys(this.remoteAdd), dels = sortedKeys(this.remoteDel);
    fs.mkdirSync(this.dataDir, { recursive: true });
    const archive = path.join(this.dataDir, `push-${crypto.randomBytes(6).toString("hex")}.tar`);
    try {
      this.writeTar(archive, adds);
      let script = "mkdir -p " + sp.dir() + " && tar -xf - -C " + sp.dir();
      if (dels.length > 0) script += " && cd " + sp.dir() + " && rm -f -- " + dels.map(remote.quote).join(" ");
      const r = await sp.run(script, { stdin: { file: archive }, timeoutMs: 15 * 60_000 });
      if (r.code !== 0) {
        throw new Error(`push to ${this.cfg.remote} failed: ${firstLine(r.output.trim() || r.error || "")}`);
      }
    } finally {
      fs.rmSync(archive, { force: true });
    }
    this.emit({ kind: "info", msg: `pushed ${adds.length} file(s) and removed ${dels.length} on ${this.cfg.remote}` });
    this.remoteAdd.clear();
    this.remoteDel.clear();
    this.remoteFull = false;
  }

  /**
   * Uploads queued changes to the cloud target and deletes removed objects.
   * Each object that made it is taken off the queue, so a failure retries
   * only what is left.
   */
  private async pushCloud(): Promise<void> {
    if (this.cfg.dryRun) return;
    if (this.remoteFull) {
      for (const rel of scanDir(this.cfg.target, new Matcher(...HARD_IGNORES), false, null, "follow").keys()) this.remoteAdd.add(rel);
    }
    if (this.remoteAdd.size === 0 && this.remoteDel.size === 0) {
      this.remoteFull = false;
      return;
    }
    const spec = cloud.parse(this.cfg.cloud);
    const store = cloud.open(spec);
    const adds = sortedKeys(this.remoteAdd), dels = sortedKeys(this.remoteDel);
    let up = 0, gone = 0;
    try {
      await cloud.eachLimit(adds, 8, async (rel) => {
        const p = this.abs(DST, rel);
        if (stat(p)) {
          await store.put(spec.key(rel), p);
          up++;
        }
        this.remoteAdd.delete(rel);
      });
      await cloud.eachLimit(dels, 8, async (rel) => {
        await store.del(spec.key(rel));
        this.remoteDel.delete(rel);
        gone++;
      });
    } catch (e) {
      throw new Error(`upload to ${this.cfg.cloud} failed: ${firstLine(errMsg(e))}`);
    } finally {
      if (up + gone > 0) this.emit({ kind: "info", msg: `uploaded ${up} file(s) and removed ${gone} on ${this.cfg.cloud}` });
    }
    this.remoteFull = false;
  }

  private writeTar(file: string, rels: string[]): void {
    const tw = new TarWriter(file);
    try {
      for (const rel of rels) {
        const p = this.abs(DST, rel);
        const fi = lstat(p);
        if (!fi) continue; // gone again since it was queued
        const base = { name: rel, mode: Number(fi.mode) & 0o7777, mtimeSec: Number(fi.mtimeMs) / 1000 };
        if (fi.isSymbolicLink()) {
          let link: string;
          try {
            link = fs.readlinkSync(p);
          } catch {
            continue;
          }
          tw.add({ ...base, mode: 0o777, size: 0, link });
        } else if (fi.isFile()) {
          tw.add({ ...base, size: Number(fi.size), file: p });
        }
      }
    } finally {
      tw.close();
    }
  }

  // ---------- diff ----------

  /**
   * A diff for rel plus a title. Conflicts compare target→source; otherwise
   * the target file vs git HEAD; without git, target vs source.
   */
  async diff(rel: string, conflict: boolean): Promise<{ title: string; lines: Line[] }> {
    const read = (p: string) => {
      try {
        return fs.readFileSync(p);
      } catch {
        return Buffer.alloc(0);
      }
    };
    const tpath = this.abs(DST, rel), spath = this.abs(SRC, rel);
    if (conflict || !(await gitx.isRepo(this.gitTarget))) {
      return { title: "target ↔ source: " + rel, lines: diff(read(tpath), read(spath), 3) };
    }
    const head = await gitx.showHead(this.gitTarget, rel);
    const title = head ? "HEAD ↔ working copy: " + rel : "new file (not in HEAD): " + rel;
    return { title, lines: diff(head ?? Buffer.alloc(0), read(tpath), 3) };
  }

  // ---------- history ----------

  private appendJournal(entries: JournalEntry[]): void {
    const now = new Date();
    const b: Batch = {
      id: fmtStamp(now, 6, Math.floor((performance.now() * 1000) % 1000)), time: now.toISOString(),
      pair: this.cfg.name, pair_id: this.id, source: this.cfg.source, target: this.cfg.target, entries,
    };
    if (this.cfg.remote || this.cfg.cloud) b.remote = this.cfg.remote || this.cfg.cloud;
    this.journalN++;
    appendBatch(journalPath(this.dataDir, this.id), b, this.journalN % 50 === 1);
  }

  /** This pair's batches, newest first. */
  history(): Batch[] {
    return history(this.dataDir, this.id);
  }

  /** Undoes the newest batch that hasn't been undone yet. */
  undoLast(): { batch: Batch; problems: string[] } {
    for (const b of this.history()) {
      if (b.undone) continue;
      const { problems } = undo(this.dataDir, b, this.cfg.backups);
      void this.do(() => this.emit({ kind: "info", msg: "undid the sync batch from " + fmtClock(new Date(b.time)) }));
      return { batch: b, problems };
    }
    throw new Error("nothing to undo");
  }

  /** Undoes every batch recorded after t (ms), newest first. */
  restoreTo(t: number): { batches: Batch[]; done: string[]; problems: string[] } {
    const r = restoreTo(this.dataDir, this.id, t, this.cfg.backups);
    if (r.batches.length > 0) {
      void this.do(() =>
        this.emit({ kind: "info", msg: `restored to ${fmtClock(new Date(t))}: undid ${r.batches.length} sync batch(es)` }),
      );
    }
    return r;
  }

  /** Totals from this pair's history since `since` (ms; 0 = everything). */
  stats(since: number): Stats {
    return stats(this.cfg.name, this.history(), since);
  }

  /**
   * Stops syncing rel by adding it to the source's .syncignore. The rule is
   * anchored ("/path") so only that file or folder is matched. Returns the
   * line that was added, or "" if it was already there.
   */
  ignorePath(rel: string): string {
    const clean = rel.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
    if (clean === "" || clean.split("/").includes("..")) throw new Error("not a path inside the pair: " + rel);
    const line = "/" + clean.replace(/([*?[\]!#\\ ])/g, "\\$1");
    const file = path.join(this.cfg.source, ".syncignore");
    let text = "";
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {}
    if (text.split(/\r?\n/).includes(line)) return "";
    const sep = text === "" || text.endsWith("\n") ? "" : "\n";
    fs.writeFileSync(file, text + sep + line + "\n");
    void this.do(() => {
      this.untrack(clean);
      this.emit({ kind: "info", path: clean, msg: "ignored from now on (added to .syncignore)" });
      this.publish();
    });
    return line;
  }

  // ---------- state ----------

  private statePath(): string {
    return path.join(this.dataDir, this.id, "state.json");
  }

  loadState(): void {
    const sf = readStateFile(this.statePath());
    if (!sf) return;
    this.state = new Map(Object.entries(sf.files));
    for (const c of sf.conflicts) this.conflicts.add(c);
  }

  saveState(): void {
    if (this.cfg.dryRun) return;
    this.hashes.save(this.hashPath());
    if (!this.twoWay) return;
    const p = this.statePath();
    try {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      const files: Record<string, Base> = {};
      for (const [k, v] of this.state) files[k] = v;
      const tmp = p + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify({ version: 3, pair: this.cfg, files, conflicts: sortedKeys(this.conflicts) }));
      replaceFile(tmp, p);
    } catch {}
  }

  /** Applies queued resolve requests (queue tasks only). */
  private async processRequests(): Promise<void> {
    const dir = requestDir(this.dataDir, this.id);
    let files: string[];
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort(cmp);
    } catch {
      return;
    }
    if (files.length === 0) return;
    for (const f of files) {
      const p = path.join(dir, f);
      let r: { path?: string; choice?: Choice };
      try {
        r = JSON.parse(fs.readFileSync(p, "utf8"));
      } catch {
        fs.rmSync(p, { force: true });
        continue;
      }
      fs.rmSync(p, { force: true });
      if (!r.path || !r.choice) continue;
      if (!this.conflicts.has(r.path)) {
        this.warn("resolve request for " + r.path + " ignored: not a conflict");
        continue;
      }
      await this.resolveNow(r.path, r.choice, "resolved from the command line: ");
    }
    this.saveState();
    this.publish();
  }

  private async resolveNow(rel: string, c: Choice, prefix: string): Promise<void> {
    const ops = this.resolveOps(rel, c);
    this.conflicts.delete(rel);
    await this.apply(ops);
    this.emit({ kind: "resolved", path: rel, msg: prefix + c });
  }

  /** Resolves a conflict when the run loop is not running (after a --once pass). */
  async resolveSync(rel: string, c: Choice): Promise<void> {
    if (!this.conflicts.has(rel)) return;
    await this.resolveNow(rel, c, "resolved: ");
    this.saveState();
    this.publish();
  }

  /** Conflicts waiting for a decision. */
  heldConflicts(): string[] {
    return sortedKeys(this.conflicts);
  }

  /** For ResolveOffline: apply queued requests without syncing anything else. */
  async applyQueuedRequests(): Promise<void> {
    this.loadState();
    await this.processRequests();
  }

  /** Copies loop-owned fields into the published status. */
  private publish(): void {
    const st = this.status;
    st.userPaused = this.userPaused;
    st.guardReason = this.branchErr !== "" ? this.branchErr : this.guardReason;
    st.conflicts = sortedKeys(this.conflicts);
    st.watcher = this.watcherKind;
    st.isGit = this.isGit;
    st.pending = this.needsApply;
    st.pendingBatch = this.pendingBatch;
    this.maybeWriteStatus();
  }

  // ---------- status file ----------

  private writeStatus(running: boolean): void {
    if (this.cfg.dryRun) return;
    const st = this.getStatus();
    const ps: PairStatus = {
      id: this.id, name: st.name, source: st.source, target: st.target, mode: st.mode,
      pid: process.pid, running, state: running ? stateOf(st) : "stopped", paused: isPaused(st),
      conflicts: st.conflicts, is_git: st.isGit, uncommitted: st.gitStatus.length, staged: gitx.stagedCount(st.gitStatus),
      last_sync: isoTime(st.lastSync), added: st.added, updated: st.updated, deleted: st.deleted,
      renamed: st.renamed, skipped: st.skipped, failed: st.failed, updated_at: new Date().toISOString(),
    };
    if (this.cfg.remote || this.cfg.cloud) ps.remote = this.cfg.remote || this.cfg.cloud;
    if (st.guardReason) ps.guard_reason = st.guardReason;
    if (st.pendingBatch) ps.pending_batch = st.pendingBatch;
    if (st.watcher) ps.watcher = st.watcher;
    if (st.branch) ps.branch = st.branch;
    const p = statusPath(this.dataDir, this.id);
    try {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      const tmp = p + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(ps, null, 2));
      replaceFile(tmp, p);
    } catch {}
  }

  /** Publishes the status at most once a second while running. */
  private maybeWriteStatus(): void {
    if (!this.running || Date.now() - this.lastStatus < 1000) return;
    this.lastStatus = Date.now();
    this.writeStatus(true);
  }
}

// ---------- helpers ----------

function countWrites(ops: Op[]): number {
  return ops.filter((o) => ["copy", "delete", "rename", "dup", "merge"].includes(o.kind)).length;
}

/**
 * Pipes data through a shell command run in the source folder. {path} in the
 * command is replaced by the file's pair-relative path, quoted for the shell.
 */
export function runTransform(cmd: string, rel: string, cwd: string, data: Buffer): { ok: true; data: Buffer } | { ok: false; error: string } {
  const quoted = isWindows ? `"${rel.replaceAll('"', "")}"` : remote.quote(rel);
  const line = cmd.replaceAll("{path}", quoted);
  const argv = isWindows ? ["cmd", "/C", line] : ["sh", "-c", line];
  try {
    const r = Bun.spawnSync(argv, { cwd, stdin: data, stdout: "pipe", stderr: "pipe", timeout: TRANSFORM_TIMEOUT });
    if (r.exitCode !== 0) {
      const why = r.signalCode ? "timed out or was killed" : `exit ${r.exitCode}`;
      return { ok: false, error: `${why}: ${firstLine(r.stderr.toString().trim() || r.stdout.toString().trim())}` };
    }
    return { ok: true, data: Buffer.from(r.stdout) };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

function permString(perm: number): string {
  const r = "rwxrwxrwx";
  let s = "-";
  for (let i = 0; i < 9; i++) s += perm & (1 << (8 - i)) ? r[i] : "-";
  return s;
}

/** Compares two text files with CRLF and LF treated alike. */
function sameIgnoringEOL(a: string, b: string, ia: fs.BigIntStats, ib: fs.BigIntStats): boolean {
  if (ia.size > EOL_MAX || ib.size > EOL_MAX) return false;
  try {
    const da = fs.readFileSync(a), db = fs.readFileSync(b);
    if (isBinary(da) || isBinary(db)) return false;
    return convertEOL(da, "lf").equals(convertEOL(db, "lf"));
  } catch {
    return false;
  }
}

export function conflictName(rel: string, who: string): string {
  const ext = goExt(rel);
  const stem = rel.slice(0, rel.length - ext.length);
  return `${stem}.conflict-${who}-${fmtStamp(new Date())}${ext}`;
}

/** Fills a commit message template. */
export function expandMessage(tmpl: string, p: Pair, lines: string[]): string {
  const now = new Date();
  const files = lines.filter((l) => l.length > 3).map((l) => l.slice(3).replace(/^"+|"+$/g, ""));
  const shown = files.length > 5 ? [...files.slice(0, 5), `+${files.length - 5} more`] : files;
  const target = p.remote || p.cloud || path.basename(p.target);
  const vars: Record<string, string> = {
    "{count}": String(files.length), "{files}": shown.join(", "), "{summary}": summarizeStatus(lines),
    "{source}": path.basename(p.source), "{target}": target, "{pair}": p.name,
    "{date}": fmtDate(now), "{time}": fmtHM(now), "{datetime}": fmtDateHM(now),
  };
  return tmpl.replace(/\{(count|files|summary|source|target|pair|date|time|datetime)\}/g, (m) => vars[m]!);
}

/** Turns git status lines into a short message such as "update 3 files in src/api; add README.md". */
export function summarizeStatus(lines: string[]): string {
  const byVerb = new Map<string, string[]>();
  for (const l of lines) {
    if (l.length < 4) continue;
    const code = l.slice(0, 2);
    let file = l.slice(3);
    let verb = "update";
    if (code === "??" || code.includes("A")) verb = "add";
    else if (code.includes("D")) verb = "delete";
    else if (code.includes("R")) {
      verb = "rename";
      const i = file.indexOf(" -> ");
      if (i >= 0) file = file.slice(i + 4);
    }
    byVerb.set(verb, [...(byVerb.get(verb) ?? []), file.replace(/^"+|"+$/g, "")]);
  }
  const parts: string[] = [];
  for (const v of ["add", "update", "delete", "rename"]) {
    const files = byVerb.get(v) ?? [];
    if (files.length === 1) parts.push(v + " " + files[0]);
    else if (files.length > 1) parts.push(`${v} ${files.length} files${commonDir(files)}`);
  }
  return parts.length === 0 ? "no changes" : parts.join("; ");
}

function commonDir(files: string[]): string {
  let dir = path.posix.dirname(files[0]!);
  for (const f of files.slice(1)) {
    while (dir !== "." && dir !== "/" && !f.startsWith(dir + "/")) dir = path.posix.dirname(dir);
  }
  return dir === "." || dir === "/" ? "" : " in " + dir;
}

// ---------- state shared between processes ----------

interface StateFile {
  pair: Pair | null;
  files: Record<string, Base>;
  conflicts: string[];
}

function readStateFile(file: string): StateFile | null {
  let data: unknown;
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (d.files && typeof d.files === "object") {
    return { pair: pairFromState(d.pair), files: d.files as Record<string, Base>, conflicts: (d.conflicts as string[]) ?? [] };
  }
  // the v1.0 format: just the file map
  return { pair: null, files: d as Record<string, Base>, conflicts: [] };
}

function pairFromState(raw: unknown): Pair | null {
  return pairFromJSON(raw);
}

/** Every two-way pair that has state in dataDir. */
export function savedPairs(dataDir: string): SavedPair[] {
  const out: SavedPair[] = [];
  for (const id of dirs(dataDir)) {
    const sf = readStateFile(path.join(dataDir, id, "state.json"));
    if (!sf?.pair || !sf.pair.source) continue;
    out.push({ id, pair: sf.pair, conflicts: sf.conflicts, pid: runningPID(dataDir, id) });
  }
  return out.sort((a, b) => cmp(a.pair.name, b.pair.name));
}

function dirs(dataDir: string): string[] {
  try {
    return fs.readdirSync(dataDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort(cmp);
  } catch {
    return [];
  }
}

function pidPath(dataDir: string, id: string): string {
  return path.join(dataDir, id, "engine.pid");
}

/** The process currently syncing the pair, or 0. */
export function runningPID(dataDir: string, id: string): number {
  try {
    const pid = parseInt(fs.readFileSync(pidPath(dataDir, id), "utf8").trim(), 10);
    return processAlive(pid) ? pid : 0;
  } catch {
    return 0;
  }
}

function requestDir(dataDir: string, id: string): string {
  return path.join(dataDir, id, "resolve");
}

/** Asks whichever process owns the pair (now or at its next start) to resolve a held conflict. */
export function queueResolve(dataDir: string, id: string, rel: string, c: Choice): void {
  const dir = requestDir(dataDir, id);
  fs.mkdirSync(dir, { recursive: true });
  const name = path.join(dir, crypto.createHash("sha256").update(rel).digest("hex").slice(0, 16) + ".json");
  const tmp = name + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify({ path: rel, choice: c }));
  replaceFile(tmp, name);
}

/** Resolve requests not applied yet. */
export function pendingRequests(dataDir: string, id: string): number {
  try {
    return fs.readdirSync(requestDir(dataDir, id)).filter((f) => f.endsWith(".json")).length;
  } catch {
    return 0;
  }
}

/**
 * Applies queued resolve requests for a pair no process is running, using the
 * pair's saved config. It never scans or syncs anything else.
 */
export async function resolveOffline(dataDir: string, id: string, emit: (ev: Event) => void): Promise<void> {
  const sf = readStateFile(path.join(dataDir, id, "state.json"));
  if (!sf) throw new Error("no saved state for this pair");
  if (!sf.pair?.source) throw new Error("no saved config for this pair; run ferry on it once first");
  const e = new Engine(sf.pair, emit);
  e.dataDir = dataDir;
  e.id = id;
  await e.applyQueuedRequests();
}

/** What a running ferry process publishes about each pair (status.json). */
export interface PairStatus {
  id: string;
  name: string;
  source: string;
  target: string;
  remote?: string;
  mode: string;
  pid: number;
  running: boolean;
  state: string;
  paused: boolean;
  guard_reason?: string;
  conflicts: string[];
  pending_batch?: number;
  watcher?: string;
  is_git: boolean;
  branch?: string;
  uncommitted: number;
  staged: number;
  last_sync: string;
  added: number;
  updated: number;
  deleted: number;
  renamed: number;
  skipped: number;
  failed: number;
  updated_at: string;
}

function statusPath(dataDir: string, id: string): string {
  return path.join(dataDir, id, "status.json");
}

/** The last published status of every pair that has run. */
export function readStatuses(dataDir: string): PairStatus[] {
  const out: PairStatus[] = [];
  for (const id of dirs(dataDir)) {
    try {
      const ps = JSON.parse(fs.readFileSync(statusPath(dataDir, id), "utf8")) as PairStatus;
      ps.conflicts ??= [];
      if (ps.running && !processAlive(ps.pid)) {
        ps.running = false;
        ps.state = "stopped (process exited)";
      }
      out.push(ps);
    } catch {}
  }
  return out.sort((a, b) => cmp(a.name, b.name));
}

/** A Status as JSON with the Go version's field names (GET /status). */
export function statusJSON(s: Status): Record<string, unknown> {
  const o: Record<string, unknown> = {
    name: s.name, source: s.source, target: s.target,
  };
  if (s.remote) o.remote = s.remote;
  Object.assign(o, { mode: s.mode, watcher: s.watcher, user_paused: s.userPaused });
  if (s.guardReason) o.guard_reason = s.guardReason;
  Object.assign(o, {
    conflicts: s.conflicts, pending_batch: s.pendingBatch, pending: s.pending, last_sync: isoTime(s.lastSync),
    added: s.added, updated: s.updated, deleted: s.deleted, renamed: s.renamed, skipped: s.skipped, failed: s.failed,
    is_git: s.isGit,
  });
  if (s.branch) o.branch = s.branch;
  o.git_status = s.gitStatus;
  o.changed = s.changed.map((c) => {
    const x: Record<string, unknown> = { path: c.path, kind: c.kind };
    if (c.dir) x.direction = c.dir;
    x.time = new Date(c.time).toISOString();
    return x;
  });
  return o;
}
