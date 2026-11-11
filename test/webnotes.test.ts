import { describe as group, expect, test } from "bun:test";
import { dayOf, describe, important, noteList } from "../web/lib/notes.ts";
import { cmpVersion, countdown, noticeKey, pickNotice, placeFor, relKey, whatsNew } from "../web/lib/releases.ts";
import type { Release } from "../src/shared/release.ts";

const ev = (kind: string, o: Record<string, unknown> = {}) => ({
  kind,
  pair: "site",
  time: "2026-11-10T10:00:00Z",
  ...o,
});

group("what an event means", () => {
  test("a held conflict needs you, and offers to resolve it in the pair's files", () => {
    const d = describe(ev("conflict", { held: true, path: "src/app.ts" }))!;
    expect(d.cat).toBe("needs");
    expect(d.title).toBe("app.ts changed in both folders");
    expect(d.action).toEqual({ label: "Resolve", pair: "site", view: "files" });
  });
  test("a possible secret needs you and opens the file's changes", () => {
    const d = describe(ev("warn", { path: "a/.env", message: "possible secret: AWS key — check before committing" }))!;
    expect(d.cat).toBe("needs");
    expect(d.detail).toBe("Check it before you commit. Found: AWS key.");
    expect(d.action).toEqual({ label: "See changes", diff: { pair: "site", file: "a/.env" } });
  });
  test("synced counts become words; failures are errors", () => {
    expect(describe(ev("synced", { message: "+2 ~1" }))).toMatchObject({
      cat: "sync",
      title: "Copied 3 files",
      detail: "2 added, 1 updated",
    });
    expect(describe(ev("synced", { message: "+1 !2" }))).toMatchObject({
      cat: "errors",
      title: "2 files couldn't be copied",
    });
  });
  test("commits, pushes and pull requests", () => {
    expect(describe(ev("commit", { message: "abc1234 Fix the header" }))!.title).toBe("Committed: Fix the header");
    expect(describe(ev("commit", { message: "pushed main" }))!.title).toBe("Pushed main");
    expect(describe(ev("commit", { message: "opened pull request https://x/pr/1" }))!.action).toEqual({
      label: "Open",
      url: "https://x/pr/1",
    });
  });
  test("noise is dropped, routine syncs aren't important", () => {
    expect(describe(ev("info", { message: "watching" }))).toBeNull();
    expect(describe(ev("add"))).toBeNull();
    expect(important(describe(ev("resumed", { message: "resumed" })))).toBe(false);
    expect(important(describe(ev("error", { message: "disk full" })))).toBe(true);
  });
});

group("the list", () => {
  const now = new Date("2026-11-10T12:00:00Z");
  const events = [
    ev("synced", { message: "+1", time: "2026-11-09T09:00:00Z" }),
    ev("error", { message: "disk full", time: "2026-11-10T09:00:00Z" }),
    ev("conflict", { held: true, path: "a.ts", time: "2026-11-08T09:00:00Z" }),
  ];
  test("needs you on top under All; routine syncs hidden unless asked", () => {
    const l = noteList(events, "all", false, now);
    expect(l.rows.map((r) => r.ev.kind)).toEqual(["conflict", "error"]);
    expect(l.rows[0]!.group).toBe("Needs you");
    expect(l.rows[1]!.group).toBe("Today");
    expect(l.counts).toEqual({ all: 2, needs: 1, errors: 1, commits: 0, sync: 1 });
    expect(noteList(events, "all", true, now).rows.length).toBe(3);
    expect(noteList(events, "sync", false, now).rows[0]!.group).toBe("Yesterday");
  });
  test("newest first, whatever order the events came in", () => {
    const l = noteList(
      [
        ev("error", { message: "b", time: "2026-11-10T11:00:00Z" }),
        ev("error", { message: "a", time: "2026-11-09T11:00:00Z" }),
        ev("error", { message: "c", time: "2026-11-10T11:30:00Z" }),
      ],
      "errors",
      false,
      now,
    );
    expect(l.rows.map((r) => r.ev.message)).toEqual(["c", "b", "a"]);
  });
  test("day headings", () => {
    expect(dayOf("2026-11-10T08:00:00Z", now)).toBe("Today");
    expect(dayOf("2026-11-09T08:00:00Z", now)).toBe("Yesterday");
  });
});

