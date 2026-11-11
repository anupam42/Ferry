// The new web app's change-story logic and Relay's moods (web/lib, plain TypeScript).
import { describe, expect, test } from "bun:test";

import { mapLayout, parseDiff, splitRows, story, wordDiff } from "../web/lib/diff.ts";
import { fileList, repoMood, whoPushed } from "../web/lib/gitmood.ts";
import { avatar, edgePath, graphLayout } from "../web/lib/graph.ts";
import { mood } from "../web/lib/mood.ts";
import type { Line, PairStatus } from "../web/lib/types.ts";

const L = (op: Line["op"], text: string): Line => ({ op, text });
const DIFF: Line[] = [
  L("@", "@@ -1,6 +1,7 @@"),
  L(" ", "<h1>Welcome</h1>"),
  L("-", "<p>Hello there</p>"),
  L("+", "<p>Hello there, friend</p>"),
  L(" ", "<ul>"),
  L(" ", "<li>one</li>"),
  L(" ", "<li>two</li>"),
  L("+", "<li>three</li>"),
  L(" ", "</ul>"),
];

describe("change story", () => {
  test("groups diff lines into changes with context and line numbers", () => {
    const p = parseDiff(DIFF);
    expect(p.changes.map((c) => c.kind)).toEqual(["edit", "add"]);
    expect(p.changes[0]!).toMatchObject({
      at: 2,
      removed: [{ oldNo: 2, text: "<p>Hello there</p>" }],
      added: [{ newNo: 2 }],
    });
    expect(p.changes[0]!.before.map((r) => r.text)).toEqual(["<h1>Welcome</h1>"]);
    expect(p.changes[1]!.added[0]!.newNo).toBe(6);
    expect(p.maxNo).toBe(7);
    expect(parseDiff([L("@", "binary file changed")]).notes).toEqual(["binary file changed"]);
  });

  test("word-level differences find exactly what was edited", () => {
    expect(wordDiff("Hello there", "Hello there, friend")).toEqual([
      { t: "Hello there", op: "" },
      { t: ", friend", op: "+" },
    ]);
    const w = wordDiff("color: red;", "color: blue;");
    expect(w.filter((x) => x.op === "-").map((x) => x.t)).toEqual(["red"]);
    expect(w.filter((x) => x.op === "+").map((x) => x.t)).toEqual(["blue"]);
  });

  test("says what changed in plain words", () => {
    const s = story(parseDiff(DIFF), "index.html");
    expect(s.title).toBe("I found 2 changes in index.html.");
    expect(s).toMatchObject({ added: 1, edited: 1, removed: 0 });
    expect(s.detail).toBe("You added 1 new line and edited 1 line.");
  });

  test("lays the changes out on the map, pins never overlapping", () => {
    const m = mapLayout(parseDiff(DIFF));
    expect(m.marks).toHaveLength(2);
    expect(m.marks[0]!.where).toBe("Line 2");
    expect(m.marks[0]!.kinds).toEqual(["edit"]);
    expect(m.marks[1]!.what).toBe("1 new");
    for (const mk of m.marks) expect(mk.left + mk.width).toBeLessThanOrEqual(100);
  });

  test("side by side pairs removed and added lines row by row", () => {
    const rows = splitRows(DIFF).filter((r) => r.kind === "row");
    const edited = rows.find((r) => r.kind === "row" && r.left.type === "del")!;
    expect(edited.kind === "row" && edited.right.type).toBe("add");
    expect(edited.kind === "row" && edited.start).toBe(true);
    const added = rows.find((r) => r.kind === "row" && r.right.text === "<li>three</li>")!;
    expect(added.kind === "row" && added.left.type).toBe("gap");
  });
});

describe("Relay's mood for a pair", () => {
  const base: PairStatus = {
    name: "web",
    source: "/a",
    target: "/b",
    mode: "one-way",
    watcher: true,
    user_paused: false,
    conflicts: [],
    pending_batch: 0,
    pending: false,
    comparing: null,
    last_sync: "0001-01-01T00:00:00Z",
    added: 0,
    updated: 0,
    deleted: 0,
    renamed: 0,
    skipped: 0,
    failed: 0,
    is_git: false,
    git_status: [],
    changed: [],
  };
  test("picks the most important thing to say", () => {
    expect(mood(base).tone).toBe("green");
    expect(mood({ ...base, comparing: { done: 3, total: 10 } })).toMatchObject({ face: "comparing", progress: 0.3 });
    expect(mood({ ...base, conflicts: ["a.txt"] })).toMatchObject({
      face: "worried",
      tone: "red",
      label: "1 conflict",
    });
    expect(mood({ ...base, user_paused: true }).face).toBe("sleepy");
    expect(mood(base, { at: Date.now(), msg: "disk full" })).toMatchObject({ face: "sad", hint: "disk full" });
    expect(mood(base, { at: Date.now() - 200_000, msg: "old" }).tone).toBe("green"); // old errors are forgotten
    expect(mood({ ...base, last_sync: new Date().toISOString() }).face).toBe("party");
  });
});

