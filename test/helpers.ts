import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { defaults, normalize, type Pair } from "../src/config.ts";
import { Engine } from "../src/engine/engine.ts";
import type { Event, Kind } from "../src/engine/types.ts";
import { notifySettings } from "../src/notify.ts";

notifySettings.enabled = false;

export function tempDir(): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ferry-test-")));
}

export class Rec {
  evs: Event[] = [];
  add = (e: Event) => {
    this.evs.push(e);
  };
  has(k: Kind, p = ""): boolean {
    return this.evs.some((e) => e.kind === k && (p === "" || e.path === p));
  }
}

export interface Setup {
  e: Engine;
  r: Rec;
  s: string;
  d: string;
}

/** A fresh source/target pair with its own FERRY_HOME. */
export function setup(mut?: (p: Pair) => void): Setup {
  process.env.FERRY_HOME = tempDir();
  const root = tempDir();
  const s = path.join(root, "src"),
    d = path.join(root, "dst");
  fs.mkdirSync(s, { recursive: true });
  fs.mkdirSync(d, { recursive: true });
  const p = defaults();
  p.source = s;
  p.target = d;
  mut?.(p);
  normalize(p);
  const r = new Rec();
  return { e: new Engine(p, r.add), r, s, d };
}

export function write(root: string, rel: string, content: string | Uint8Array): void {
  const p = path.join(root, ...rel.split("/"));
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  // make sure the mtime moves even on coarse filesystems
  const future = new Date(Date.now() + content.length + 1);
  fs.utimesSync(p, future, future);
}

export function read(root: string, rel: string): string {
  try {
    return fs.readFileSync(path.join(root, ...rel.split("/")), "utf8");
  } catch {
    return "<missing>";
  }
}

export function rm(root: string, rel: string): void {
  fs.rmSync(path.join(root, ...rel.split("/")));
}

export async function runOnce(e: Engine): Promise<void> {
  await e.run(new AbortController().signal, true);
}