const R = (version: string, o: Partial<Release> = {}): Release => ({
  version,
  date: "2026-11-01",
  unreleased: false,
  planned: "",
  summary: "",
  groups: [],
  ...o,
});

group("releases", () => {
  test("versions compare by number, not text", () => {
    expect(cmpVersion("1.10.0", "1.9.3")).toBeGreaterThan(0);
    expect(cmpVersion("1.2.0", "1.2")).toBe(0);
    expect(cmpVersion("0.9", "1.0")).toBeLessThan(0);
  });
  test("an unreleased version's key changes as changes are added", () => {
    const r = R("1.3.0", { unreleased: true, groups: [{ kind: "new", items: [{ title: "a", text: "", try: "" }] }] });
    expect(relKey(r)).toBe("1.3.0+1");
    expect(relKey(R("1.2.0"))).toBe("1.2.0");
  });
  test("which notice: an update first, then a planned release, then what's being built, then a new version", () => {
    const now = Date.parse("2026-11-10T12:00:00Z");
    const o = { checkOn: false, last: null, seen: "1.2.0", now };
    expect(pickNotice([R("1.2.0")], "1.2.0", o)).toBeNull();
    expect(pickNotice([R("1.3.0")], "1.2.0", o)!.kind).toBe("new");
    expect(pickNotice([R("1.3.0", { unreleased: true })], "1.2.0", o)!.kind).toBe("soon");
    expect(pickNotice([R("1.3.0", { planned: "2026-11-20T10:00" })], "1.2.0", o)!.kind).toBe("countdown");
    expect(pickNotice([R("1.3.0", { planned: "2026-11-01T10:00" })], "1.2.0", o)!.kind).toBe("due");
    const last = { version: "1.4.0", name: "", url: "", date: "", notes: "", current: "1.2.0", newer: true };
    const n = pickNotice([R("1.3.0")], "1.2.0", { ...o, checkOn: true, last })!;
    expect(n).toEqual({ kind: "available", version: "1.4.0", current: "1.2.0" });
    expect(noticeKey(n)).toBe("available:1.4.0");
    // the update check is off: an earlier answer isn't shown
    expect(pickNotice([R("1.2.0")], "1.2.0", { ...o, last })).toBeNull();
  });
  test("countdown", () => {
    const ms = ((2 * 24 + 4) * 3600 + 12 * 60 + 8) * 1000;
    expect(countdown(ms)).toBe("2d 04h 12m 08s");
    expect(countdown(ms, true)).toBe("2d 4h");
    expect(countdown(90_000, true)).toBe("1m 30s");
    expect(countdown(-5)).toBe("00h 00m 00s");
  });
  test("What's new covers every release since the one you saw, headline first and not repeated", () => {
    const item = (title: string) => ({ title, text: "", try: "" });
    const all = [
      R("1.3.0", {
        groups: [
          { kind: "fixed", items: [item("fix b")] },
          { kind: "new", items: [item("feature a")] },
        ],
      }),
      R("1.2.0", { groups: [{ kind: "new", items: [item("old")] }] }),
      R("1.1.0"),
    ];
    const w = whatsNew(all, "1.1.0");
    expect(w.show.map((r) => r.version)).toEqual(["1.3.0", "1.2.0"]);
    expect(w.star!.title).toBe("feature a");
    expect(w.rest(all[0]!).map((g) => g.kind)).toEqual(["fixed"]);
    expect(w.counts).toEqual([
      ["new", 2],
      ["fixed", 1],
    ]);
    expect(whatsNew(all, "1.3.0").show.map((r) => r.version)).toEqual(["1.3.0"]);
    expect(whatsNew(all, "", "1.2.0").show.map((r) => r.version)).toEqual(["1.2.0"]);
  });
  test("Try it places", () => {
    expect(placeFor("git-undo")).toEqual({ mode: "git", view: "undo" });
    expect(placeFor("settings-updates")).toEqual({ mode: "settings", section: "updates" });
    expect(placeFor("pairs")).toEqual({ mode: "sync" });
    expect(placeFor("nowhere")).toBeNull();
  });
});
