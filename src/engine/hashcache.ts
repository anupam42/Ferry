// Remembers content hashes by path, size and mtime so unchanged files are not
// re-read on every comparison. Saved between runs.
import fs from "node:fs";
import path from "node:path";

import { hashFile, replaceFile } from "./fsops.ts";

interface Entry {
  s: number; // size
  m: number; // mtime (ns)
  h: string; // sha256
  used?: boolean;
}

export class HashCache {
  private m = new Map<string, Entry>();
  private dirty = false;

  get(p: string): string {
    const st = fs.statSync(p, { bigint: true });
    const size = Number(st.size), mod = Number(st.mtimeNs);
    const en = this.m.get(p);
    if (en && en.s === size && en.m === mod) {
      en.used = true;
      return en.h;
    }
    const h = hashFile(p);
    // only cache if the file didn't change while it was being read
    try {
      const st2 = fs.statSync(p, { bigint: true });
      if (Number(st2.size) === size && Number(st2.mtimeNs) === mod) {
        this.m.set(p, { s: size, m: mod, h, used: true });
        this.dirty = true;
      }
    } catch {}
    return h;
  }

  clear(): void {
    this.m.clear();
    this.dirty = true;
  }

  load(file: string): void {
    try {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      if (data && typeof data === "object") {
        this.m = new Map(Object.entries(data as Record<string, Entry>).filter(([, v]) => v && typeof v.h === "string"));
      }
    } catch {}
  }

  /** Writes the entries used this session (so deleted files drop out). */
  save(file: string): void {
    if (!this.dirty) return;
    this.dirty = false;
    const keep: Record<string, Entry> = {};
    for (const [k, v] of this.m) if (v.used) keep[k] = { s: v.s, m: v.m, h: v.h };
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = file + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(keep));
      replaceFile(tmp, file);
    } catch {}
  }
}
