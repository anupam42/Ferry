import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

import {
  dataDir,
  defaults,
  inWindow,
  loadFile,
  normalize,
  parseDays,
  parseWindow,
  pairFromJSON,
} from "../src/config.ts";
import { diff } from "../src/difftext.ts";
import { TarWriter } from "../src/engine/tar.ts";
import * as gitx from "../src/gitx.ts";
import { Matcher } from "../src/ignore.ts";
import { merge3 } from "../src/merge.ts";
import { exec } from "../src/proc.ts";
import { isSpec, parse, quote, quotePath } from "../src/remote.ts";
import { formatDuration, humanSize, parseDuration, parseSize } from "../src/util.ts";
import { tempDir } from "./helpers.ts";

const enc = (s: string) => new TextEncoder().encode(s);

describe("config", () => {
  test("load merges defaults", () => {
    const dir = tempDir();
    fs.mkdirSync(path.join(dir, "a"));
    fs.mkdirSync(path.join(dir, "c"));
    const cfg = path.join(dir, "fs.yaml");
    fs.writeFileSync(
      cfg,
      `
notify: false
defaults:
  delete: true
  ignore: [dist]
  auto_commit: {enabled: true, interval: 2m}
pairs:
  - {name: one, source: a, target: b}
  - name: two
    source: c
    target: d
    mode: two-way
    delete: false
    ignore: ["*.log"]
    max_size: 1.5KB
    auto_commit: {push: true}
`,
    );
    const { pairs, settings } = loadFile(cfg);
    expect(settings.notify).toBe(false);
    const [one, two] = pairs as [(typeof pairs)[0], (typeof pairs)[0]];
    expect(one.delete).toBe(true);
    expect(two.delete).toBe(false);
    expect(one.source).toBe(path.join(dir, "a"));
    expect(two.ignore).toEqual(["dist", "*.log"]);
    expect(two.maxSize).toBe(1536);
    expect(one.maxSize).toBe(50 * 2 ** 20);
    expect(two.autoCommit).toMatchObject({ enabled: true, push: true, interval: 120_000 });
    expect(two.mode).toBe("two-way");
    expect(one.mode).toBe("one-way");
    expect(one.useGitignore).toBe(true);
  });

  test("bad values report their line", () => {
    const dir = tempDir();
    fs.mkdirSync(path.join(dir, "a"));
    const cfg = path.join(dir, "f.yaml");
    fs.writeFileSync(cfg, "pairs:\n  - source: a\n    target: b\n    settle: soon\n");
    expect(() => loadFile(cfg)).toThrow(/line 4: bad duration "soon"/);
    fs.writeFileSync(cfg, "pairs:\n  - source: a\n    target: b\n    merge: maybe\n");
    expect(() => loadFile(cfg)).toThrow(/line 4/);
  });

  test("rejects nested folders", () => {
    const dir = tempDir();
    const p = defaults();
    p.source = dir;
    p.target = path.join(dir, "inner");
    expect(() => normalize(p)).toThrow(/inside the other/);
  });

  test("durations with days and weeks", () => {
    expect(parseDuration("30d")).toBe(720 * 3_600_000);
    expect(parseDuration("2w")).toBe(336 * 3_600_000);
    expect(parseDuration("90m")).toBe(90 * 60_000);
    expect(parseDuration("1h30m")).toBe(90 * 60_000);
    expect(parseDuration("500ms")).toBe(500);
    expect(parseDuration("0")).toBe(0);
    expect(() => parseDuration("10")).toThrow();
    expect(formatDuration(15 * 60_000)).toBe("15m0s");
    expect(formatDuration(500)).toBe("500ms");
    expect(formatDuration(3000)).toBe("3s");
    expect(formatDuration(3_600_000)).toBe("1h0m0s");
  });

  test("sizes", () => {
    expect(parseSize("50MB")).toBe(50 * 2 ** 20);
    expect(parseSize("1.5KB")).toBe(1536);
    expect(parseSize("1024")).toBe(1024);
    expect(() => parseSize("lots")).toThrow();
    expect(humanSize(50 * 2 ** 20)).toBe("50.0MB");
    expect(humanSize(2 ** 30)).toBe("1GB");
    expect(humanSize(10)).toBe("10B");
  });

  test("window and days", () => {
    const p = { ...defaults(), window: "09:00-18:00", days: ["mon-fri"] };
    const at = (day: number, hour: number) => new Date(2026, 9, day, hour, 0, 0);
    // 2026-10-26 is a Monday, 2026-10-31 a Saturday
    expect(inWindow(p, at(26, 10))).toBe(true);
    expect(inWindow(p, at(26, 19))).toBe(false);
    expect(inWindow(p, at(31, 10))).toBe(false);
    const night = { ...defaults(), window: "22:00-06:00" };
    expect(inWindow(night, at(27, 23))).toBe(true);
    expect(inWindow(night, at(27, 5))).toBe(true);
    expect(inWindow(night, at(27, 12))).toBe(false);
    expect(() => parseDays(["funday"])).toThrow();
    expect(() => parseWindow("9-5")).toThrow();
  });

  test("map expands into one pair per folder", () => {
    const dir = tempDir();
    fs.mkdirSync(path.join(dir, "src", "app"), { recursive: true });
    fs.mkdirSync(path.join(dir, "src", "docs"), { recursive: true });
    const cfg = path.join(dir, "f.yaml");
    fs.writeFileSync(
      cfg,
      "pairs:\n  - name: mono\n    source: src\n    target: repo\n    map: {app: packages/app, docs: docs}\n",
    );
    const { pairs } = loadFile(cfg);
    expect(pairs.map((p) => p.name)).toEqual(["mono/app", "mono/docs"]);
    expect(pairs[0]!.target).toBe(path.join(dir, "repo", "packages", "app"));
    expect(pairs[1]!.source).toBe(path.join(dir, "src", "docs"));
  });

  test("remote targets", () => {
    process.env.FERRY_HOME = tempDir();
    const p = defaults();
    p.source = tempDir();
    p.target = "deploy@example.com:site";
    normalize(p);
    expect(p.remote).toBe("ssh://deploy@example.com/~/site");
    expect(p.target.startsWith(dataDir())).toBe(true);
    const two = { ...defaults(), source: tempDir(), target: "deploy@example.com:site", mode: "two-way" };
    expect(() => normalize(two)).toThrow(/one-way/);
  });

  test("reads pairs saved by the Go version", () => {
    const p = pairFromJSON({
      Name: "n",
      Source: "/s",
      Target: "/t",
      Mode: "two-way",
      Settle: 300_000_000,
      EOL: "lf",
      AutoCommit: { Enabled: true, Interval: 600_000_000_000, Message: "m", Push: false },
    })!;
    expect(p).toMatchObject({ name: "n", source: "/s", mode: "two-way", settle: 300, eol: "lf" });
    expect(p.autoCommit).toEqual({ enabled: true, interval: 600_000, message: "m", push: false });
  });
});

