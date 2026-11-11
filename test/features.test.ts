// Tests for: restore to a point in time, stats, ignore from the dashboard,
// transforms, secrets: redact, several targets, cloud targets, {ai} commit
// messages (fallback only), and the web app's API.
import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

import { ApiServer, type PairManager } from "../src/api.ts";
import * as cloud from "../src/cloud.ts";
import {
  appendPairToFile,
  dataDir,
  defaults,
  expandTargets,
  loadFile,
  normalize,
  pairsFromObject,
  removePairFromFile,
} from "../src/config.ts";
import { Engine, runTransform } from "../src/engine/engine.ts";
import { history, restoreTo, stats } from "../src/engine/journal.ts";
import { redactSecrets } from "../src/engine/secrets.ts";
import { parseWhen } from "../src/util.ts";
import { read, Rec, runOnce, setup, tempDir, write } from "./helpers.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("parseWhen", () => {
  const now = new Date(2026, 10, 7, 15, 0, 0);
  test("relative and clock times", () => {
    expect(parseWhen("2h ago", now)).toBe(now.getTime() - 2 * 3_600_000);
    expect(parseWhen("90m", now)).toBe(now.getTime() - 90 * 60_000);
    expect(parseWhen("1h 30m ago", now)).toBe(now.getTime() - 90 * 60_000);
    expect(parseWhen("14:30", now)).toBe(new Date(2026, 10, 7, 14, 30).getTime());
    // a clock time still ahead today means yesterday
    expect(parseWhen("16:00", now)).toBe(new Date(2026, 10, 6, 16, 0).getTime());
    expect(parseWhen("2026-11-01 09:15", now)).toBe(new Date(2026, 10, 1, 9, 15).getTime());
    expect(parseWhen("today", now)).toBe(new Date(2026, 10, 7).getTime());
  });
  test("rejects nonsense", () => {
    expect(() => parseWhen("whenever", now)).toThrow();
    expect(() => parseWhen("", now)).toThrow();
    expect(() => parseWhen("25:00", now)).toThrow();
  });
});

describe("restore and stats", () => {
  test("restoreTo undoes every batch after a moment, and stats count them", async () => {
    const { e, s, d } = setup((p) => (p.delete = true));
    write(s, "a.txt", "one");
    await runOnce(e);
    await sleep(20);
    const mid = Date.now();
    await sleep(20);
    write(s, "a.txt", "two");
    write(s, "b.txt", "new");
    await e.cycle(false, true);
    write(s, "a.txt", "three");
    await e.cycle(false, true);
    expect(read(d, "a.txt")).toBe("three");

    const st = stats("p", history(dataDir(), e.id), 0);
    expect(st.batches).toBe(3);
    expect(st.added).toBe(2);
    expect(st.updated).toBe(2);
    expect(st.topFiles[0]).toEqual({ path: "a.txt", changes: 3 });
    expect(stats("p", history(dataDir(), e.id), mid).batches).toBe(2);

    const r = restoreTo(dataDir(), e.id, mid, 5);
    expect(r.batches.length).toBe(2);
    expect(r.problems).toEqual([]);
    expect(read(d, "a.txt")).toBe("one");
    expect(read(d, "b.txt")).toBe("<missing>");
    // already undone batches are not undone twice
    expect(restoreTo(dataDir(), e.id, mid, 5).batches.length).toBe(0);
    expect(stats("p", history(dataDir(), e.id), 0).undone).toBe(2);
  });
});

describe("ignore", () => {
  test("ignorePath appends an anchored, escaped rule once and stops syncing the file", async () => {
    const { e, s, d } = setup();
    write(s, "keep.txt", "k");
    write(s, "dir/odd [1].txt", "x");
    await runOnce(e);
    expect(read(d, "dir/odd [1].txt")).toBe("x");
    expect(e.ignorePath("dir/odd [1].txt")).toBe("/dir/odd\\ \\[1\\].txt");
    expect(e.ignorePath("dir/odd [1].txt")).toBe("");
    expect(() => e.ignorePath("../etc/passwd")).toThrow();
    write(s, "dir/odd [1].txt", "changed");
    write(s, "keep.txt", "k2");
    await e.cycle(false, true);
    expect(read(d, "dir/odd [1].txt")).toBe("x");
    expect(read(d, "keep.txt")).toBe("k2");
  });
});

