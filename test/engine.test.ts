import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

import { dataDir, type Pair } from "../src/config.ts";
import {
  Engine,
  expandMessage,
  pendingRequests,
  queueResolve,
  readStatuses,
  resolveOffline,
  savedPairs,
  summarizeStatus,
} from "../src/engine/engine.ts";
import { listBackups } from "../src/engine/fsops.ts";
import { history, undo } from "../src/engine/journal.ts";
import { scanSecretContent, secretNameHit } from "../src/engine/secrets.ts";
import { parseChoice } from "../src/engine/types.ts";
import { read, Rec, rm, runOnce, setup, write } from "./helpers.ts";

const apply = (e: Engine, ops: unknown) => (e as any).apply(ops) as Promise<Set<string>>;

const twoWay = (conflict: string, del: boolean) => (p: Pair) => {
  p.mode = "two-way";
  p.conflict = conflict;
  p.delete = del;
};

describe("one-way", () => {
  test("basics: copy, ignore, update, delete, backup", async () => {
    const { e, r, s, d } = setup((p) => {
      p.delete = true;
      p.ignore = ["*.log"];
    });
    write(s, "a.txt", "hello");
    write(s, "sub/b.txt", "b");
    write(s, "node_modules/x.js", "x");
    write(s, "debug.log", "l");
    write(s, ".gitignore", "secret.env\n");
    write(s, "secret.env", "k=v");
    await runOnce(e);
    expect(read(d, "a.txt")).toBe("hello");
    expect(read(d, "sub/b.txt")).toBe("b");
    for (const f of ["node_modules/x.js", "debug.log", "secret.env"]) expect(read(d, f)).toBe("<missing>");

    write(s, "a.txt", "hello world");
    rm(s, "sub/b.txt");
    await e.cycle(false, true);
    expect(read(d, "a.txt")).toBe("hello world");
    expect(read(d, "sub/b.txt")).toBe("<missing>");
    expect(fs.existsSync(path.join(d, "sub"))).toBe(false);
    expect(r.has("delete", "sub/b.txt")).toBe(true);
    const bs = listBackups(dataDir(), e.id, "a.txt");
    expect(bs.length).toBe(1);
    expect(bs[0]!.side).toBe("target");
  });

  test("rename is synced as a rename", async () => {
    const { e, r, s, d } = setup((p) => (p.delete = true));
    write(s, "old/name.txt", "same content here");
    await runOnce(e);
    fs.mkdirSync(path.join(s, "new"));
    fs.renameSync(path.join(s, "old/name.txt"), path.join(s, "new/name2.txt"));
    await e.cycle(false, true);
    expect(r.has("rename", "old/name.txt")).toBe(true);
    expect(read(d, "new/name2.txt")).toBe("same content here");
    expect(read(d, "old/name.txt")).toBe("<missing>");
  });

  test("size and binary limits", async () => {
    const { e, r, s, d } = setup((p) => {
      p.maxSize = 10;
      p.binary = "skip";
    });
    write(s, "big.txt", "this is more than ten bytes");
    write(s, "bin.dat", "a\x00b");
    write(s, "ok.txt", "ok");
    await runOnce(e);
    expect(read(d, "big.txt")).toBe("<missing>");
    expect(read(d, "bin.dat")).toBe("<missing>");
    expect(read(d, "ok.txt")).toBe("ok");
    expect(r.has("skip", "big.txt") && r.has("skip", "bin.dat")).toBe(true);
  });

  test("dry run writes nothing but reports", async () => {
    const { e, r, s, d } = setup((p) => (p.dryRun = true));
    write(s, "a.txt", "x");
    await runOnce(e);
    expect(read(d, "a.txt")).toBe("<missing>");
    expect(r.has("add", "a.txt")).toBe(true);
  });

  test("mirror removes extra target files but never .git", async () => {
    const { e, s, d } = setup();
    write(s, "keep.txt", "k");
    write(d, "keep.txt", "k");
    write(d, "extra.txt", "e");
    write(d, ".git/HEAD", "ref");
    const list = e.planMirror();
    expect(list).toEqual(["extra.txt"]);
    e.approveMirror(list);
    await runOnce(e);
    expect(read(d, "extra.txt")).toBe("<missing>");
    expect(read(d, ".git/HEAD")).toBe("ref");
  });

  test("only filter", async () => {
    const { e, s, d } = setup((p) => (p.only = ["src/**", "*.md"]));
    write(s, "src/a.go", "a");
    write(s, "README.md", "r");
    write(s, "other/b.txt", "b");
    await runOnce(e);
    expect(read(d, "src/a.go")).toBe("a");
    expect(read(d, "README.md")).toBe("r");
    expect(read(d, "other/b.txt")).toBe("<missing>");
  });

  test("undo the last batch", async () => {
    const { e, s, d } = setup();
    write(s, "a.txt", "v1");
    await runOnce(e);
    write(s, "a.txt", "v2 longer");
    write(s, "new.txt", "n");
    await e.cycle(false, true);
    expect(read(d, "a.txt")).toBe("v2 longer");
    expect(read(d, "new.txt")).toBe("n");
    let hist = history(dataDir(), e.id);
    expect(hist.length).toBe(2);
    const { done, problems } = undo(dataDir(), hist[0]!, 5);
    expect(problems).toEqual([]);
    expect(done.length).toBe(2);
    expect(read(d, "a.txt")).toBe("v1");
    expect(read(d, "new.txt")).toBe("<missing>");
    expect(read(s, "a.txt")).toBe("v2 longer");
    hist = history(dataDir(), e.id);
    expect(hist[0]!.undone).toBe(true);
    expect(() => undo(dataDir(), hist[0]!, 5)).toThrow();
  });

  test("plan does not write", async () => {
    const { e, s, d } = setup();
    write(s, "a.txt", "x");
    write(d, "b.txt", "old");
    write(s, "b.txt", "new!");
    const kinds = Object.fromEntries(e.plan().map((c) => [c.path, c.kind]));
    expect(kinds["a.txt"]).toBe("add");
    expect(kinds["b.txt"]).toBe("update");
    expect(read(d, "a.txt")).toBe("<missing>");
    expect(read(d, "b.txt")).toBe("old");
  });

  test("eol conversion counts as unchanged after a restart", async () => {
    const { e, s, d } = setup((p) => (p.eol = "lf"));
    write(s, "a.txt", "one\r\ntwo\r\n");
    await runOnce(e);
    expect(read(d, "a.txt")).toBe("one\ntwo\n");
    const r = new Rec();
    await runOnce(new Engine(e.cfg, r.add));
    expect(r.has("update", "a.txt")).toBe(false);
  });

  test("secrets: block, with an allow list", async () => {
    const { e, r, s, d } = setup((p) => {
      p.secrets = "block";
      p.secretAllow = ["fixtures/**"];
    });
    write(s, "config.js", `const key = "AKIAABCDEFGHIJKLMNOP"`);
    write(s, "fixtures/fake.js", `const key = "AKIAABCDEFGHIJKLMNOP"`);
    write(s, ".env", "X=1");
    write(s, "ok.txt", "fine");
    await runOnce(e);
    expect(read(d, "config.js")).toBe("<missing>");
    expect(read(d, ".env")).toBe("<missing>");
    expect(read(d, "fixtures/fake.js")).not.toBe("<missing>");
    expect(read(d, "ok.txt")).toBe("fine");
    expect(r.has("skip", "config.js")).toBe(true);
  });

  test("status file is written", async () => {
    const { e, s } = setup();
    write(s, "a.txt", "x");
    await runOnce(e);
    const list = readStatuses(dataDir());
    expect(list.length).toBe(1);
    expect(list[0]!.running).toBe(false);
    expect(list[0]!.added).toBe(1);
    expect(list[0]!.name).toBe(e.name);
  });
});

