// The Time tab's timer, and how timed work and Ferry's own count fit together.
import { describe, expect, test } from "bun:test";

import { deleteEntry, editEntry, readTimer, setBillable, startTimer, stopTimer } from "../src/timer.ts";
import {
  blocks,
  blockTitle,
  byProject,
  clock,
  lastDays,
  suggestTimer,
  workDays,
  type TimerState,
  type WorkEvent,
} from "../src/shared/work.ts";
import { tempDir } from "./helpers.ts";

const MIN = 60_000;
const at = (hm: string) => new Date(`2026-11-16T${hm}:00`).getTime();
const ev = (o: Partial<WorkEvent> & { t: number }): WorkEvent => ({
  kind: "sync",
  repo: "ferry",
  branch: "main",
  files: 1,
  paths: ["src/a.ts"],
  ...o,
});
const timer = (o: Partial<TimerState> = {}): TimerState => ({ running: null, entries: [], billable: {}, ...o });

describe("timer", () => {
  test("start, stop, edit, delete and billable projects, kept in the data folder", () => {
    const dir = tempDir();
    expect(readTimer(dir)).toEqual({ running: null, entries: [], billable: {} });
    expect(() => startTimer(dir, {})).toThrow("which project");

    setBillable(dir, "client-site", true);
    let t = startTimer(dir, { project: "client-site", task: " Fix\nthe header " }, at("09:00"));
    expect(t.running).toEqual({ start: at("09:00"), project: "client-site", task: "Fix the header", billable: true });

    // starting another stops the first, and it becomes an entry
    t = startTimer(dir, { project: "ferry", task: "docs", billable: false }, at("09:40"));
    expect(t.entries.map((e) => [e.project, e.start, e.end, e.billable])).toEqual([
      ["client-site", at("09:00"), at("09:40"), true],
    ]);
    const { entry } = stopTimer(dir, at("10:00"));
    expect(entry).toMatchObject({ project: "ferry", task: "docs", start: at("09:40"), end: at("10:00") });
    expect(() => stopTimer(dir)).toThrow("no timer is running");

    // under a minute isn't worth an entry
    startTimer(dir, { project: "ferry" }, at("11:00"));
    expect(stopTimer(dir, at("11:00") + 30_000).entry).toBeNull();

    const id = readTimer(dir).entries[0]!.id;
    expect(editEntry(dir, id, { task: "Header", billable: false }).entries[0]).toMatchObject({
      task: "Header",
      billable: false,
    });
    expect(deleteEntry(dir, id).entries.length).toBe(1);
    expect(() => deleteEntry(dir, id)).toThrow("isn't there");
    expect(setBillable(dir, "client-site", false).billable).toEqual({});
  });

  test("a timer can start from when a sitting began, but not in the future or days ago", () => {
    const dir = tempDir(),
      now = at("12:00");
    expect(startTimer(dir, { project: "p", start: now - 40 * MIN }, now).running!.start).toBe(now - 40 * MIN);
    expect(() => startTimer(dir, { project: "p", start: now + MIN }, now)).toThrow("up to a day ago");
    expect(() => startTimer(dir, { project: "p", start: now - 2 * 86_400_000 }, now)).toThrow("up to a day ago");
  });
});

describe("time blocks", () => {
  test("saves become blocks per thing worked on; a timer wins where it ran", () => {
    const events = [
      ev({ t: at("09:00") }), // 10 min lead-in: 08:50
      ev({ t: at("09:15") }),
      ev({ t: at("09:20"), kind: "commit", subject: "Fix login", paths: [] }),
      // inside the timer: left out
      ev({ t: at("10:10") }),
      // after the timer, 5 minutes on: a fresh sitting whose lead-in stops at the timer's end
      ev({ t: at("10:35") }),
      ev({ t: at("10:45"), repo: "site", branch: "feature/OPS-2" }),
    ];
    const t = timer({
      entries: [
        { id: "a", start: at("10:00"), end: at("10:30"), project: "client", task: "Call OPS-9", billable: true },
      ],
      billable: { site: true },
    });
    const bs = blocks(events, t, at("12:00"));
    expect(
      bs.map((b) => [b.kind, b.repo, Math.round(b.minutes), new Date(b.start).toISOString().slice(11, 16)]),
    ).toEqual([
      ["auto", "ferry", 30, new Date(at("08:50")).toISOString().slice(11, 16)],
      ["timer", "client", 30, new Date(at("10:00")).toISOString().slice(11, 16)],
      ["auto", "ferry", 5, new Date(at("10:30")).toISOString().slice(11, 16)],
      ["auto", "site", 10, new Date(at("10:35")).toISOString().slice(11, 16)],
    ]);
    expect(blockTitle(bs[0]!)).toBe("Fix login");
    expect(bs[1]).toMatchObject({ task: "Call OPS-9", issue: "OPS-9", billable: true });
    expect(bs[3]).toMatchObject({ issue: "OPS-2", billable: true }); // billable by project
    expect(blockTitle(bs[3]!)).toBe("feature/OPS-2");

    const [d] = workDays(events, t, at("12:00"));
    expect(d!.minutes).toBe(75);
    expect(d!.billable).toBe(40);
    expect(d!.lines.find((l) => l.task)).toMatchObject({ repo: "client", task: "Call OPS-9", minutes: 30 });
  });

  test("the running timer counts up to now", () => {
    const t = timer({ running: { start: at("09:00"), project: "p", task: "", billable: false } });
    const [b] = blocks([], t, at("09:45"));
    expect(b).toMatchObject({ id: "running", minutes: 45, kind: "timer" });
    expect(clock(45 * MIN + 9_000)).toBe("00:45:09");
  });

  test("Ferry offers a timer from when the current sitting began, once it's long enough", () => {
    const events = [ev({ t: at("09:00") }), ev({ t: at("09:20") })];
    expect(suggestTimer(events, timer(), at("09:25"))).toEqual({
      since: at("08:50"),
      repo: "ferry",
      minutes: 35,
    });
    expect(suggestTimer(events, timer(), at("10:30"))).toBeNull(); // the sitting is over
    expect(suggestTimer([ev({ t: at("09:00") })], timer(), at("09:02"))).toBeNull(); // too short yet
    const running = timer({ running: { start: at("09:10"), project: "p", task: "", billable: false } });
    expect(suggestTimer(events, running, at("09:25"))).toBeNull();
  });

  test("minutes per project per day, for the chart", () => {
    const days = workDays([ev({ t: at("09:00") }), ev({ t: at("09:20"), repo: "site" })], timer(), at("12:00"));
    const r = byProject(days, lastDays("2026-11-16", 3));
    expect(r.days.map((d) => d.day)).toEqual(["2026-11-14", "2026-11-15", "2026-11-16"]);
    expect(r.days[2]!.minutes).toEqual({ ferry: 10, site: 20 });
    expect(r.projects).toEqual([
      { name: "site", minutes: 20 },
      { name: "ferry", minutes: 10 },
    ]);
  });
});