describe("transform", () => {
  test("runTransform pipes data and reports failures", () => {
    const ok = runTransform("tr a-z A-Z", "x.txt", tempDir(), Buffer.from("hello"));
    expect(ok.ok && ok.data.toString()).toBe("HELLO");
    const bad = runTransform("echo nope >&2; exit 3", "x.txt", tempDir(), Buffer.from(""));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toContain("nope");
  });

  test("matching files are transformed on the way to the target; others are copied", async () => {
    const { e, r, s, d } = setup((p) => (p.transform = { "*.md": "tr a-z A-Z", "*.bad": "exit 1" }));
    write(s, "a.md", "shout");
    write(s, "b.txt", "quiet");
    write(s, "c.bad", "as is");
    await runOnce(e);
    expect(read(d, "a.md")).toBe("SHOUT");
    expect(read(d, "b.txt")).toBe("quiet");
    expect(read(d, "c.bad")).toBe("as is");
    expect(r.evs.some((ev) => ev.kind === "warn" && ev.msg?.includes("transform failed"))).toBe(true);

    // a fresh engine (no previous scan) must see the target as up to date
    const r2 = new Rec();
    const e2 = new Engine(e.cfg, r2.add);
    await runOnce(e2);
    expect(r2.has("update", "a.md")).toBe(false);
  });

  test("transform and redact are refused in two-way mode", () => {
    const p = defaults();
    p.source = tempDir();
    p.target = tempDir();
    p.mode = "two-way";
    p.transform = { "*": "cat" };
    expect(() => normalize(structuredClone(p))).toThrow(/one-way/);
    p.transform = null;
    p.secrets = "redact";
    expect(() => normalize(p)).toThrow(/one-way/);
  });
});

describe("secrets: redact", () => {
  test("redactSecrets replaces values but keeps structure", () => {
    const env = redactSecrets(".env", Buffer.from("# comment\nAPI_KEY=abc123\nEMPTY=\nexport TOKEN='x'\n"));
    expect(env.data.toString()).toBe("# comment\nAPI_KEY=<REDACTED:value>\nEMPTY=\nexport TOKEN=<REDACTED:value>\n");
    expect(env.count).toBe(2);

    const code = redactSecrets(
      "config.ts",
      Buffer.from(`const k = "AKIAABCDEFGHIJKLMNOP";\nconst password = "hunter2hunter2";\n`),
    );
    const out = code.data.toString();
    expect(out).toContain("<REDACTED:aws-key>");
    expect(out).toContain(`password = "<REDACTED:secret>"`);
    expect(out).not.toContain("AKIAABCDEFGHIJKLMNOP");
    expect(out).not.toContain("hunter2hunter2");

    const key = "-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----\n";
    expect(redactSecrets("id_rsa", Buffer.from(key)).data.toString()).toBe("<REDACTED:private-key>\n");
    // a credential file whose content isn't recognised is held back
    expect(redactSecrets("credentials.json", Buffer.from(`{"x": 1}`)).block).toBe(true);
    expect(redactSecrets("notes.txt", Buffer.from("nothing here")).count).toBe(0);
  });

  test("the engine copies redacted content and skips what can't be redacted", async () => {
    const { e, r, s, d } = setup((p) => (p.secrets = "redact"));
    write(s, ".env", "DB_PASSWORD=topsecret\n");
    write(s, "credentials.json", "{}");
    write(s, "plain.txt", "fine");
    await runOnce(e);
    expect(read(d, ".env")).toBe("DB_PASSWORD=<REDACTED:value>\n");
    expect(read(d, "credentials.json")).toBe("<missing>");
    expect(read(d, "plain.txt")).toBe("fine");
    expect(r.has("skip", "credentials.json")).toBe(true);
  });
});