describe("two-way", () => {
  test("propagation both ways, deletes", async () => {
    const { e, s, d } = setup(twoWay("ask", true));
    write(s, "a.txt", "from source");
    write(d, "b.txt", "from target");
    await runOnce(e);
    expect(read(d, "a.txt")).toBe("from source");
    expect(read(s, "b.txt")).toBe("from target");
    write(d, "a.txt", "edited in target");
    await e.cycle(false, true);
    expect(read(s, "a.txt")).toBe("edited in target");
    rm(s, "b.txt");
    await e.cycle(false, true);
    expect(read(d, "b.txt")).toBe("<missing>");
  });

  test("on_delete: restore", async () => {
    const { e, r, s, d } = setup((p) => {
      p.mode = "two-way";
      p.onDelete = "restore";
    });
    write(s, "a.txt", "x");
    write(s, "r/one.txt", "rename me please");
    await runOnce(e);
    rm(d, "a.txt");
    fs.renameSync(path.join(s, "r/one.txt"), path.join(s, "r/two.txt"));
    await e.cycle(false, true);
    expect(read(d, "a.txt")).toBe("x");
    expect(r.has("rename", "r/one.txt")).toBe(true);
    expect(read(d, "r/two.txt")).not.toBe("<missing>");
    expect(read(d, "r/one.txt")).toBe("<missing>");
  });

  test("conflict: ask, then resolve", async () => {
    const { e, r, s, d } = setup(twoWay("ask", true));
    write(s, "c.txt", "base");
    await runOnce(e);
    write(s, "c.txt", "source edit");
    write(d, "c.txt", "target edit!");
    await e.cycle(false, true);
    expect(r.has("conflict", "c.txt")).toBe(true);
    expect(e.conflicts.has("c.txt")).toBe(true);
    expect(read(s, "c.txt")).toBe("source edit");
    expect(read(d, "c.txt")).toBe("target edit!");
    const { title, lines } = await e.diff("c.txt", true);
    expect(title).toContain("c.txt");
    expect(lines.length).toBeGreaterThan(0);
    const ops = e.resolveOps("c.txt", "source");
    e.conflicts.delete("c.txt");
    await apply(e, ops);
    expect(read(d, "c.txt")).toBe("source edit");
    await e.cycle(false, true);
    expect(e.conflicts.has("c.txt")).toBe(false);
  });

  test("conflict: keep-both", async () => {
    const { e, s, d } = setup(twoWay("keep-both", true));
    write(s, "doc.md", "base");
    await runOnce(e);
    write(s, "doc.md", "source version");
    write(d, "doc.md", "target version");
    await e.cycle(false, true);
    await e.cycle(false, true); // the conflict copy propagates
    expect(read(s, "doc.md")).toBe("target version");
    expect(read(d, "doc.md")).toBe("target version");
    const copies = fs.readdirSync(d).filter((f) => /^doc\.conflict-source-.*\.md$/.test(f));
    expect(copies.length).toBe(1);
    expect(read(d, copies[0]!)).toBe("source version");
  });

  test("conflict: newer wins", async () => {
    const { e, s, d } = setup(twoWay("newer", true));
    write(s, "n.txt", "base");
    await runOnce(e);
    write(s, "n.txt", "older");
    write(d, "n.txt", "newer!");
    const old = new Date(Date.now() - 3_600_000);
    fs.utimesSync(path.join(s, "n.txt"), old, old);
    await e.cycle(false, true);
    expect(read(s, "n.txt")).toBe("newer!");
  });

  test("state persists between runs", async () => {
    const { e, s, d } = setup(twoWay("ask", true));
    write(s, "p.txt", "v1");
    await runOnce(e);
    const e2 = new Engine(e.cfg, null);
    write(d, "p.txt", "v2 from target");
    await runOnce(e2);
    expect(e2.conflicts.size).toBe(0);
    expect(read(s, "p.txt")).toBe("v2 from target");
  });

  test("on_delete: keep", async () => {
    const { e, r, s, d } = setup(twoWay("ask", false));
    expect(e.cfg.onDelete).toBe("keep");
    write(s, "a.txt", "x");
    write(s, "r/one.txt", "rename me please");
    write(s, "edit.txt", "v1");
    await runOnce(e);

    rm(s, "a.txt");
    fs.renameSync(path.join(s, "r/one.txt"), path.join(s, "r/two.txt"));
    rm(d, "edit.txt");
    await e.cycle(false, true);
    expect(read(s, "a.txt")).toBe("<missing>");
    expect(read(d, "a.txt")).toBe("x");
    expect(r.has("kept", "a.txt")).toBe(true);
    expect(r.has("rename", "r/one.txt")).toBe(true);
    expect(read(d, "r/two.txt")).not.toBe("<missing>");
    expect(read(d, "r/one.txt")).toBe("<missing>");
    // several more cycles: nothing gets resurrected
    await e.cycle(false, true);
    await e.cycle(false, true);
    expect(read(s, "a.txt")).toBe("<missing>");
    expect(read(d, "edit.txt")).toBe("<missing>");
    expect(read(s, "edit.txt")).toBe("v1");
    // survives a restart
    const e2 = new Engine(e.cfg, null);
    await runOnce(e2);
    expect(read(s, "a.txt")).toBe("<missing>");
    // editing the kept copy brings it back
    write(d, "a.txt", "edited again in target");
    await e2.cycle(false, true);
    expect(read(s, "a.txt")).toBe("edited again in target");
    // recreating on the deleted side with the same content just re-links
    write(d, "edit.txt", "v1");
    await e2.cycle(false, true);
    expect(e2.conflicts.size).toBe(0);
    const b = e2.state.get("edit.txt")!;
    expect(b.o ?? 0).toBe(0);
    expect(b.h).not.toBe("");
  });

  test("hold persists and resolves from the CLI", async () => {
    const { e, r, s, d } = setup(twoWay("hold", true));
    write(s, "c.txt", "base");
    await runOnce(e);
    write(s, "c.txt", "source edit");
    write(d, "c.txt", "target edit!");
    await e.cycle(false, true);
    expect(r.has("conflict", "c.txt")).toBe(true);
    expect(e.conflicts.has("c.txt")).toBe(true);
    e.saveState();

    const saved = savedPairs(dataDir());
    expect(saved.length).toBe(1);
    expect(saved[0]!.conflicts.length).toBe(1);
    expect(saved[0]!.pair.source).toBe(s);
    expect(saved[0]!.pid).toBe(0);
    queueResolve(dataDir(), saved[0]!.id, "c.txt", "target");
    expect(pendingRequests(dataDir(), saved[0]!.id)).toBe(1);
    const r2 = new Rec();
    await resolveOffline(dataDir(), saved[0]!.id, r2.add);
    expect(r2.has("resolved", "c.txt")).toBe(true);
    expect(read(s, "c.txt")).toBe("target edit!");
    expect(pendingRequests(dataDir(), saved[0]!.id)).toBe(0);
    expect(savedPairs(dataDir())[0]!.conflicts.length).toBe(0);
    const e3 = new Engine(e.cfg, null);
    await runOnce(e3);
    expect(e3.conflicts.size).toBe(0);
  });

  test("a held conflict is reloaded and resolved on start", async () => {
    const { e, s, d } = setup(twoWay("hold", true));
    write(s, "c.txt", "base");
    await runOnce(e);
    write(s, "c.txt", "S");
    write(d, "c.txt", "TT");
    await e.cycle(false, true);
    e.saveState();
    const r = new Rec();
    const e2 = new Engine(e.cfg, r.add);
    queueResolve(dataDir(), e2.id, "c.txt", "keep-both");
    await runOnce(e2);
    expect(r.has("conflict", "c.txt")).toBe(true);
    expect(r.has("resolved", "c.txt")).toBe(true);
    expect(read(s, "c.txt")).toBe("TT");
    expect(read(d, "c.txt")).toBe("TT");
  });

  test("eol conversion stays stable", async () => {
    const { e, r, s, d } = setup((p) => {
      p.mode = "two-way";
      p.eol = "lf";
    });
    write(s, "a.txt", "x\r\ny\r\n");
    await runOnce(e);
    await e.cycle(false, true);
    await e.cycle(false, true);
    expect(read(s, "a.txt")).toBe("x\r\ny\r\n");
    expect(read(d, "a.txt")).toBe("x\ny\n");
    expect(e.conflicts.size).toBe(0);
    expect(r.has("conflict")).toBe(false);
  });

  test("three-way merge: clean, then with markers", async () => {
    const { e, s, d } = setup((p) => {
      p.mode = "two-way";
      p.conflict = "hold";
      p.merge = true;
    });
    write(s, "m.txt", "a\nb\nc\nd\ne\n");
    await runOnce(e);
    write(s, "m.txt", "a\nB\nc\nd\ne\n");
    write(d, "m.txt", "a\nb\nc\nD\ne\n");
    await e.cycle(false, true);
    const want = "a\nB\nc\nD\ne\n";
    expect(read(s, "m.txt")).toBe(want);
    expect(read(d, "m.txt")).toBe(want);
    expect(e.conflicts.size).toBe(0);
    write(s, "m.txt", "a\nX\nc\nD\ne\n");
    write(d, "m.txt", "a\nY\nc\nD\ne\n");
    await e.cycle(false, true);
    expect(e.conflicts.has("m.txt")).toBe(true);
    const ops = e.resolveOps("m.txt", "merge");
    e.conflicts.delete("m.txt");
    await apply(e, ops);
    const got = read(d, "m.txt");
    expect(got).toContain("<<<<<<< target");
    expect(got).toContain(">>>>>>> source");
    expect(read(s, "m.txt")).toBe(got);
  });
});

