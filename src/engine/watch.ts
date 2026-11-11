// Wakes the engine when something may have changed: native file events with a
// slow safety rescan, or plain polling.
import fs from "node:fs";
import path from "node:path";

import { cmp } from "../util.ts";
import { toSlash } from "./fsops.ts";

export type SkipFn = (root: string, rel: string, isDir: boolean) => boolean;

export class Watcher {
  kind: "native" | "poll" = "poll";
  private watchers: fs.FSWatcher[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private closed = false;

  /**
   * In "auto" mode it falls back to polling if native events fail, e.g. on
   * network drives or when the OS watch limit is hit.
   */
  constructor(
    mode: string,
    roots: string[],
    intervalMs: number,
    skip: SkipFn,
    private poke: () => void,
    warn: (msg: string) => void,
  ) {
    if (mode !== "poll") {
      try {
        for (const r of roots) this.watchers.push(this.watchRoot(r, skip, warn));
        this.kind = "native";
        this.timer = setInterval(poke, mode === "native" ? 60_000 : 10_000);
        return;
      } catch (e) {
        for (const w of this.watchers) w.close();
        this.watchers = [];
        const why = (e as Error).message;
        warn(
          mode === "native"
            ? `native file events unavailable (${why}); falling back to polling`
            : `using polling: native file events unavailable (${why})`,
        );
      }
    }
    this.kind = "poll";
    this.timer = setInterval(poke, intervalMs);
  }

  private watchRoot(root: string, skip: SkipFn, warn: (msg: string) => void): fs.FSWatcher {
    const w = fs.watch(root, { recursive: true, persistent: false }, (_ev, filename) => {
      if (this.closed) return;
      if (!filename) return this.poke();
      const rel = toSlash(String(filename));
      if (rel === "" || rel === ".") return this.poke();
      const base = rel.slice(rel.lastIndexOf("/") + 1);
      if (base.startsWith(".ferry-")) return; // our own temp files
      if (skip(root, rel, false)) return;
      this.poke();
    });
    w.on("error", (e) => {
      if (this.closed) return;
      warn("watcher: " + (e as Error).message);
      this.poke(); // overflow etc: rescan
    });
    return w;
  }

  close(): void {
    this.closed = true;
    for (const w of this.watchers) w.close();
    if (this.timer) clearInterval(this.timer);
  }
}

/**
 * Checks whether native file events work for root (used by "ferry doctor").
 * Returns the number of folders that would be watched.
 */
export function probeWatcher(root: string): number {
  let dirs = 1;
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const d of entries.sort((a, b) => cmp(a.name, b.name))) {
      if (!d.isDirectory() || d.name === ".git" || d.name === "node_modules") continue;
      dirs++;
      walk(path.join(dir, d.name));
    }
  };
  walk(root);
  const w = fs.watch(root, { recursive: true, persistent: false });
  w.close();
  return dirs;
}
