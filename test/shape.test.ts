// "Shape my history": Ferry's recorded syncs become separate commits.
import { expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

import * as g from "../src/gitclient.ts";
import * as shaper from "../src/shape.ts";
import { rm, runOnce, setup, tempDir, write } from "./helpers.ts";

const sh = (dir: string, ...args: string[]) => {
  const r = Bun.spawnSync(["git", "-C", dir, ...args]);
  if (r.exitCode !== 0) throw new Error(r.stderr.toString());
  return r.stdout.toString();
};

async function scene() {
  const d = await g.create(path.join(tempDir(), "repo"));
  sh(d, "config", "user.email", "t@example.com");
  sh(d, "config", "user.name", "T");
  fs.writeFileSync(path.join(d, "README.md"), "hello\n");
  fs.writeFileSync(path.join(d, "old.txt"), "going away\n");
  await g.stage(d, []);
  await g.commit(d, "first");
  await Bun.sleep(1100); // syncs must come after the commit's (whole-second) time
  const { e, s } = setup((p) => { p.target = d; p.onDelete = "propagate"; p.delete = false; }); // syncs straight into the repository, deletes too
  write(s, "README.md", "hello\n");
  write(s, "old.txt", "going away\n");
  await runOnce(e); // nothing to copy: both sides match
  write(s, "a.txt", "v1\n");
  await runOnce(e); // step 1: a.txt appears
  await Bun.sleep(20);
  write(s, "a.txt", "v2\n");
  write(s, "b.txt", "b1\n");
  await runOnce(e); // step 2: a.txt edited, b.txt appears
  await Bun.sleep(20);
  write(s, "a.txt", "v3\n");
  rm(s, "old.txt");
  await runOnce(e); // step 3: a.txt edited again, old.txt deleted
  fs.writeFileSync(path.join(d, "notes.txt"), "written in the repository, not by Ferry\n");
  return { d, e };
}

const show = (d: string, rev: string, file: string) => {
  const r = Bun.spawnSync(["git", "-C", d, "show", `${rev}:${file}`]);
  return r.exitCode === 0 ? r.stdout.toString() : null;
};

test("the timeline lists each sync since the last commit, and what Ferry didn't write", async () => {
  const { d, e } = await scene();
  const t = await shaper.timeline(d, [e]);
  expect(t.branch).toBeTruthy();
  expect(t.batches.map((b) => b.files.map((f) => `${f.op} ${f.path}`).sort())).toEqual([
    ["add a.txt"],
    ["add b.txt", "update a.txt"],
    ["delete old.txt", "update a.txt"],
  ]);
  expect(t.unrecorded).toEqual(["notes.txt"]);

  // what one step changed in one file
  const step2 = await shaper.groupDiff(d, [e], { batches: [t.batches[1]!.id], path: "a.txt" });
  const changes = step2.lines.filter((l) => l.op !== " " && l.op !== "@");
  expect(changes).toHaveLength(2);
  expect(changes).toContainEqual({ op: "-", text: "v1" });
  expect(changes).toContainEqual({ op: "+", text: "v2" });
});

test("groups of syncs become commits with the content from that moment; your folder is left as it is", async () => {
  const { d, e } = await scene();
  const t = await shaper.timeline(d, [e]);
  const before = sh(d, "rev-parse", "HEAD").trim();
  const r = await shaper.shape(d, [e], {
    head: t.head,
    groups: [{ batches: [t.batches[0]!.id], message: "Start a.txt" }, { batches: [t.batches[1]!.id, t.batches[2]!.id], message: "Add b.txt, finish a.txt\n\nAnd retire old.txt." }],
  });
  expect(r.commits.map((c) => c.message)).toEqual(["Start a.txt", "Add b.txt, finish a.txt"]);
  const [c1, c2] = r.commits.map((c) => c.hash);
  expect(sh(d, "rev-parse", "HEAD").trim()).toBe(c2!);
  expect(sh(d, "rev-parse", `${c1}^`).trim()).toBe(before);
  // commit 1: a.txt as it was after the first sync; b.txt not yet; old.txt still there
  expect(show(d, c1!, "a.txt")).toBe("v1\n");
  expect(show(d, c1!, "b.txt")).toBeNull();
  expect(show(d, c1!, "old.txt")).toBe("going away\n");
  // commit 2: the end state
  expect(show(d, c2!, "a.txt")).toBe("v3\n");
  expect(show(d, c2!, "b.txt")).toBe("b1\n");
  expect(show(d, c2!, "old.txt")).toBeNull();
  expect(sh(d, "log", "-1", "--format=%B", c2!).trim()).toBe("Add b.txt, finish a.txt\n\nAnd retire old.txt.");
  // the folder didn't change, and only the file Ferry didn't write is still uncommitted
  expect(fs.readFileSync(path.join(d, "a.txt"), "utf8")).toBe("v3\n");
  expect((await g.state(d)).files.map((f) => f.path)).toEqual(["notes.txt"]);
});

test("refuses a plan that no longer matches: a new commit, or a sync that arrived meanwhile", async () => {
  const { d, e } = await scene();
  const t = await shaper.timeline(d, [e]);
  const groups = [{ batches: t.batches.map((b) => b.id), message: "All of it" }];
  await expect(shaper.shape(d, [e], { head: "0".repeat(40), groups })).rejects.toThrow(/branch has moved/);
  await expect(shaper.shape(d, [e], { head: t.head, groups: [{ batches: t.batches.slice(1).map((b) => b.id), message: "x" }] })).rejects.toThrow(/timeline changed/);
  await expect(shaper.shape(d, [e], { head: t.head, groups: [{ batches: t.batches.map((b) => b.id), message: " " }] })).rejects.toThrow(/needs a message/);
  expect(sh(d, "rev-parse", "HEAD").trim()).toBe(t.head); // nothing moved
});

test("a step whose backup is gone rolls into the next commit instead of being guessed", async () => {
  const { d, e } = await scene();
  const t = await shaper.timeline(d, [e]);
  // remove every backup: a.txt's in-between versions (v1, v2) are no longer known
  fs.rmSync(path.join(e.dataDir, e.id, "backups"), { recursive: true, force: true });
  const r = await shaper.shape(d, [e], { head: t.head, groups: t.batches.map((b, i) => ({ batches: [b.id], message: "step " + (i + 1) })) });
  const last = r.commits[r.commits.length - 1]!.hash;
  expect(show(d, last, "a.txt")).toBe("v3\n");
  // no commit claims a version Ferry can't vouch for: a.txt only ever appears as v3
  for (const c of r.commits) expect(["v3\n", null]).toContain(show(d, c.hash, "a.txt"));
  expect(r.skipped).toBe(1); // step 1 only touched a.txt, whose version then is unknown
});

test("over HTTP: the web app's timeline, step preview and commit calls", async () => {
  const { ApiServer } = await import("../src/api.ts");
  const { d, e } = await scene();
  const api = new ApiServer([e], "", { repos: { list: () => [d], add() {}, remove() {} } });
  const call = async (p: string, body?: unknown) => {
    const res = await api.handle(new Request("http://127.0.0.1" + p, body === undefined ? undefined : { method: "POST", headers: { "X-Ferry": "1" }, body: JSON.stringify(body) }));
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  const id = ((await call("/git/repos")).body as unknown as { id: string }[])[0]!.id;
  const t = (await call(`/git/${id}/shape`)).body as unknown as shaper.ShapeTimeline;
  expect(t.batches).toHaveLength(3);
  const diff = await call(`/git/${id}/shape-diff`, { batches: [t.batches[2]!.id], path: "old.txt" });
  expect(JSON.stringify(diff.body.lines)).toContain("going away");
  const made = await call(`/git/${id}/shape-commit`, { head: t.head, groups: [{ batches: t.batches.map((b) => b.id), message: "Everything at once" }] });
  expect(made.status).toBe(200);
  expect((made.body.commits as { message: string }[]).map((c) => c.message)).toEqual(["Everything at once"]);
  const again = await call(`/git/${id}/shape-commit`, { head: t.head, groups: [{ batches: t.batches.map((b) => b.id), message: "twice" }] });
  expect(again.status).toBe(409); // the branch moved: the old plan is refused
  expect(again.body.code).toBe("stale");
});