describe("helpers", () => {
  test("expandMessage", () => {
    const p = { name: "x", source: "/a/work", target: "/b/repo", remote: "" } as Pair;
    expect(expandMessage("sync {count} from {source}: {files}", p, [" M a.go", "?? b.go"])).toBe(
      "sync 2 from work: a.go, b.go",
    );
  });

  test("summarizeStatus", () => {
    expect(summarizeStatus([" M src/api/a.go", " M src/api/b.go", "?? README.md", " D old.txt"])).toBe(
      "add README.md; update 2 files in src/api; delete old.txt",
    );
  });

  test("secret detection", () => {
    expect(secretNameHit("config/.env")).not.toBe("");
    expect(secretNameHit(".env.example")).toBe("");
    expect(secretNameHit("keys/server.pem")).not.toBe("");
    const enc = (s: string) => new TextEncoder().encode(s);
    expect(scanSecretContent(enc("-----BEGIN OPENSSH PRIVATE KEY-----\nabc")).length).toBeGreaterThan(0);
    expect(scanSecretContent(enc("token: ghp_" + "a".repeat(36))).length).toBeGreaterThan(0);
    expect(scanSecretContent(enc("const answer = 42 // nothing secret"))).toEqual([]);
  });

  test("parseChoice", () => {
    expect(parseChoice("s")).toBe("source");
    expect(parseChoice("both")).toBe("keep-both");
    expect(parseChoice("M")).toBe("merge");
    expect(parseChoice("newer")).toBe("newer");
    expect(parseChoice("nope")).toBeNull();
  });
});
