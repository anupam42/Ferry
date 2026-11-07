// Scanning, hashing and atomic file operations.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { Matcher } from "../ignore.ts";
import { isWindows } from "../proc.ts";
import { cmp, fmtStamp, parseStamp } from "../util.ts";

/** Marks a symlink in FileStat.mode (alongside the permission bits). */
export const MODE_SYMLINK = 1 << 20;

/** The cheap identity of a file used for change detection. */
export interface FileStat {
  size: number;
  mod: number; // mtime in unix nanoseconds (as a double)
  mode: number; // permission bits, plus MODE_SYMLINK
}

/** Slash-separated relative paths → stats. */
export type Snapshot = Map<string, FileStat>;

export function sameStat(a: FileStat | undefined, b: FileStat | undefined): boolean {
  return !!a && !!b && a.size === b.size && a.mod === b.mod && a.mode === b.mode;
}

export function snapshotsEqual(a: Snapshot | null, b: Snapshot | null): boolean {
  if (!a || !b) return a === b;
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (!sameStat(v, b.get(k))) return false;
  return true;
}

/** These can never be turned off: syncing them would corrupt a repo or loop. */
export const HARD_IGNORES = [".git", ".ferry-*", ".ferry"];

/** The built-in list (turn off with default_ignores: false). */
export const DEFAULT_IGNORES = [
  "node_modules", ".DS_Store", "Thumbs.db", "desktop.ini", ".syncignore",
  "*.swp", "*.swo", "*~", ".#*", "*.tmp", "~$*",
];

export function statOf(st: fs.BigIntStats, link = false): FileStat {
  return { size: Number(st.size), mod: Number(st.mtimeNs), mode: (Number(st.mode) & 0o777) | (link ? MODE_SYMLINK : 0) };
}

export function stat(p: string): fs.BigIntStats | null {
  try {
    return fs.statSync(p, { bigint: true });
  } catch {
    return null;
  }
}

export function lstat(p: string): fs.BigIntStats | null {
  try {
    return fs.lstatSync(p, { bigint: true });
  } catch {
    return null;
  }
}

export const mtimeNs = (st: fs.BigIntStats) => Number(st.mtimeNs);

/**
 * Walks root, applying base plus any nested .gitignore files. When only is
 * set, files must also match it. symlinks is skip | follow | link.
 */
export function scanDir(root: string, base: Matcher, nestedGitignore: boolean, only: Matcher | null, symlinks: string): Snapshot {
  const m = base.clone();
  const snap: Snapshot = new Map();
  const rootStat = fs.statSync(root); // throws if the root is missing
  if (!rootStat.isDirectory()) throw new Error(`${root} is not a folder`);
  const walk = (dir: string, relDir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // vanished or unreadable: skip
    }
    entries.sort((a, b) => cmp(a.name, b.name));
    for (const d of entries) {
      const rel = relDir === "" ? d.name : relDir + "/" + d.name;
      const p = path.join(dir, d.name);
      const isDir = d.isDirectory();
      if (m.matchDirect(rel, isDir)) continue;
      if (isDir) {
        if (nestedGitignore) m.addFile(path.join(p, ".gitignore"), rel);
        walk(p, rel);
        continue;
      }
      if (only && only.length > 0 && !only.match(rel, false)) continue;
      if (d.isFile()) {
        const st = stat(p);
        if (st) snap.set(rel, statOf(st));
      } else if (d.isSymbolicLink() && symlinks === "follow") {
        const st = stat(p); // what the link points to
        if (st && st.isFile()) snap.set(rel, statOf(st)); // links to folders are not followed (they could loop)
      } else if (d.isSymbolicLink() && symlinks === "link") {
        const st = lstat(p);
        if (st) snap.set(rel, statOf(st, true));
      }
      // sockets, devices, and symlinks unless enabled are skipped
    }
  };
  walk(root, "");
  return snap;
}

const CHUNK = 1 << 20;

