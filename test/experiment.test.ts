// Throwaway experiments: try something in the working folder, then keep it or drop it.
import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

import { Engine } from "../src/engine/engine.ts";
import {
  dropExperiment,
  experimentChanges,
  keepExperiment,
  loadExperiment,
  MAX_EXPERIMENT_BYTES,
  startExperiment,
} from "../src/engine/experiment.ts";
import type { Snapshot } from "../src/engine/fsops.ts";
import { read, rm, runOnce, setup, tempDir, write } from "./helpers.ts";

/** The files under root, as the engine would see them (no ignores). */
function snap(root: string): Snapshot {
  const out: Snapshot = new Map();
  const walk = (dir: string, rel: string) => {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? rel + "/" + d.name : d.name;
      if (d.isDirectory()) walk(path.join(dir, d.name), r);
      else {
        const st = fs.statSync(path.join(dir, d.name), { bigint: true });
        out.set(r, { size: Number(st.size), mod: Number(st.mtimeNs), mode: 0 });
      }
    }
  };
  walk(root, "");
  return out;
}

describe("experiments", () => {
  test("the copy, what changed, and dropping puts everything back", () => {
    const root = tempDir(),
      data = tempDir();
    const dir = path.join(data, "exp"),
      aside = path.join(data, "aside");
    write(root, "a.txt", "one");
    write(root, "sub/b.txt", "two");
    const exp = startExperiment(dir, root, snap(root), "  new header  ");
    expect(exp.name).toBe("new header");
    expect(Object.keys(exp.files).sort()).toEqual(["a.txt", "sub/b.txt"]);
    expect(loadExperiment(dir)?.since).toBe(exp.since);
    expect(() => startExperiment(dir, root, snap(root), "again")).toThrow("already under way");

    // touched but the same content isn't a change
    const later = new Date(Date.now() + 60_000);
    fs.utimesSync(path.join(root, "a.txt"), later, later);
    expect(experimentChanges(dir, exp, root, snap(root))).toEqual({ added: [], changed: [], deleted: [] });

    write(root, "a.txt", "ONE, edited");
    rm(root, "sub/b.txt");
    write(root, "new/c.txt", "three");
    expect(experimentChanges(dir, exp, root, snap(root))).toEqual({
      added: ["new/c.txt"],
      changed: ["a.txt"],
      deleted: ["sub/b.txt"],
    });

    const d = dropExperiment(dir, exp, root, snap(root), aside);
    expect(d.problems).toEqual([]);
    expect(read(root, "a.txt")).toBe("one");
    expect(read(root, "sub/b.txt")).toBe("two");
    expect(fs.existsSync(path.join(root, "new"))).toBe(false); // the new file and its empty folder
    expect(read(aside, "new/c.txt")).toBe("three"); // moved aside, not lost
    expect(loadExperiment(dir)).toBeNull();
  });

  test("keeping throws the copy away; too big a folder isn't copied", () => {
    const root = tempDir(),
      dir = path.join(tempDir(), "exp");
    write(root, "a.txt", "one");
    startExperiment(dir, root, snap(root), "");
    keepExperiment(dir);
    expect(fs.existsSync(dir)).toBe(false);

    const huge: Snapshot = new Map([["big.bin", { size: MAX_EXPERIMENT_BYTES + 1, mod: 0, mode: 0 }]]);
    expect(() => startExperiment(dir, root, huge, "")).toThrow("stop at 2 GB");
    expect(fs.existsSync(dir)).toBe(false);
  });

  test("in a pair: syncing waits, survives a restart, and dropping leaves the target untouched", async () => {
    const { e, s, d } = setup();
    write(s, "a.txt", "one");
    write(s, "b.txt", "two");
    await runOnce(e);
    expect(read(d, "a.txt")).toBe("one");

    expect(await e.startExperiment("try it")).toEqual({ files: 2 });
    expect(e.getStatus().experiment).toMatchObject({ name: "try it", files: 2 });
    expect(await e.startExperiment("again")).toEqual({ error: "an experiment is already under way" });

    write(s, "a.txt", "changed");
    rm(s, "b.txt");
    write(s, "c.txt", "new");
    write(s, "node_modules/x/i.js", "ignored by the pair");

    // a new engine for the same pair (a restart) still holds syncing
    const again = new Engine(e.cfg, () => {});
    await runOnce(again);
    expect(read(d, "a.txt")).toBe("one");
    expect(read(d, "b.txt")).toBe("two");
    expect(read(d, "c.txt")).toBe("<missing>");
    expect(again.experimentChanges()).toMatchObject({ added: ["c.txt"], changed: ["a.txt"], deleted: ["b.txt"] });

    const r = await again.dropExperiment();
    expect(r).toMatchObject({ restored: 2, moved: 1 });
    expect(read(s, "a.txt")).toBe("one");
    expect(read(s, "b.txt")).toBe("two");
    expect(read(s, "c.txt")).toBe("<missing>");
    expect(read(r.aside!, "c.txt")).toBe("new");
    expect(read(s, "node_modules/x/i.js")).toBe("ignored by the pair"); // left alone
    expect(again.getStatus().experiment).toBeNull();
    expect(again.experimentChanges()).toBeNull();
    expect(read(d, "c.txt")).toBe("<missing>");
    expect(await again.dropExperiment()).toEqual({ error: "no experiment is under way" });
  });

  test("in a pair: keeping it syncs what the experiment did", async () => {
    const { e, s, d } = setup();
    write(s, "a.txt", "one");
    await runOnce(e);
    await e.startExperiment("");
    write(s, "a.txt", "kept");
    write(s, "b.txt", "new");
    await runOnce(e);
    expect(read(d, "a.txt")).toBe("one");
    expect(await e.keepExperiment()).toEqual({});
    await runOnce(e);
    expect(read(d, "a.txt")).toBe("kept");
    expect(read(d, "b.txt")).toBe("new");
  });
});