describe("ignore", () => {
  test("gitignore semantics", () => {
    const m = new Matcher(
      "node_modules",
      "*.log",
      "!keep.log",
      "/build",
      "docs/*.md",
      "**/tmp/**",
      "cache/",
      "a/**/z",
      "file[0-9].txt",
    );
    m.add("sub", ["local.txt", "/only-here"]);
    const cases: [string, boolean, boolean][] = [
      ["node_modules", true, true],
      ["x/node_modules/pkg/index.js", false, true],
      ["app.log", false, true],
      ["deep/app.log", false, true],
      ["keep.log", false, false],
      ["build", true, true],
      ["build/out.js", false, true],
      ["src/build/out.js", false, false],
      ["docs/readme.md", false, true],
      ["docs/api/readme.md", false, false],
      ["x/tmp/y/z.txt", false, true],
      ["cache", true, true],
      ["cache", false, false],
      ["cache/item", false, true],
      ["a/z", false, true],
      ["a/b/c/z", false, true],
      ["file1.txt", false, true],
      ["fileA.txt", false, false],
      ["sub/local.txt", false, true],
      ["local.txt", false, false],
      ["sub/deeper/local.txt", false, true],
      ["sub/only-here", false, true],
      ["sub/x/only-here", false, false],
      ["src/main.go", false, false],
    ];
    for (const [p, dir, want] of cases) expect([p, dir, m.match(p, dir)]).toEqual([p, dir, want]);
  });
});

describe("merge", () => {
  const l = { ours: "target", theirs: "source" };
  const m = (b: string, o: string, t: string) => {
    const r = merge3(enc(b), enc(o), enc(t), l);
    return { out: r.data.toString(), n: r.conflicts };
  };
  test("clean", () =>
    expect(m("a\nb\nc\nd\ne\n", "a\nB\nc\nd\ne\n", "a\nb\nc\nD\ne\n")).toEqual({ out: "a\nB\nc\nD\ne\n", n: 0 }));
  test("same change on both sides", () => expect(m("x\ny\n", "x\nz\n", "x\nz\n")).toEqual({ out: "x\nz\n", n: 0 }));
  test("conflict markers", () => {
    const { out, n } = m("a\nb\nc\n", "a\nours\nc\n", "a\ntheirs\nc\n");
    expect(n).toBe(1);
    expect(out).toContain("<<<<<<< target\nours\n=======\ntheirs\n>>>>>>> source\n");
  });
  test("appends and no trailing newline", () => {
    const { out, n } = m("a\nb", "top\na\nb", "a\nb\nend");
    expect(n).toBe(0);
    expect(out.startsWith("top\na\n")).toBe(true);
    expect(out).toContain("end");
  });
  test("bytes survive", () => {
    const base = Buffer.from([0xc3, 0xa9, 0x0a, 0xff, 0x0a]);
    const ours = Buffer.from([0xc3, 0xa9, 0x0a, 0xff, 0x0a, 0x41, 0x0a]);
    expect([...merge3(base, ours, base, l).data]).toEqual([...ours]);
  });
});