export function hashFile(p: string): string {
  const h = crypto.createHash("sha256");
  const fd = fs.openSync(p, "r");
  try {
    const buf = Buffer.allocUnsafe(CHUNK);
    for (;;) {
      const n = fs.readSync(fd, buf, 0, CHUNK, null);
      if (n <= 0) break;
      h.update(buf.subarray(0, n));
    }
  } finally {
    fs.closeSync(fd);
  }
  return h.digest("hex");
}

/** Checks for a NUL byte in the first 8KB. */
export function isBinaryFile(p: string): boolean {
  let fd: number;
  try {
    fd = fs.openSync(p, "r");
  } catch {
    return false;
  }
  try {
    const buf = Buffer.alloc(8000);
    const n = fs.readSync(fd, buf, 0, 8000, 0);
    return buf.subarray(0, n).includes(0);
  } catch {
    return false;
  } finally {
    fs.closeSync(fd);
  }
}

export function isSymlink(p: string): boolean {
  return lstat(p)?.isSymbolicLink() ?? false;
}

/** Recreates the symlink src at dst, pointing at the same target. */
export function copyLink(src: string, dst: string): void {
  const target = fs.readlinkSync(src);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  removeWithRetry(dst);
  fs.symlinkSync(target, dst);
}

function tempName(dir: string): string {
  return path.join(dir, ".ferry-" + crypto.randomBytes(6).toString("hex"));
}

function setTimes(p: string, modNs: number): void {
  try {
    fs.utimesSync(p, new Date(), modNs / 1e9);
  } catch {}
}

/** Copies atomically (temp file + rename), keeps mode and mtime, and returns the content hash. */
export function copyFile(src: string, dst: string): string {
  const info = fs.statSync(src, { bigint: true });
  const dir = path.dirname(dst);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = tempName(dir);
  const h = crypto.createHash("sha256");
  const inFd = fs.openSync(src, "r");
  try {
    const outFd = fs.openSync(tmp, "wx");
    try {
      const buf = Buffer.allocUnsafe(CHUNK);
      for (;;) {
        const n = fs.readSync(inFd, buf, 0, CHUNK, null);
        if (n <= 0) break;
        const chunk = buf.subarray(0, n);
        h.update(chunk);
        let off = 0;
        while (off < n) off += fs.writeSync(outFd, chunk, off, n - off);
      }
    } finally {
      fs.closeSync(outFd);
    }
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  } finally {
    fs.closeSync(inFd);
  }
  try {
    fs.chmodSync(tmp, Number(info.mode) & 0o777);
  } catch {}
  setTimes(tmp, Number(info.mtimeNs));
  try {
    replaceFile(tmp, dst);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
  return h.digest("hex");
}

/** Writes data to dst through a temp file. modNs 0 leaves the mtime as "now"; perm 0 keeps the default. */
export function writeFileAtomic(dst: string, data: Uint8Array, perm: number, modNs: number): void {
  const dir = path.dirname(dst);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = tempName(dir);
  try {
    fs.writeFileSync(tmp, data, { flag: "wx" });
    if (perm) {
      try {
        fs.chmodSync(tmp, perm);
      } catch {}
    }
    if (modNs) setTimes(tmp, modNs);
    replaceFile(tmp, dst);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}

/** Renames with retries; Windows briefly locks files that editors, antivirus or the indexer have open. */
export function replaceFile(from: string, to: string): void {
  let err: unknown;
  for (let i = 0; i < 5; i++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (e) {
      err = e;
    }
    if (isWindows) {
      try {
        fs.rmSync(to, { force: true });
      } catch {}
    }
    Bun.sleepSync(50 * (i + 1));
  }
  throw err;
}

export function removeWithRetry(p: string): void {
  let err: unknown;
  for (let i = 0; i < 5; i++) {
    try {
      fs.unlinkSync(p);
      return;
    } catch (e: any) {
      if (e?.code === "ENOENT") return;
      err = e;
    }
    Bun.sleepSync(50 * (i + 1));
  }
  throw err;
}

/** Deletes now-empty directories up to (not including) root. */
export function removeEmptyParents(root: string, p: string): void {
  let dir = path.dirname(p);
  for (;;) {
    const rel = path.relative(root, dir);
    if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return;
    try {
      fs.rmdirSync(dir);
    } catch {
      return;
    }
    dir = path.dirname(dir);
  }
}

export function toSlash(p: string): string {
  return p.replaceAll("\\", "/");
}

export function fromSlash(rel: string): string {
  return isWindows ? rel.replaceAll("/", "\\") : rel;
}

// ---------- backups ----------

/** The backup root for a pair. */
export function backupDir(dataDir: string, pairID: string): string {
  return path.join(dataDir, pairID, "backups");
}

/**
 * Stores a copy of side/rel before it's overwritten or deleted, prunes old
 * versions, and returns the path of the new copy ("" if none).
 */
export function backupFile(dir: string, side: string, rel: string, p: string, keep: number): string {
  if (keep <= 0 || !stat(p)) return "";
  try {
    const vdir = path.join(dir, side, fromSlash(rel));
    fs.mkdirSync(vdir, { recursive: true });
    const dest = path.join(vdir, fmtStamp(new Date(), 3));
    copyFile(p, dest);
    const names = fs
      .readdirSync(vdir, { withFileTypes: true })
      .filter((v) => !v.isDirectory() && !v.name.startsWith(".ferry-"))
      .map((v) => v.name)
      .sort(cmp);
    while (names.length > keep) fs.rmSync(path.join(vdir, names.shift()!), { force: true });
    return dest;
  } catch {
    return "";
  }
}

/** One stored version. */
export interface Backup {
  side: string; // "source" or "target"
  rel: string;
  version: string; // timestamp name
  path: string;
  time: number; // ms (NaN if the name isn't a timestamp)
  size: number;
}

/** Stored versions (newest first per file), optionally only those of one file. */
export function listBackups(dataDir: string, pairID: string, filter: string): Backup[] {
  const root = backupDir(dataDir, pairID);
  const want = toSlash(filter).replace(/^\/+|\/+$/g, "");
  const out: Backup[] = [];
  const walk = (dir: string, parts: string[]) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const d of entries) {
      const p = path.join(dir, d.name);
      if (d.isDirectory()) {
        walk(p, [...parts, d.name]);
        continue;
      }
      const all = [...parts, d.name];
      if (all.length < 3) continue;
      const b: Backup = {
        side: all[0]!, rel: all.slice(1, -1).join("/"), version: all[all.length - 1]!, path: p, time: 0, size: 0,
      };
      if (filter !== "" && b.rel !== want) continue;
      b.time = parseStamp(b.version);
      b.size = stat(p) ? Number(stat(p)!.size) : 0;
      out.push(b);
    }
  };
  walk(root, []);
  out.sort((a, b) => (a.rel !== b.rel ? cmp(a.rel, b.rel) : cmp(b.version, a.version)));
  return out;
}