describe("several targets", () => {
  test("expandTargets makes one one-way pair per target", () => {
    const p = defaults();
    p.name = "docs";
    p.source = "/src";
    p.target = "/a/site";
    p.targets = ["/b/site", "s3://bucket/docs"];
    const ps = expandTargets(p);
    expect(ps.map((q) => q.name)).toEqual(["docs/site", "docs/site-2", "docs/bucket/docs"]);
    expect(ps.map((q) => q.target)).toEqual(["/a/site", "/b/site", "s3://bucket/docs"]);
    expect(ps.every((q) => q.targets.length === 0)).toBe(true);
    p.mode = "two-way";
    expect(() => expandTargets(p)).toThrow(/one-way/);
  });

  test("targets: in a config file", () => {
    const dir = tempDir();
    for (const f of ["src", "t1", "t2"]) fs.mkdirSync(path.join(dir, f));
    const cfg = path.join(dir, "ferry.yaml");
    fs.writeFileSync(cfg, "pairs:\n  - name: fan\n    source: src\n    targets: [t1, t2]\n");
    const { pairs } = loadFile(cfg);
    expect(pairs.map((p) => p.name)).toEqual(["fan/t1", "fan/t2"]);
    expect(pairs[1]!.target).toBe(path.join(dir, "t2"));
  });
});

describe("cloud targets", () => {
  test("parse and validate", () => {
    expect(cloud.isSpec("s3://bucket/a/b")).toBe(true);
    expect(cloud.isSpec("/local")).toBe(false);
    const sp = cloud.parse("s3://my-bucket//site/");
    expect(sp.toString()).toBe("s3://my-bucket/site");
    expect(sp.key("a/b.txt")).toBe("site/a/b.txt");
    expect(cloud.parse("s3://b2").key("x")).toBe("x");
    expect(() => cloud.parse("s3://bucket/../x")).toThrow();
  });

  test("changes are uploaded and deletions removed; failures are retried", async () => {
    const objects = new Map<string, string>();
    let failNext = false;
    cloud.setOpener(() => ({
      async put(key, file) {
        if (failNext) {
          failNext = false;
          throw new Error("network down");
        }
        objects.set(key, fs.readFileSync(file, "utf8"));
      },
      async del(key) {
        objects.delete(key);
      },
      async check() {},
    }));
    const { e, s } = setup((p) => {
      p.target = "s3://bucket/site";
      p.delete = true;
    });
    expect(e.cfg.cloud).toBe("s3://bucket/site");
    expect(e.cfg.target).toContain(path.join("cloud", ""));
    write(s, "index.html", "<h1>hi</h1>");
    write(s, "css/a.css", "body{}");
    await runOnce(e);
    expect(objects.get("site/index.html")).toBe("<h1>hi</h1>");
    expect(objects.get("site/css/a.css")).toBe("body{}");

    fs.rmSync(path.join(s, "css/a.css"));
    failNext = true;
    write(s, "index.html", "<h1>v2</h1>");
    await e.cycle(false, true);
    expect(objects.get("site/index.html")).toBe("<h1>hi</h1>"); // the upload failed
    await e.cycle(false, true); // retried on the next pass
    expect(objects.get("site/index.html")).toBe("<h1>v2</h1>");
    expect(objects.has("site/css/a.css")).toBe(false);
  });
});

