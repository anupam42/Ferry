import { describe, expect, test } from "bun:test";
import { cutsFromGap, filesOf, groupsOf, span, suggestMessage } from "../web/lib/shape.ts";
import type { ShapeBatch } from "../src/shared/git.ts";

const b = (id: string, time: string, files: ShapeBatch["files"]): ShapeBatch => ({ id, pair: "site", time: `2026-11-10T${time}:00Z`, files });
const B = [
  b("1", "09:00", [{ path: "a.ts", op: "update" }]),
  b("2", "09:10", [{ path: "b.ts", op: "add" }]),
  b("3", "09:40", [{ path: "b.ts", op: "update" }, { path: "c.ts", op: "add" }]),
  b("4", "09:41", [{ path: "c.ts", op: "delete" }, { path: "d.ts", op: "delete" }]),
];

describe("shape my history", () => {
  test("a pause of the chosen length starts a new commit", () => {
    expect([...cutsFromGap(B, 15)]).toEqual([2]);
    expect([...cutsFromGap(B, 5)]).toEqual([1, 2]);
    expect(cutsFromGap(B, 0).size).toBe(0);
    expect(groupsOf(4, cutsFromGap(B, 15))).toEqual([[0, 1], [2, 3]]);
    expect(groupsOf(4, new Set())).toEqual([[0, 1, 2, 3]]);
    expect(groupsOf(0, new Set())).toEqual([]);
  });
  test("a group's overall effect on each file", () => {
    expect(filesOf(B, [1, 2])).toEqual([{ path: "b.ts", op: "add" }, { path: "c.ts", op: "add" }]);
    // added then deleted inside one commit: nothing to commit for it
    expect(filesOf(B, [2, 3])).toEqual([{ path: "b.ts", op: "update" }, { path: "d.ts", op: "delete" }]);
  });
  test("a first message from what changed, with the issue key in front", () => {
    expect(suggestMessage([{ path: "src/about.html", op: "add" }, { path: "index.html", op: "update" }])).toBe("Add about.html, update index.html");
    expect(suggestMessage([{ path: "a", op: "delete" }, { path: "b", op: "delete" }, { path: "c", op: "delete" }])).toBe("Remove a, b and 1 more");
    expect(suggestMessage([], "SHOP-42")).toBe("SHOP-42: Update files");
  });
  test("span reads naturally", () => {
    expect(span("2026-11-10T09:00:00Z", "2026-11-10T09:00:20Z")).toBe("a moment");
    expect(span("2026-11-10T09:00:00Z", "2026-11-10T09:12:00Z")).toBe("12 minutes");
    expect(span("2026-11-10T09:00:00Z", "2026-11-10T11:05:00Z")).toBe("2 h 5 min");
    expect(span("2026-11-10T09:00:00Z", "2026-11-10T11:00:00Z")).toBe("2 h");
  });
});