/** Copies a stored version back over dest (backing up dest first). */
export function restoreBackup(dataDir: string, pairID: string, b: Backup, dest: string, keep: number): void {
  backupFile(backupDir(dataDir, pairID), b.side, b.rel, dest, keep + 1);
  copyFile(b.path, dest);
}

/**
 * Deletes versions older than maxAgeMs, then the oldest versions until the
 * pair's backups fit in maxSize. Zero disables either limit.
 */
export function pruneBackups(dataDir: string, pairID: string, maxAgeMs: number, maxSize: number): { removed: number; freed: number } {
  let removed = 0, freed = 0;
  if (maxAgeMs <= 0 && maxSize <= 0) return { removed, freed };
  const list = listBackups(dataDir, pairID, "");
  list.sort((a, b) => (a.time || 0) - (b.time || 0)); // oldest first
  let total = list.reduce((n, b) => n + b.size, 0);
  const drop = (b: Backup) => {
    try {
      fs.unlinkSync(b.path);
    } catch {
      return;
    }
    removed++;
    freed += b.size;
    total -= b.size;
    removeEmptyParents(backupDir(dataDir, pairID), b.path);
  };
  const keep: Backup[] = [];
  for (const b of list) {
    if (maxAgeMs > 0 && b.time > 0 && Date.now() - b.time > maxAgeMs) drop(b);
    else keep.push(b);
  }
  for (const b of keep) {
    if (maxSize <= 0 || total <= maxSize) break;
    drop(b);
  }
  return { removed, freed };
}