describe("{ai} commit messages", () => {
  test("fall back to the summary when Claude can't be reached", async () => {
    const saved = { ...process.env };
    process.env.ANTHROPIC_API_KEY = "test-key";
    process.env.ANTHROPIC_BASE_URL = "http://127.0.0.1:9"; // nothing listens here
    try {
      const { e, r, s, d } = setup();
      const git = (...a: string[]) => Bun.spawnSync(["git", "-C", d, ...a]);
      git("init", "-q");
      git("config", "user.email", "t@example.com");
      git("config", "user.name", "T");
      write(s, "a.txt", "x");
      await runOnce(e);
      await (e as any).doCommit("{ai}", false, false, false);
      const log = Bun.spawnSync(["git", "-C", d, "log", "-1", "--format=%s"]).stdout.toString().trim();
      expect(log).toBe("add a.txt");
      expect(r.evs.some((ev) => ev.kind === "warn" && ev.msg?.includes("AI commit message unavailable"))).toBe(true);
    } finally {
      process.env = saved;
    }
  }, 30_000);
});

describe("web app API", () => {
  test("pages, stats, ignore, restore preview and pair management", async () => {
    const { e, s } = setup();
    write(s, "a.txt", "1");
    await runOnce(e);
    const engines = [e];
    const added: Record<string, unknown>[] = [];
    const manager: PairManager = {
      configFile: "",
      async add(obj) {
        added.push(obj);
        return ["new"];
      },
      async remove() {
        return { savedRemoval: false };
      },
    };
    const api = new ApiServer(engines, "", { version: "9.9", manager });
    const call = (p: string, init?: RequestInit) => api.handle(new Request("http://127.0.0.1:7878" + p, init));
    const post = (p: string, body?: unknown) =>
      call(p, {
        method: "POST",
        headers: { "X-Ferry": "1" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });

    const page = await call("/");
    expect(page.headers.get("Content-Type")).toContain("text/html");
    expect(page.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(await page.text()).toContain("<title>Ferry</title>");
    expect(await (await call("/info")).json()).toMatchObject({ version: "9.9", can_add: true });

    const name = encodeURIComponent(e.name);
    expect(await (await call(`/pairs/${name}/stats?since=all`)).json()).toMatchObject({ batches: 1, added: 1 });
    expect((await call(`/pairs/${name}/stats?since=bogus`)).status).toBe(400);
    expect(await (await post(`/pairs/${name}/ignore`, { path: "a.txt" })).json()).toMatchObject({ rule: "/a.txt" });
    expect(await (await post(`/pairs/${name}/restore`, { at: "1h ago", dry_run: true })).json()).toMatchObject({
      batches: 1,
      files: ["a.txt"],
    });
    expect((await post(`/pairs/${name}/restore`, { at: "in a bit" })).status).toBe(400);

    expect((await post("/pairs", { source: "/x", target: "/y" })).status).toBe(200);
    expect(added).toHaveLength(1);
    expect((await post("/pairs", "nope")).status).toBe(400);
    expect(await (await post(`/pairs/${name}/remove`)).json()).toMatchObject({ removed: e.name });

    // the folder picker lists sub-folders only
    const dir = tempDir();
    fs.mkdirSync(path.join(dir, "child"));
    fs.mkdirSync(path.join(dir, ".hidden"));
    fs.writeFileSync(path.join(dir, "file.txt"), "");
    expect(((await (await call("/fs?path=" + encodeURIComponent(dir))).json()) as { dirs: string[] }).dirs).toEqual([
      "child",
    ]);

    // without a manager, adding is refused
    const plain = new ApiServer(engines, "");
    expect(
      (
        await plain.handle(
          new Request("http://127.0.0.1/pairs", { method: "POST", headers: { "X-Ferry": "1" }, body: "{}" }),
        )
      ).status,
    ).toBe(405);
  });

  test("pairsFromObject validates like a config file; config files are edited in place", () => {
    const dir = tempDir();
    fs.mkdirSync(path.join(dir, "a"));
    const ps = pairsFromObject({
      name: "w",
      source: path.join(dir, "a"),
      target: path.join(dir, "b"),
      mode: "two-way",
      merge: true,
    });
    expect(ps[0]!).toMatchObject({ name: "w", mode: "two-way", merge: true });
    expect(() =>
      pairsFromObject({ source: path.join(dir, "a"), target: path.join(dir, "b"), mode: "sideways" }),
    ).toThrow(/mode/);
    expect(() => pairsFromObject({ source: path.join(dir, "missing"), target: path.join(dir, "b") })).toThrow(
      /not a folder/,
    );

    const cfg = path.join(dir, "ferry.yaml");
    fs.writeFileSync(cfg, "# keep me\nnotify: false\npairs:\n  - name: old\n    source: a\n    target: b\n");
    appendPairToFile(cfg, { name: "w", source: path.join(dir, "a"), target: path.join(dir, "c") });
    const text = fs.readFileSync(cfg, "utf8");
    expect(text).toContain("# keep me");
    expect(loadFile(cfg).pairs.map((p) => p.name)).toEqual(["old", "w"]);
    expect(removePairFromFile(cfg, "old")).toBe(true);
    expect(removePairFromFile(cfg, "nope")).toBe(false);
    expect(loadFile(cfg).pairs.map((p) => p.name)).toEqual(["w"]);
  });
});

describe("web app config repairs", () => {
  test("removePairFromFile also finds unnamed pairs by source and target", () => {
    const dir = tempDir();
    for (const d of ["src", "src/sub", "dst"]) fs.mkdirSync(path.join(dir, d), { recursive: true });
    const cfg = path.join(dir, "ui.yaml");
    fs.writeFileSync(
      cfg,
      `pairs:\n  - source: ${path.join(dir, "src")}\n    target: ./dst\n  - source: ./src/sub\n    target: ${path.join(dir, "dst")}\n`,
    );
    const { pairs, dropped } = loadFile(cfg, { lenient: true });
    // the later entry wins the clash over the shared target
    expect(pairs.map((p) => p.source)).toEqual([path.join(dir, "src/sub")]);
    expect(dropped).toHaveLength(1);
    expect(dropped[0]!.reason).toContain("same target");
    expect(() => loadFile(cfg)).toThrow(/same target/);
    expect(removePairFromFile(cfg, dropped[0]!.pair.name, dropped[0]!.pair)).toBe(true);
    const after = loadFile(cfg);
    expect(after.pairs.map((p) => p.source)).toEqual([path.join(dir, "src/sub")]);
    expect(after.dropped).toEqual([]);
  });
});

describe("comparing animation", () => {
  test("prepareCompare reports progress for slow comparisons and clears it afterwards", async () => {
    const { e, s, d } = setup();
    // enough equal-sized pairs that hashing takes longer than the 200 ms threshold
    const big = Buffer.alloc(256 * 1024, 7);
    for (let i = 0; i < 160; i++) {
      write(s, `f${i}.bin`, big);
      write(d, `f${i}.bin`, big);
    }
    write(s, "only-in-source.txt", "x");
    const seen: [number, number][] = [];
    const statuses: unknown[] = [];
    await e.prepareCompare((done, total) => {
      seen.push([done, total]);
      statuses.push(e.getStatus().comparing);
    });
    if (seen.length > 0) {
      expect(seen.every(([, total]) => total === 160)).toBe(true);
      expect(seen[seen.length - 1]![0]).toBe(160);
      expect(statuses[0]).toMatchObject({ total: 160 });
    }
    expect(e.getStatus().comparing).toBeNull();
  }, 30_000);

  test("every frame of Relay's terminal art has the same width", async () => {
    const { comparingArt } = await import("../src/relayart.ts");
    const widths = new Set<number>();
    for (let f = 0; f < 16; f++) {
      const lines = comparingArt(f, f, 16);
      expect(lines).toHaveLength(3);
      widths.add([...lines[1]!].length);
      expect(lines[0]).toBe("  ╭─────╮");
    }
    expect(widths.size).toBe(1);
  });

  test("the web app serves the comparing animation", async () => {
    const api = new ApiServer([], "");
    const r = await api.handle(new Request("http://127.0.0.1/relay-comparing.svg"));
    expect(r.headers.get("Content-Type")).toBe("image/svg+xml");
    expect(await r.text()).toContain("Relay comparing two files");
  });
});

describe("web app redesign", () => {
  test("serves Relay's expressions and a structured diff", async () => {
    const { e, s, d } = setup();
    write(s, "a.txt", "one\ntwo\n");
    await runOnce(e);
    write(s, "a.txt", "one\nTWO\nthree\n");
    write(d, "a.txt", "one\ntwo, edited in the target\n"); // the two sides really differ
    const api = new ApiServer([e], "");
    const get = (p: string) => api.handle(new Request("http://127.0.0.1" + p));
    for (const m of ["happy", "sleepy", "worried", "comparing"]) {
      const r = await get(`/mascot/${m}.svg`);
      expect(r.status).toBe(200);
      expect(r.headers.get("Content-Type")).toBe("image/svg+xml");
    }
    expect((await get("/mascot/../../etc/passwd.svg")).status).toBe(404);
    const j = (await (
      await get(`/pairs/${encodeURIComponent(e.name)}/diff?format=json&path=a.txt&conflict=1`)
    ).json()) as {
      kind: string;
      before: string;
      after: string;
      lines: { op: string }[];
    };
    expect(j.kind).toBe("sides");
    expect(j.before).toBe("In the target");
    expect(j.lines.length).toBeGreaterThan(0);
  });
});

describe("targets inside a bigger repository", () => {
  test("status paths are relative to the target, so diffs find the file", async () => {
    const { relativeLine, status } = await import("../src/gitx.ts");
    expect(relativeLine(" M products/app/a.txt", "products/app/")).toBe(" M a.txt");
    expect(relativeLine('?? "products/app/my file.txt"', "products/app/")).toBe('?? "my file.txt"');
    expect(relativeLine("R  products/app/a.txt -> products/app/b.txt", "products/app/")).toBe("R  a.txt -> b.txt");
    expect(relativeLine(" M other/x.txt", "")).toBe(" M other/x.txt");

    const repo = tempDir();
    const git = (...a: string[]) => Bun.spawnSync(["git", "-C", repo, ...a]);
    git("init", "-q");
    git("config", "user.email", "t@example.com");
    git("config", "user.name", "T");
    const { e, s } = setup((p) => (p.target = path.join(repo, "products", "app")));
    write(s, "a.txt", "one\ntwo\n");
    await runOnce(e);
    git("add", "-A");
    git("commit", "-qm", "first");
    write(s, "a.txt", "one\nTWO\n");
    await e.cycle(false, true);
    expect(await status(e.cfg.target)).toEqual([" M a.txt"]);
    const d = await e.diff("a.txt", false);
    expect(d.lines.some((l) => l.op === "+" && l.text === "TWO")).toBe(true);
    const missing = await e.diff("products/app/a.txt", false);
    expect(missing.lines[0]!.text).toContain("isn't in the target");
  });
});

describe("notifications", () => {
  test("the server keeps recent notable events, skipping per-file noise, up to a limit", async () => {
    const api = new ApiServer([], "");
    const ev = (kind: string, i: number) => ({
      time: Date.now() + i,
      pair: "p",
      kind: kind as never,
      path: "f" + i,
      msg: "m" + i,
    });
    api.broadcast(ev("add", 0)); // a single copied file: summed up by "synced", not kept
    api.broadcast(ev("conflict", 1));
    api.broadcast(ev("synced", 2));
    let recent = (await (await api.handle(new Request("http://127.0.0.1/events/recent"))).json()) as { kind: string }[];
    expect(recent.map((e) => e.kind)).toEqual(["conflict", "synced"]);
    for (let i = 0; i < 400; i++) api.broadcast(ev("commit", 10 + i));
    recent = (await (await api.handle(new Request("http://127.0.0.1/events/recent"))).json()) as { kind: string }[];
    expect(recent.length).toBe(300);
    expect(recent[0]!.kind).toBe("commit");
  });
});
