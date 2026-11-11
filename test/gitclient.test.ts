// The web app's Git client, against real git repositories in temp folders.
import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

import * as g from "../src/gitclient.ts";
import { tempDir } from "./helpers.ts";

const sh = (dir: string, ...args: string[]) => {
  const r = Bun.spawnSync(["git", "-C", dir, ...args], {
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "T",
      GIT_AUTHOR_EMAIL: "t@example.com",
      GIT_COMMITTER_NAME: "T",
      GIT_COMMITTER_EMAIL: "t@example.com",
    },
  });
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
  test("rewrite recent commits: reword, squash, drop and reorder, with work in progress kept", async () => {
    const d = await repo(); // "first": a.txt
    const add = (f: string, text: string, msg: string) => {
      put(d, f, text);
      sh(d, "add", f);
      sh(d, "commit", "-m", msg);
    };
    add("b.txt", "b\n", "add b");
    add("c.txt", "c\n", "add c");
    add("c.txt", "c, fixed\n", "fix c");
    add("d.txt", "d\n", "add d");
    put(d, "a.txt", "work in progress\n"); // uncommitted
    const from = sh(d, "rev-parse", "HEAD~3").trim(); // "add b"
    const plan = await g.rewritePlan(d, from);
    expect(plan.blocked).toBe("");
    expect(plan.dirty).toBe(true);
    expect(plan.commits.map((c) => c.subject)).toEqual(["add b", "add c", "fix c", "add d"]);
    expect(plan.commits.every((c) => !c.pushed)).toBe(true); // no remote
    const [b, c, fix, dd] = plan.commits;

    // d first (reordered), c reworded with "fix c" squashed into it, b dropped
    const r = await g.rewrite(d, {
      from,
      head: plan.head,
      steps: [
        { hash: dd!.hash, action: "pick" },
        { hash: b!.hash, action: "drop" },
        { hash: c!.hash, action: "pick", message: "add c (fixed)" },
        { hash: fix!.hash, action: "squash" },
      ],
    });
    expect(r).toEqual({ commits: 2, stopped: false, changed: true });
    expect(sh(d, "log", "--format=%s").trim().split("\n")).toEqual(["add c (fixed)", "add d", "first"]);
    expect(read(d, "c.txt")).toBe("c, fixed\n");
    expect(fs.existsSync(path.join(d, "b.txt"))).toBe(false);
    expect(read(d, "a.txt")).toBe("work in progress\n"); // set aside and put back

    // what's refused, before anything changes
    const now = await g.rewritePlan(d, sh(d, "rev-parse", "HEAD~1").trim());
    const steps = now.commits.map((x) => ({ hash: x.hash, action: "pick" as const }));
    await expect(g.rewrite(d, { from: now.from, head: "0".repeat(40), steps })).rejects.toThrow(/moved/);
    await expect(g.rewrite(d, { from: now.from, head: now.head, steps: steps.slice(1) })).rejects.toThrow(
      /every commit/,
    );
    await expect(
      g.rewrite(d, { from: now.from, head: now.head, steps: [{ ...steps[0]!, action: "squash" }, steps[1]!] }),
    ).rejects.toThrow(/nothing before it/);
    await expect(
      g.rewrite(d, { from: now.from, head: now.head, steps: steps.map((x) => ({ ...x, action: "drop" as const })) }),
    ).rejects.toThrow(/drop every commit/);
    await expect(
      g.rewrite(d, { from: now.from, head: now.head, steps: [{ hash: "deadbeef", action: "pick" }, steps[1]!] }),
    ).rejects.toThrow(/don't match/);
    // nothing to do: nothing happens
    expect(await g.rewrite(d, { from: now.from, head: now.head, steps })).toMatchObject({ changed: false });
    expect(sh(d, "log", "--format=%s").trim().split("\n")).toEqual(["add c (fixed)", "add d", "first"]);
  });

  test("rewrite: merges block it, pushed commits are marked, a conflicting reorder stops for you", async () => {
    const d = await repo();
    const main = sh(d, "branch", "--show-current").trim();
    // pushed: a remote that has "first"
    const remote = path.join(tempDir(), "remote.git");
    sh(d, "init", "--bare", remote);
    sh(d, "remote", "add", "origin", remote);
    sh(d, "push", "-q", "origin", main);
    put(d, "a.txt", "one\ntwo\nthree\nfour\n");
    sh(d, "commit", "-qam", "add four");
    put(d, "a.txt", "one\ntwo\nthree\nfour\nfive\n");
    sh(d, "commit", "-qam", "add five");
    const root = sh(d, "rev-list", "--max-parents=0", "HEAD").trim();
    const plan = await g.rewritePlan(d, root);
    expect(plan.commits.map((c) => [c.subject, c.pushed])).toEqual([
      ["first", true],
      ["add four", false],
      ["add five", false],
    ]);
    // "add five" before "add four" can't apply: the rebase stops on the conflict
    const [, four, five] = plan.commits;
    const r = await g.rewrite(d, {
      from: four!.hash,
      head: plan.head,
      steps: [
        { hash: five!.hash, action: "pick" },
        { hash: four!.hash, action: "pick" },
      ],
    });
    expect(r.stopped).toBe(true);
    expect((await g.state(d)).operation).toBe("rebase");
    await g.finishOperation(d, "abort");
    expect(sh(d, "log", "--format=%s").trim().split("\n")).toEqual(["add five", "add four", "first"]);

    // a merge in the range: blocked
    sh(d, "switch", "-qc", "side");
    put(d, "s.txt", "s\n");
    sh(d, "add", "s.txt");
    sh(d, "commit", "-qm", "side");
    sh(d, "switch", "-q", main);
    sh(d, "merge", "-q", "--no-ff", "--no-edit", "side");
    expect((await g.rewritePlan(d, four!.hash)).blocked).toMatch(/merge commit/);
  });

  test("a conflict in pieces, settled change by change", async () => {
    const d = await repo(); // a.txt: one / two / three
    const main = sh(d, "branch", "--show-current").trim();
    sh(d, "switch", "-c", "theirs");
    put(d, "a.txt", "ONE (theirs)\ntwo\nthree\n");
    sh(d, "commit", "-am", "theirs");
    sh(d, "switch", main);
    put(d, "a.txt", "one (mine)\ntwo\nthree, and more\n");
    sh(d, "commit", "-am", "mine");
    Bun.spawnSync(["git", "-C", d, "merge", "theirs"], { env: { ...process.env, GIT_MERGE_AUTOEDIT: "no" } });

    const c = await g.conflictParts(d, "a.txt");
    expect(c.reason).toBe("");
    const conflicts = c.parts!.filter((x) => x.kind === "conflict");
    expect(conflicts).toEqual([{ kind: "conflict", ours: "one (mine)\n", base: "one\n", theirs: "ONE (theirs)\n" }]);
    // the change only one side made merges by itself
    expect(
      c
        .parts!.filter((x) => x.kind === "same")
        .map((x) => (x as { text: string }).text)
        .join(""),
    ).toContain("three, and more\n");

    // settled with text that still has markers: refused
    await expect(g.resolveConflict(d, "a.txt", "text", "<<<<<<< ours\nx\n")).rejects.toThrow(/conflict markers/);
    // settled: both lines, theirs first
    await g.resolveConflict(d, "a.txt", "text", "ONE (theirs)\none (mine)\ntwo\nthree, and more\n");
    expect(read(d, "a.txt")).toBe("ONE (theirs)\none (mine)\ntwo\nthree, and more\n");
    expect(sh(d, "diff", "--name-only", "--diff-filter=U").trim()).toBe(""); // no longer conflicted
  });

  test("parseMerge: diff3 output in pieces, line endings kept, stray markers left as text", () => {
    expect(g.parseMerge("a\n<<<<<<< ours\nmine\n||||||| base\nold\n=======\ntheirs\n>>>>>>> theirs\nz\n")).toEqual([
      { kind: "same", text: "a\n" },
      { kind: "conflict", ours: "mine\n", base: "old\n", theirs: "theirs\n" },
      { kind: "same", text: "z\n" },
    ]);
    expect(g.parseMerge("<<<<<<< ours\r\nm\r\n||||||| base\r\n=======\r\nt\r\n>>>>>>> theirs\r\n")).toEqual([
      { kind: "conflict", ours: "m\r\n", base: "", theirs: "t\r\n" },
    ]);
    // a line that only looks like the start of a conflict
    expect(g.parseMerge("<<<<<<< not really\nrest\n")).toEqual([{ kind: "same", text: "<<<<<<< not really\nrest\n" }]);
    expect(g.parseMerge("")).toEqual([]);
  });

  test("compare two branches: commits on each side, and what one changed since they split", async () => {
    const d = await repo();
    const main = sh(d, "branch", "--show-current").trim();
    sh(d, "switch", "-c", "feature");
    put(d, "a.txt", "one\nTWO\nthree\n");
    put(d, "new.txt", "hello\n");
    sh(d, "add", "-A");
    sh(d, "commit", "-m", "feature work");
    sh(d, "switch", main);
    put(d, "other.txt", "main moved on\n");
    sh(d, "add", "-A");
    sh(d, "commit", "-m", "main work");

    const c = await g.compare(d, main, "feature");
    expect(c.aheadCount).toBe(1);
    expect(c.ahead.map((x) => x.subject)).toEqual(["feature work"]);
    expect(c.behindCount).toBe(1);
    expect(c.behind.map((x) => x.subject)).toEqual(["main work"]);
    expect(c.mergeBase).not.toBe("");
    // since they split: what feature changed, not main's other.txt
    expect(c.files.map((f) => [f.path, f.status]).sort()).toEqual([
      ["a.txt", "M"],
      ["new.txt", "A"],
    ]);
    expect(c.files.find((f) => f.path === "a.txt")).toMatchObject({ added: 1, removed: 1 });

    const diff = await g.compareFileDiff(d, main, "feature", "a.txt");
    expect(diff.lines.some((l) => l.op === "+" && l.text === "TWO")).toBe(true);
    expect(diff.lines.some((l) => l.op === "-" && l.text === "two")).toBe(true);

    // the same branch: nothing either way
    const same = await g.compare(d, main, main);
    expect([same.aheadCount, same.behindCount, same.files.length]).toEqual([0, 0, 0]);
    await expect(g.compare(d, main, "no-such-branch")).rejects.toThrow(
      /no branch, tag or commit called "no-such-branch"/,
    );
    await expect(g.compare(d, "--all", main)).rejects.toThrow(/can't start with "-"/);
  });

  test("what All branches adds: commits only on other branches, until they're merged", async () => {
    const d = await repo();
    expect(await g.elsewhere(d)).toEqual({ commits: 0, branches: 0 });
    const main = sh(d, "branch", "--show-current").trim();
    sh(d, "switch", "-c", "side");
    put(d, "b.txt", "b\n");
    sh(d, "add", "b.txt");
    sh(d, "commit", "-m", "on side");
    put(d, "c.txt", "c\n");
    sh(d, "add", "c.txt");
    sh(d, "commit", "-m", "on side again");
    sh(d, "switch", main);
    // from the main branch: two commits elsewhere, on one branch, and All branches shows them
    expect(await g.elsewhere(d)).toEqual({ commits: 2, branches: 1 });
    expect((await g.log(d, { all: true })).length).toBe((await g.log(d)).length + 2);
    // merged: the side branch is part of this one now, so the two lists are the same
    sh(d, "merge", "--no-edit", "side");
    expect(await g.elsewhere(d)).toEqual({ commits: 0, branches: 0 });
  });

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
    expect(
      st.files
        .filter((f) => f.staged)
        .map((f) => f.path)
        .sort(),
    ).toEqual(["a.txt", "new.txt"]);
    expect(st.lastCommit!.subject).toBe("first");
  });

  test("staging only some lines, including in a new file", async () => {
    const d = await repo();
    put(d, "a.txt", "zero\none\nTWO\nthree\nfour\n");
    const { lines } = await g.fileDiff(d, "a.txt", false);
    // pick only the edit of line two: the "-two" and "+TWO" lines
    const pick = lines
      .map((l, i) => ((l.op === "-" && l.text === "two") || (l.op === "+" && l.text === "TWO") ? i : -1))
      .filter((i) => i >= 0);
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
    const repos = {
      list: () => opened,
      add: (x: string) => void opened.push(x),
      remove: (x: string) => void opened.splice(opened.indexOf(x), 1),
    };
    const { e, s } = setup((p) => (p.target = path.join(d, "site")));
    write(s, "index.html", "<h1>hi</h1>");
    await runOnce(e);
    const api = new ApiServer([e], "", { repos });
    const call = (p: string, body?: unknown) =>
      api.handle(
        new Request(
          "http://127.0.0.1" + p,
          body === undefined ? undefined : { method: "POST", headers: { "X-Ferry": "1" }, body: JSON.stringify(body) },
        ),
      );

    const list = (await (await call("/git/repos")).json()) as {
      id: string;
      path: string;
      pairs: string[];
      standalone: boolean;
    }[];
    expect(list).toHaveLength(1); // the pair's target is inside the same repository
    expect(list[0]!.pairs).toEqual([e.name]);
    const id = list[0]!.id;
    const st = (await (await call(`/git/${id}/state`)).json()) as { files: { path: string }[] };
    expect(st.files.map((f) => f.path)).toEqual(["site/index.html"]);

    expect((await call(`/git/${id}/stage`, { files: ["site/index.html"] })).status).toBe(200);
    const c = (await (await call(`/git/${id}/commit`, { message: "add site" })).json()) as {
      commit: string;
      paused: string[];
    };
    expect(c.commit).toMatch(/^[0-9a-f]+$/);
    expect(c.paused).toEqual([]); // committing doesn't touch the files
    const sw = (await (await call(`/git/${id}/branch-create`, { name: "next", checkout: true })).json()) as {
      branch: string;
    };
    expect(sw.branch).toBe("next");
    const back = (await (await call(`/git/${id}/branch-switch`, { name: "main" })).json()) as { paused: string[] };
    expect(back.paused).toEqual([e.name]); // switching branches rewrites files: the pair is paused first
    await Bun.sleep(50);
    expect(e.getStatus().userPaused).toBe(true);

    const bad = await call(`/git/${id}/branch-switch`, { name: "--orphan" });
    expect(bad.status).toBe(409);
    expect(((await bad.json()) as { error: string }).error).toContain("can't start");
    expect((await call("/git/nope/state")).status).toBe(404);
    const noPost = await api.handle(
      new Request("http://127.0.0.1/git/" + id + "/stage", { method: "POST", body: "{}" }),
    );
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

describe("insights", () => {
  test("counts commits by day, weekday and hour, files by month, and streaks", async () => {
    const d = await repo(); // one commit today, by T
    const at = (daysAgo: number, hour: number) => {
      const t = new Date();
      t.setDate(t.getDate() - daysAgo);
      t.setHours(hour, 15, 0, 0);
      return t;
    };
    const commitAt = (when: Date, file: string, email = "t@example.com") => {
      put(d, file, `${file} ${when.getTime()}\n`);
      sh(d, "add", "-A");
      const iso = when.toISOString();
      Bun.spawnSync(["git", "-C", d, "commit", "-q", "-m", "work on " + file], {
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "X",
          GIT_AUTHOR_EMAIL: email,
          GIT_AUTHOR_DATE: iso,
          GIT_COMMITTER_NAME: "X",
          GIT_COMMITTER_EMAIL: email,
          GIT_COMMITTER_DATE: iso,
        },
      });
    };
    commitAt(at(1, 10), "b.txt");
    commitAt(at(2, 10), "b.txt");
    commitAt(at(10, 10), "c.txt", "sam@example.com");
    const all = await g.insights(d);
    expect(all.total).toBe(4);
    expect(all.activeDays).toBe(4);
    expect(all.streak).toBe(3); // today, yesterday, the day before
    expect(all.longestStreak).toBe(3);
    expect(all.files[0]).toMatchObject({ path: "b.txt", commits: 2 });
    expect(all.files[0]!.months.reduce((a, b) => a + b, 0)).toBe(2);
    expect(all.hours.flat().reduce((a, b) => a + b, 0)).toBe(4);
    expect(all.authors.map((a) => a.email)).toContain("sam@example.com");
    expect(all.hotspots.find((h) => h.path === "b.txt")).toMatchObject({ commits: 2, lines: 1, authors: 1 });

    // files that keep changing in the same commits
    for (let i = 0; i < 3; i++) {
      put(d, "x.ts", `x ${i}\n`);
      put(d, "x.test.ts", `t ${i}\n`);
      sh(d, "add", "-A");
      sh(d, "commit", "-q", "-m", "x " + i);
    }
    const pairs = (await g.insights(d)).together;
    expect(pairs[0]).toMatchObject({ a: "x.test.ts", b: "x.ts", count: 3, share: 1 });

    const mine = await g.insights(d, { author: "me" });
    expect(mine.total).toBe(6);
    expect(
      Object.values(mine.dayCommits)
        .flat()
        .every((c) => c.author !== "X" || c.subject !== "work on c.txt"),
    ).toBe(true);
  });

  test("browsing the work tree: tracked files and file contents", async () => {
    const d = await repo();
    put(d, "src/deep/x.ts", "x\n");
    fs.writeFileSync(path.join(d, "pic.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d]));
    await g.stage(d, []);
    await g.commit(d, "more");

    expect(await g.trackedFiles(d)).toEqual(["a.txt", "pic.png", "src/deep/x.ts"]);

    const f = await g.readFile(d, "a.txt");
    expect(f).toMatchObject({ path: "a.txt", text: "one\ntwo\nthree\n", binary: false, tooBig: false });
    expect((await g.readFile(d, "pic.png")).binary).toBe(true);
    await expect(g.readFile(d, "../outside.txt")).rejects.toThrow(/outside the repository/);
    await expect(g.readFile(d, "nope.txt")).rejects.toThrow(/isn't in the repository/);
    await expect(g.readFile(d, "src")).rejects.toThrow(/isn't in the repository/);

    const img = await g.rawImage(d, "pic.png");
    expect(img.type).toBe("image/png");
    expect(img.data.length).toBe(6);
    await expect(g.rawImage(d, "a.txt")).rejects.toThrow(/only images/);
    await expect(g.rawImage(d, "../secret.png")).rejects.toThrow(/outside the repository/);
  });
});
