// The web app's Git client, against real git repositories in temp folders.
import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

import * as g from "../src/gitclient.ts";
import { tempDir } from "./helpers.ts";

const sh = (dir: string, ...args: string[]) => {
  const r = Bun.spawnSync(["git", "-C", dir, ...args], { env: { ...process.env, GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@example.com" } });
  if (r.exitCode !== 0) throw new Error(r.stderr.toString());
  return r.stdout.toString();
};
const put = (dir: string, rel: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
};
const read = (dir: string, rel: string) => fs.readFileSync(path.join(dir, rel), "utf8");

async function repo(): Promise<string> {
  const d = await g.create(path.join(tempDir(), "r"));
  sh(d, "config", "user.email", "t@example.com");
  sh(d, "config", "user.name", "T");
  put(d, "a.txt", "one\ntwo\nthree\n");
  await g.stage(d, []);
  await g.commit(d, "first");
  return d;
}

describe("git client", () => {
  test("state, staging, commit, amend and undo", async () => {
    const d = await repo();
    put(d, "a.txt", "one\nTWO\nthree\n");
    put(d, "new.txt", "hi\n");
    let st = await g.state(d);
    expect(st.branch).toBe("main");
    expect(st.files.map((f) => f.path).sort()).toEqual(["a.txt", "new.txt"]);
    expect(st.files.find((f) => f.path === "new.txt")!.untracked).toBe(true);
    await expect(g.commit(d, "nothing staged")).rejects.toThrow(/nothing is staged/);
    await g.stage(d, ["a.txt"]);
    st = await g.state(d);
    expect(st.files.find((f) => f.path === "a.txt")!.staged).toBe(true);
    await g.unstage(d, ["a.txt"]);
    expect((await g.state(d)).files.find((f) => f.path === "a.txt")!.staged).toBe(false);
    await g.stage(d, ["a.txt"]);
    await g.commit(d, "second", { coAuthors: ["Sam <sam@example.com>"] });
    expect(sh(d, "log", "-1", "--format=%B")).toContain("Co-authored-by: Sam <sam@example.com>");
    await g.stage(d, ["new.txt"]);
    await g.commit(d, "second, amended", { amend: true });
    expect(sh(d, "log", "--format=%s")).toBe("second, amended\nfirst\n");
    const u = await g.undoCommit(d);
    expect(u.subject).toBe("second, amended");
    st = await g.state(d);
    expect(st.files.filter((f) => f.staged).map((f) => f.path).sort()).toEqual(["a.txt", "new.txt"]);
    expect(st.lastCommit!.subject).toBe("first");
  });

  test("staging only some lines, including in a new file", async () => {
    const d = await repo();
    put(d, "a.txt", "zero\none\nTWO\nthree\nfour\n");
    const { lines } = await g.fileDiff(d, "a.txt", false);
    // pick only the edit of line two: the "-two" and "+TWO" lines
    const pick = lines.map((l, i) => ((l.op === "-" && l.text === "two") || (l.op === "+" && l.text === "TWO") ? i : -1)).filter((i) => i >= 0);
    expect(pick.length).toBe(2);
    await g.stageLines(d, "a.txt", pick);
    expect(sh(d, "show", ":a.txt")).toBe("one\nTWO\nthree\n");
    expect(read(d, "a.txt")).toBe("zero\none\nTWO\nthree\nfour\n"); // the working copy is untouched

    put(d, "b.txt", "keep\nskip\n");
    const nb = await g.fileDiff(d, "b.txt", false);
    expect(nb.lines.filter((l) => l.op === "+").length).toBe(2);
    const raw = await g.fileDiff(d, "b.txt", false); // untracked: shown as all new
    expect(raw.before).toBe("Not in git yet");
    await g.stageLines(d, "b.txt", [1]); // after intent-to-add, index 1 is "+keep"
    expect(sh(d, "show", ":b.txt")).toBe("keep\n");
    await expect(g.stageLines(d, "a.txt", [])).rejects.toThrow(/pick at least one/);
  });

  test("discard puts files back and moves the current versions away", async () => {
    const d = await repo();
    put(d, "a.txt", "changed\n");
    put(d, "junk.txt", "x\n");
    put(d, "added.txt", "y\n");
    await g.stage(d, ["added.txt"]);
    expect(await g.discard(d, ["a.txt", "junk.txt", "added.txt"])).toBe(3);
    expect(read(d, "a.txt")).toBe("one\ntwo\nthree\n");
    expect(fs.existsSync(path.join(d, "junk.txt"))).toBe(false);
    expect(fs.existsSync(path.join(d, "added.txt"))).toBe(false);
    expect((await g.state(d)).files).toEqual([]);
  });

  test("stashes", async () => {
    const d = await repo();
    put(d, "a.txt", "stashed\n");
    put(d, "u.txt", "untracked\n");
    await g.stash(d, "work in progress");
    expect((await g.state(d)).files).toEqual([]);
    const list = await g.stashes(d);
    expect(list[0]).toMatchObject({ ref: "stash@{0}", message: "work in progress", branch: "main" });
    await g.stashApply(d, "stash@{0}", false);
    expect(read(d, "a.txt")).toBe("stashed\n");
    expect((await g.stashes(d)).length).toBe(1);
    await g.stashDrop(d, "stash@{0}");
    expect(await g.stashes(d)).toEqual([]);
    await expect(g.stashDrop(d, "--all")).rejects.toThrow();
  });

  test("history and a commit's files and diffs", async () => {
    const d = await repo();
    put(d, "a.txt", "one\nTWO\nthree\n");
    fs.renameSync(path.join(d, "a.txt"), path.join(d, "b.txt"));
    await g.stage(d, []);
    const h = await g.commit(d, "rename and edit");
    const commits = await g.log(d);
    expect(commits.map((c) => c.subject)).toEqual(["rename and edit", "first"]);
    expect(commits[0]!.refs).toContain("main");
    const det = await g.commitDetail(d, h);
    expect(det.files[0]).toMatchObject({ path: "b.txt", from: "a.txt", status: "R", added: 1, removed: 1 });
    const fd = await g.commitFileDiff(d, h, "b.txt");
    expect(fd.lines.some((l) => l.op === "+" && l.text === "TWO")).toBe(true);
    const root = await g.commitDetail(d, commits[1]!.hash);
    expect(root.files[0]).toMatchObject({ path: "a.txt", status: "A" });
    await expect(g.commitDetail(d, "HEAD; rm -rf /")).rejects.toThrow(/isn't a commit id/);
  });

  test("branches: create, switch, rename, merge with conflicts, delete", async () => {
    const d = await repo();
    await g.createBranch(d, "feature", "", true);
    put(d, "a.txt", "one\nfeature\nthree\n");
    await g.stage(d, []);
    await g.commit(d, "feature edit");
    await g.switchBranch(d, "main");
    put(d, "a.txt", "one\nmain\nthree\n");
    await g.stage(d, []);
    await g.commit(d, "main edit");
    const b = await g.branches(d);
    expect(b.local.map((x) => x.name).sort()).toEqual(["feature", "main"]);
    expect(b.local.find((x) => x.current)!.name).toBe("main");

    const m = await g.merge(d, "feature");
    expect(m.conflicts).toEqual(["a.txt"]);
    let st = await g.state(d);
    expect(st.operation).toBe("merge");
    expect(st.operationBranch).toBe("feature");
    const cd = await g.conflictDiff(d, "a.txt");
    expect(cd.lines.some((l) => l.op === "-" && l.text === "main")).toBe(true);
    expect(cd.lines.some((l) => l.op === "+" && l.text === "feature")).toBe(true);
    await expect(g.finishOperation(d, "continue")).rejects.toThrow(/still need a decision/);
    await g.resolveConflict(d, "a.txt", "both");
    expect(read(d, "a.txt")).toBe("one\nmain\nfeature\nthree\n");
    await g.finishOperation(d, "continue");
    st = await g.state(d);
    expect(st.operation).toBe("");
    expect((await g.log(d))[0]!.parents.length).toBe(2);

    await expect(g.createBranch(d, "bad..name", "", false)).rejects.toThrow(/valid branch name/);
    await expect(g.createBranch(d, "-x", "", false)).rejects.toThrow(/can't start/);
    await g.renameBranch(d, "feature", "feature-2");
    await g.deleteBranch(d, "feature-2", false); // merged, so a plain delete works
    expect((await g.branches(d)).local.map((x) => x.name)).toEqual(["main"]);
  });

  test("a conflict can be kept as yours, or the merge aborted", async () => {
    const d = await repo();
    await g.createBranch(d, "other", "", true);
    put(d, "a.txt", "theirs\n");
    await g.stage(d, []);
    await g.commit(d, "theirs");
    await g.switchBranch(d, "main");
    put(d, "a.txt", "ours\n");
    await g.stage(d, []);
    await g.commit(d, "ours");
    await g.merge(d, "other");
    await g.finishOperation(d, "abort");
    expect(read(d, "a.txt")).toBe("ours\n");
    await g.merge(d, "other");
    put(d, "a.txt", "<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> other\n");
    await expect(g.resolveConflict(d, "a.txt", "done")).rejects.toThrow(/conflict markers/);
    await g.resolveConflict(d, "a.txt", "theirs");
    await g.finishOperation(d, "continue");
    expect(read(d, "a.txt")).toBe("theirs\n");
  });

  test("cherry-pick, revert and tags", async () => {
    const d = await repo();
    await g.createBranch(d, "side", "", true);
    put(d, "s.txt", "side\n");
    await g.stage(d, []);
    const side = await g.commit(d, "side file");
    await g.switchBranch(d, "main");
    expect((await g.cherryPick(d, side)).conflicts).toEqual([]);
    expect(read(d, "s.txt")).toBe("side\n");
    const head = (await g.log(d))[0]!;
    expect((await g.revert(d, head.hash)).conflicts).toEqual([]);
    expect(fs.existsSync(path.join(d, "s.txt"))).toBe(false);
    await g.createTag(d, "v1.0", "first release", "");
    await g.createTag(d, "light", "", head.short);
    expect((await g.tags(d)).map((t) => t.name).sort()).toEqual(["light", "v1.0"]);
    expect((await g.tags(d)).find((t) => t.name === "v1.0")!.message).toBe("first release");
    await g.deleteTag(d, "light");
    await expect(g.createTag(d, "bad tag", "", "")).rejects.toThrow(/valid tag name/);
  });

  test("worktrees", async () => {
    const d = await repo();
    const wt = path.join(tempDir(), "wt");
    await g.addWorktree(d, wt, "hotfix", true);
    let list = await g.worktrees(d);
    expect(list.length).toBe(2);
    expect(list[0]!.main).toBe(true);
    expect(list.find((w) => w.path === fs.realpathSync(wt))?.branch).toBe("hotfix");
    await expect(g.removeWorktree(d, list[0]!.path, false)).rejects.toThrow(/main worktree/);
    await g.removeWorktree(d, list[1]!.path, false);
    list = await g.worktrees(d);
    expect(list.length).toBe(1);
  });

  test("clone, push, fetch and pull against a bare remote", async () => {
    const d = await repo();
    const bare = path.join(tempDir(), "remote.git");
    sh(tempDir(), "init", "-q", "--bare", bare);
    sh(d, "remote", "add", "origin", bare);
    expect(await g.push(d, false)).toBe("main");
    let st = await g.state(d);
    expect(st.upstream).toBe("origin/main");
    expect(st.lastCommit!.pushed).toBe(true);

    const copy = await g.clone(bare, path.join(tempDir(), "copy"));
    sh(copy, "config", "user.email", "t@example.com");
    sh(copy, "config", "user.name", "T");
    expect(read(copy, "a.txt")).toBe("one\ntwo\nthree\n");
    put(copy, "c.txt", "from the copy\n");
    await g.stage(copy, []);
    await g.commit(copy, "from the copy");
    await g.push(copy, false);

    await g.fetchAll(d);
    st = await g.state(d);
    expect(st.behind).toBe(1);
    await g.pull(d, "");
    expect(read(d, "c.txt")).toBe("from the copy\n");

    // both sides move on: a plain pull refuses, and says why
    put(copy, "c.txt", "copy again\n");
    await g.stage(copy, []);
    await g.commit(copy, "copy again");
    await g.push(copy, false);
    put(d, "d.txt", "local\n");
    await g.stage(d, []);
    await g.commit(d, "local");
    await g.fetchAll(d);
    await expect(g.pull(d, "")).rejects.toMatchObject({ code: "diverged" });
    await expect(g.push(d, false)).rejects.toMatchObject({ code: "rejected" });
    await g.pull(d, "rebase");
    st = await g.state(d);
    expect(st.ahead).toBe(1);
    expect(st.behind).toBe(0);
    await g.push(d, false);
    await expect(g.clone("--upload-pack=evil", path.join(tempDir(), "x"))).rejects.toThrow();
  }, 60_000);

  test("paths outside the repository are refused", async () => {
    const d = await repo();
    await expect(g.stage(d, ["../outside.txt"])).rejects.toThrow(/outside the repository/);
    await expect(g.fileDiff(d, "/etc/passwd", false)).rejects.toThrow(/outside the repository/);
  });
});

describe("git client over HTTP", () => {
  test("lists repositories, runs actions, and pauses a pair whose target is in the repository", async () => {
    const { ApiServer } = await import("../src/api.ts");
    const { setup, write, runOnce } = await import("./helpers.ts");
    const d = await repo();
    const opened: string[] = [d];
    const repos = { list: () => opened, add: (x: string) => void opened.push(x), remove: (x: string) => void opened.splice(opened.indexOf(x), 1) };
    const { e, s } = setup((p) => (p.target = path.join(d, "site")));
    write(s, "index.html", "<h1>hi</h1>");
    await runOnce(e);
    const api = new ApiServer([e], "", { repos });
    const call = (p: string, body?: unknown) => api.handle(new Request("http://127.0.0.1" + p, body === undefined ? undefined : { method: "POST", headers: { "X-Ferry": "1" }, body: JSON.stringify(body) }));

    const list = (await (await call("/git/repos")).json()) as { id: string; path: string; pairs: string[]; standalone: boolean }[];
    expect(list).toHaveLength(1); // the pair's target is inside the same repository
    expect(list[0]!.pairs).toEqual([e.name]);
    const id = list[0]!.id;
    const st = (await (await call(`/git/${id}/state`)).json()) as { files: { path: string }[] };
    expect(st.files.map((f) => f.path)).toEqual(["site/index.html"]);

    expect((await call(`/git/${id}/stage`, { files: ["site/index.html"] })).status).toBe(200);
    const c = (await (await call(`/git/${id}/commit`, { message: "add site" })).json()) as { commit: string; paused: string[] };
    expect(c.commit).toMatch(/^[0-9a-f]+$/);
    expect(c.paused).toEqual([]); // committing doesn't touch the files
    const sw = (await (await call(`/git/${id}/branch-create`, { name: "next", checkout: true })).json()) as { branch: string };
    expect(sw.branch).toBe("next");
    const back = (await (await call(`/git/${id}/branch-switch`, { name: "main" })).json()) as { paused: string[] };
    expect(back.paused).toEqual([e.name]); // switching branches rewrites files: the pair is paused first
    await Bun.sleep(50);
    expect(e.getStatus().userPaused).toBe(true);

    const bad = await call(`/git/${id}/branch-switch`, { name: "--orphan" });
    expect(bad.status).toBe(409);
    expect(((await bad.json()) as { error: string }).error).toContain("can't start");
    expect((await call("/git/nope/state")).status).toBe(404);
    const noPost = await api.handle(new Request("http://127.0.0.1/git/" + id + "/stage", { method: "POST", body: "{}" }));
    expect(noPost.status).toBe(403); // the X-Ferry header is still required
  });
});

describe("very large diffs", () => {
  test("are cut to the first lines, saying how many more there are", async () => {
    const d = await repo();
    const n = g.MAX_DIFF_LINES + 500;
    put(d, "big.json", Array.from({ length: n }, (_, i) => `line ${i}`).join("\n") + "\n");
    const untracked = await g.fileDiff(d, "big.json", false);
    expect(untracked.lines.length).toBe(g.MAX_DIFF_LINES);
    expect(untracked.more).toBeGreaterThan(0);
    await g.stage(d, ["big.json"]);
    const hash = await g.commit(d, "add big");
    const c = await g.commitFileDiff(d, hash, "big.json");
    expect(c.lines.length).toBe(g.MAX_DIFF_LINES);
    expect(c.lines.length + c.more!).toBe(n + 1); // plus the hunk header
    expect((await g.fileDiff(d, "a.txt", false)).more).toBeUndefined();
  });
});
