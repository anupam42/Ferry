import { describe, expect, test } from "bun:test";
import {
  heatScale,
  hotspots,
  niceMax,
  rangeLabel,
  story,
  syncDays,
  ticks,
  weekly,
  yearCalendar,
  yearStart,
  ymd,
} from "../web/lib/insights.ts";
import type { InsightsResponse } from "../src/shared/git.ts";

const base = (o: Partial<InsightsResponse> = {}): InsightsResponse => ({
  today: "2026-11-10",
  days: {},
  dayCommits: {},
  hours: Array.from({ length: 7 }, () => Array(24).fill(0)),
  months: [],
  files: [],
  authors: [],
  hotspots: [],
  together: [],
  me: "",
  total: 0,
  added: 0,
  removed: 0,
  activeDays: 0,
  streak: 0,
  longestStreak: 0,
  partial: false,
  sync: null,
  ...o,
});

describe("heatScale", () => {
  test("zero is level 0, the biggest is level 4", () => {
    const s = heatScale([0, 1, 2, 3, 4, 5, 6, 7, 8, 50]);
    expect(s.level(0)).toBe(0);
    expect(s.level(50)).toBe(4);
    expect(s.level(1)).toBe(1);
  });
  test("all values the same: they all sit in the middle, not the palest", () => {
    const s = heatScale([1, 1, 1, 1]);
    expect(s.level(1)).toBe(3);
  });
  test("ranges describe each level for the legend", () => {
    const s = heatScale([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(s.ranges[0]).toEqual([0, 0]);
    expect(rangeLabel(s.ranges[0]!, "commit")).toBe("no commits");
    expect(rangeLabel([1, 1], "commit")).toBe("1 commit");
    expect(rangeLabel([3, 5], "commit")).toBe("3–5 commits");
  });
});

describe("niceMax", () => {
  test("rounds axes up to a friendly number", () => {
    expect(niceMax(3)).toEqual({ max: 3, step: 1 });
    expect(niceMax(7)).toEqual({ max: 8, step: 2 });
    expect(niceMax(130)).toEqual({ max: 150, step: 50 });
    expect(ticks(niceMax(7))).toEqual([0, 2, 4, 6, 8]);
  });
});

describe("the year", () => {
  test("starts on a Monday 52 weeks before this week's Monday", () => {
    const s = yearStart("2026-11-10"); // a Tuesday
    expect(s.getDay()).toBe(1);
    expect(ymd(s)).toBe("2025-11-10");
  });
  test("calendar has 53×7 cells, today counted, days after today marked future", () => {
    const d = base({ days: { "2026-11-10": 3, "2026-11-09": 1 } });
    const cal = yearCalendar(d, heatScale(Object.values(d.days)));
    expect(cal.cells.length).toBe(371);
    const today = cal.cells.find((c) => c.day === "2026-11-10")!;
    expect(today.n).toBe(3);
    expect(today.future).toBe(false);
    expect(cal.cells.find((c) => c.day === "2026-11-11")!.future).toBe(true);
    expect(cal.months.length).toBeGreaterThanOrEqual(11);
  });
  test("weekly sums each week and compares the last 4 weeks to the 4 before", () => {
    const days: Record<string, number> = {};
    const t = new Date("2026-11-10T12:00:00");
    for (let i = 0; i < 56; i++) {
      const x = new Date(t);
      x.setDate(t.getDate() - i);
      days[ymd(x)] = i < 28 ? 2 : 1;
    }
    const w = weekly(base({ days }));
    expect(w.weeks.length).toBe(53);
    expect(w.weeks.reduce((a, b) => a + b.n, 0)).toBe(28 * 2 + 28);
    expect(w.trend).toContain("busier");
  });
});

describe("story", () => {
  test("names the busiest day, the usual time, and the busiest file", () => {
    const hours = Array.from({ length: 7 }, () => Array(24).fill(0));
    hours[2]![15] = 9;
    const s = story(
      base({
        total: 10,
        activeDays: 2,
        days: { "2026-11-04": 7, "2026-11-05": 3 },
        hours,
        files: [{ path: "src/app.ts", commits: 6, added: 1, removed: 1, months: [] }],
      }),
      false,
    );
    expect(s.say).toBe("This project had 10 commits on 2 days this year.");
    expect(s.busiest).toBe("2026-11-04");
    expect(s.hint).toContain("Wednesdays");
    expect(s.hint).toContain("app.ts changes most (6 commits)");
    expect(story(base({ total: 1, activeDays: 1, days: { "2026-11-04": 1 } }), true).say).toBe(
      "You made 1 commit on 1 day this year.",
    );
  });
});

describe("hotspots", () => {
  test("drops empty files and ranks size × churn", () => {
    const h = hotspots(
      base({
        hotspots: [
          { path: "big-busy.ts", commits: 20, lines: 5000, authors: 3 },
          { path: "small-busy.ts", commits: 20, lines: 10, authors: 1 },
          { path: "big-quiet.ts", commits: 1, lines: 5000, authors: 1 },
          { path: "gone.ts", commits: 9, lines: 0, authors: 1 },
        ],
      }),
    );
    expect(h.pts.map((p) => p.path)).not.toContain("gone.ts");
    expect(h.top[0]!.path).toBe("big-busy.ts");
  });
});

describe("syncDays", () => {
  test("8 weeks, from when the record starts, with the day's commits", () => {
    const d = base({
      days: { "2026-11-09": 2 },
      sync: { pairs: ["site"], days: { "2026-11-09": 5, "2026-11-08": 3 }, since: "2026-11-01" },
    });
    const s = syncDays(d);
    expect(s[0]!.day).toBe("2026-11-01");
    expect(s[s.length - 1]!.day).toBe("2026-11-10");
    expect(s.find((x) => x.day === "2026-11-09")).toEqual({ day: "2026-11-09", files: 5, commits: 2 });
    expect(syncDays(base())).toEqual([]);
    expect(syncDays(base({ sync: { pairs: [], days: {}, since: "" } })).length).toBe(56);
  });
});