describe("diff", () => {
  test("hunks", () => {
    const a = enc("a\nb\nc\nd\ne\nf\ng\nh\ni\nj\n");
    const b = enc("a\nB\nc\nd\ne\nf\ng\nh\ni\nj\nk\n");
    const lines = diff(a, b, 1);
    const n = (op: string) => lines.filter((x) => x.op === op).length;
    expect([n("+"), n("-"), n("@")]).toEqual([2, 1, 2]);
    expect(diff(a, a, 3)).toEqual([]);
    expect(diff(enc("x\0"), enc("y\0"), 3).length).toBe(1);
  });
});

describe("remote", () => {
  test("parse and round-trip", () => {
    const cases: [string, { host: string; port: string; path: string }][] = [
      ["me@host:repo", { host: "me@host", port: "", path: "~/repo" }],
      ["me@host:/srv/site", { host: "me@host", port: "", path: "/srv/site" }],
      ["ssh://me@host:2222/srv/www", { host: "me@host", port: "2222", path: "/srv/www" }],
      ["ssh://host/~/notes", { host: "host", port: "", path: "~/notes" }],
    ];
    for (const [input, want] of cases) {
      const got = parse(input);
      expect({ host: got.host, port: got.port, path: got.path }).toEqual(want);
      const again = parse(got.toString());
      expect({ host: again.host, port: again.port, path: again.path }).toEqual(want);
    }
    for (const bad of ["C:\\work", "/tmp/x", "host:path", "ssh://host"]) {
      if (isSpec(bad)) expect(() => parse(bad)).toThrow();
    }
    expect(isSpec("C:\\work")).toBe(false);
  });
  test("quoting", () => {
    expect(quotePath("~/my dir")).toBe(`"$HOME"/'my dir'`);
    expect(quote("it's")).toBe(`'it'\\''s'`);
  });
});

describe("tar", () => {
  test("system tar extracts what we write", async () => {
    const dir = tempDir();
    const src = path.join(dir, "in");
    fs.mkdirSync(src);
    const long = "deep/" + "x".repeat(120) + "/file.txt";
    fs.writeFileSync(path.join(src, "a.txt"), "hello");
    const archive = path.join(dir, "out.tar");
    const tw = new TarWriter(archive);
    tw.add({ name: "a.txt", mode: 0o644, mtimeSec: Date.now() / 1000, size: 5, file: path.join(src, "a.txt") });
    tw.add({ name: long, mode: 0o644, mtimeSec: Date.now() / 1000, size: 5, file: path.join(src, "a.txt") });
    tw.add({ name: "sub/ünï.txt", mode: 0o600, mtimeSec: Date.now() / 1000, size: 5, file: path.join(src, "a.txt") });
    tw.close();
    const out = path.join(dir, "x");
    fs.mkdirSync(out);
    // relative paths: GNU tar on Windows reads "C:" as a remote host
    const r = await exec(["tar", "-xf", "out.tar", "-C", "x"], { cwd: dir });
    expect(r.output).toBe("");
    expect(fs.readFileSync(path.join(out, "a.txt"), "utf8")).toBe("hello");
    expect(fs.readFileSync(path.join(out, ...long.split("/")), "utf8")).toBe("hello");
    expect(fs.readFileSync(path.join(out, "sub", "ünï.txt"), "utf8")).toBe("hello");
  });
});

describe("git", () => {
  test("status, commit, in-progress detection", async () => {
    const dir = tempDir();
    await gitx.run(dir, "init", "-q", "-b", "main");
    await gitx.run(dir, "config", "user.email", "t@example.com");
    await gitx.run(dir, "config", "user.name", "t");
    expect(await gitx.isRepo(dir)).toBe(true);
    expect(await gitx.isRepo(tempDir())).toBe(false);
    fs.writeFileSync(path.join(dir, "a.txt"), "x");
    expect(await gitx.status(dir)).toEqual(["?? a.txt"]);
    expect(await gitx.commitAll(dir, "first")).toMatch(/^[0-9a-f]{4,}$/);
    expect(await gitx.commitAll(dir, "again")).toBe("");
    expect(await gitx.currentBranch(dir)).toBe("main");
    expect((await gitx.showHead(dir, "a.txt"))?.toString()).toBe("x");
    expect(await gitx.showHead(dir, "missing.txt")).toBeNull();
    expect(await gitx.inProgress(dir)).toBe("");
    fs.writeFileSync(path.join(dir, ".git", "MERGE_HEAD"), "0000");
    expect(await gitx.inProgress(dir)).toBe("merge in progress");
    fs.rmSync(path.join(dir, ".git", "MERGE_HEAD"));
    fs.writeFileSync(path.join(dir, ".git", "index.lock"), "");
    expect(await gitx.inProgress(dir)).toContain("index.lock");
    fs.rmSync(path.join(dir, ".git", "index.lock"));
    expect(await gitx.ensureBranch(dir, "feature/x")).toBe(true);
    expect(await gitx.currentBranch(dir)).toBe("feature/x");
  });
});