describe("Relay's mood for a repository", () => {
  const st = {
    root: "/r",
    branch: "main",
    head: "abc1234",
    detached: false,
    upstream: "origin/main",
    ahead: 0,
    behind: 0,
    operation: "" as const,
    operationBranch: "",
    bisecting: false,
    files: [],
    stashes: 0,
    remotes: ["origin"],
    lastCommit: null,
    name: "r",
    pairs: [],
    standalone: true,
  };
  const file = (p: string, more = {}) => ({
    path: p,
    x: ".",
    y: "M",
    staged: false,
    unstaged: true,
    untracked: false,
    conflicted: false,
    ...more,
  });
  test("says the most important thing first", () => {
    expect(repoMood(null, "no such folder")).toMatchObject({ face: "sad", hint: "no such folder" });
    expect(repoMood(st)).toMatchObject({ face: "happy", tone: "green" });
    expect(repoMood({ ...st, upstream: "" }).hint).toContain("push to publish");
    expect(repoMood({ ...st, head: "" }).face).toBe("excited");
    expect(repoMood({ ...st, ahead: 2 }).say).toBe("2 commits ready to push.");
    expect(repoMood({ ...st, behind: 1, files: [file("a")] }).say).toBe("There is 1 new commit on origin/main.");
    expect(repoMood({ ...st, files: [file("a", { staged: true }), file("b")] }).say).toBe(
      "2 files changed, 1 ready to commit.",
    );
    const merging = {
      ...st,
      operation: "merge" as const,
      operationBranch: "feature",
      files: [file("a", { conflicted: true })],
    };
    expect(repoMood(merging)).toMatchObject({
      face: "worried",
      tone: "red",
      say: "Merging feature into main: 1 file needs you.",
    });
    expect(repoMood({ ...merging, files: [] }).tone).toBe("amber");
  });
  test("names who pushed and which files, briefly", () => {
    expect(whoPushed([])).toBe("Someone");
    expect(whoPushed([{ author: "Sam" }, { author: "Sam" }, { author: "Ana" }])).toBe("Sam and Ana");
    expect(whoPushed([{ author: "A" }, { author: "B" }, { author: "C" }, { author: "D" }])).toBe("A, B and 2 more");
    expect(fileList(["src/a.ts", "b.ts", "c/d.ts", "e.ts"])).toBe("a.ts, b.ts, d.ts and 1 more");
  });
});

describe("the history graph", () => {
  // newest first: a merge (m) of a branch (b) back into main (a)
  //   m ─┬─ a2 ── a1
  //      └─ b1 ───┘
  const commits = [
    { hash: "m", parents: ["a2", "b1"] },
    { hash: "a2", parents: ["a1"] },
    { hash: "b1", parents: ["a1"] },
    { hash: "a1", parents: [] },
  ];
  test("keeps the main line in the first lane and forks the branch beside it", () => {
    const { rows, width } = graphLayout(commits, "m");
    expect(rows.map((r) => r.col)).toEqual([0, 0, 1, 0]);
    expect(width).toBe(2);
    // the merge sends a line down to each parent
    expect(
      rows[0]!.lines
        .filter((l) => l.half === "bottom")
        .map((l) => l.to)
        .sort(),
    ).toEqual([0, 1]);
    // the branch curves back into a1
    expect(rows[3]!.lines.some((l) => l.half === "top" && l.from === 1 && l.to === 0)).toBe(true);
    // the branch's lane has its own colour
    expect(rows[2]!.c).not.toBe(rows[1]!.c);
  });
  test("draws straight lines in a lane and curves between lanes", () => {
    expect(edgePath({ from: 0, to: 0, half: "all", c: 0 })).toBe("M10 0V44");
    expect(edgePath({ from: 1, to: 0, half: "top", c: 0 })).toMatch(/^M24 0C/);
  });
  test("gives each person a steady colour and initials", () => {
    expect(avatar("Anupam Udupi", "a@x").initials).toBe("AU");
    expect(avatar("Sam Lee", "s@x").initials).toBe("SL");
    expect(avatar("Ana", "ana@x").colour).toBe(avatar("Ana B", "ana@x").colour); // keyed by email
  });
});
