// The Time tab's extras: idle time, focus sessions, goals, rates and invoices, editing entries,
// Jira worklogs, the weekly recap, time per task or branch, the calendar, and held notifications.
import { describe, expect, test } from "bun:test";

import { icsTime, maskCalendar, meetings, parseIcs } from "../src/calendar.ts";
import { jiraStarted } from "../src/integrations.ts";
import { holdNotifications, notifySettings } from "../src/notify.ts";
import {
  blocks,
  focusState,
  idleSince,
  invoice,
  invoiceCsv,
  timeFor,
  weeklyRecap,
  workDays,
  type TimerState,
  type WorkEvent,
} from "../src/shared/work.ts";
import {
  addEntry,
  editEntry,
  markJira,
  mergeEntries,
  readTimer,
  setCalendar,
  setGoals,
  setRate,
  splitEntry,
  startTimer,
  stopTimer,
} from "../src/timer.ts";
import { tempDir } from "./helpers.ts";

const MIN = 60_000;
const at = (hm: string, day = "2026-11-16") => new Date(`${day}T${hm}:00`).getTime();
const ev = (o: Partial<WorkEvent> & { t: number }): WorkEvent => ({
  kind: "sync",
  repo: "ferry",
  branch: "main",
  files: 1,
  paths: ["a.ts"],
  ...o,
});
const timer = (o: Partial<TimerState> = {}): TimerState => ({
  running: null,
  entries: [],
  billable: {},
  goals: { day: 0, week: 0 },
  rates: {},
  calendar: "",
  ...o,
});

describe("idle time and focus sessions", () => {
  const run = (o = {}) =>
    timer({ running: { start: at("09:00"), project: "ferry", task: "x", billable: false, ...o } });

  test("a timer whose saves stopped asks about the idle time, once", () => {
    const events = [ev({ t: at("09:10") }), ev({ t: at("09:30") }), ev({ t: at("09:50"), repo: "other" })];
    expect(idleSince(events, run(), at("09:45"))).toBeNull(); // 15 minutes: still fine
    expect(idleSince(events, run(), at("10:00"))).toEqual({ since: at("09:30"), minutes: 30 });
    // "keep it" answered at 10:00: asked again only after another idle stretch
    expect(idleSince(events, run({ idleOk: at("10:00") }), at("10:10"))).toBeNull();
    expect(idleSince(events, run({ idleOk: at("10:00") }), at("10:25"))).toEqual({ since: at("09:30"), minutes: 55 });
    // a timer for something you don't save in (a call) never asks
    expect(idleSince([], run(), at("12:00"))).toBeNull();
    expect(idleSince(events, timer(), at("12:00"))).toBeNull();
  });

  test("a focus session counts down and ends", () => {
    expect(focusState(run({ focus: 25 }), at("09:10"))).toEqual({ ends: at("09:25"), done: false, progress: 0.4 });
    expect(focusState(run({ focus: 25 }), at("09:40"))!.done).toBe(true);
    expect(focusState(run(), at("09:10"))).toBeNull();
  });

  test("stopping at a time drops idle time; focus is kept on the entry", () => {
    const dir = tempDir();
    startTimer(dir, { project: "ferry", focus: 25 }, at("09:00"));
    expect(() => startTimer(dir, { project: "ferry", focus: 2 }, at("09:01"))).toThrow("5 to 180");
    expect(readTimer(dir).running!.focus).toBe(25);
    editEntry(dir, "running", { idleOk: at("09:30") }, at("09:31"));
    expect(readTimer(dir).running!.idleOk).toBe(at("09:30"));
    expect(() => stopTimer(dir, at("08:00"), at("10:00"))).toThrow("between its start and now");
    const { entry } = stopTimer(dir, at("09:25"), at("10:00"));
    expect(entry).toMatchObject({ start: at("09:00"), end: at("09:25"), focus: 25 });
  });

  test("notifications wait during a focus session, then one sums them up", () => {
    holdNotifications(Date.now() + 60_000);
    expect(notifySettings.holdUntil).toBeGreaterThan(Date.now());
    holdNotifications(0);
    expect(notifySettings.holdUntil).toBe(0);
  });
});

describe("editing entries", () => {
  test("change times, add, pin, split and join", () => {
    const dir = tempDir(),
      now = at("18:00");
    const { entry: a } = addEntry(dir, { project: "ferry", task: "Review", start: at("09:00"), end: at("10:00") }, now);
    expect(a.from).toBe("added");
    expect(() => addEntry(dir, { project: "ferry", start: at("10:00"), end: at("09:00") }, now)).toThrow(
      "after it starts",
    );
    expect(() => addEntry(dir, { project: "ferry", start: at("17:00"), end: at("19:00") }, now)).toThrow("future");

    editEntry(dir, a.id, { start: at("09:15"), task: "Review PROJ-4" }, now);
    expect(readTimer(dir).entries[0]).toMatchObject({ start: at("09:15"), end: at("10:00"), task: "Review PROJ-4" });

    splitEntry(dir, a.id, at("09:45"));
    let es = readTimer(dir).entries;
    expect(es.map((e) => [e.start, e.end])).toEqual([
      [at("09:15"), at("09:45")],
      [at("09:45"), at("10:00")],
    ]);
    expect(() => splitEntry(dir, es[0]!.id, at("09:15"))).toThrow("a minute from either end");

    const { entry: b } = addEntry(
      dir,
      { project: "ferry", start: at("11:00"), end: at("11:30"), from: "meeting" },
      now,
    );
    expect(b.from).toBe("meeting");
    mergeEntries(dir, [es[0]!.id, es[1]!.id, b.id]);
    es = readTimer(dir).entries;
    expect(es).toHaveLength(1);
    expect(es[0]).toMatchObject({ start: at("09:15"), end: at("11:30"), task: "Review PROJ-4" });
    expect(() => mergeEntries(dir, [es[0]!.id])).toThrow("two entries");
  });

  test("a pinned block covers its span, so the automatic count steps aside there", () => {
    const events = [ev({ t: at("09:00") }), ev({ t: at("09:20") })];
    const t = timer({
      entries: [
        {
          id: "p",
          start: at("08:50"),
          end: at("09:30"),
          project: "ferry",
          task: "Pinned",
          billable: false,
          from: "auto",
        },
      ],
    });
    const bs = blocks(events, t, at("12:00"));
    expect(bs.map((b) => [b.kind, Math.round(b.minutes)])).toEqual([["timer", 40]]);
  });

  test("Jira: an entry is marked once sent, and a changed entry is no longer what Jira was told", () => {
    const dir = tempDir();
    const { entry } = addEntry(
      dir,
      { project: "ferry", task: "PROJ-4", start: at("09:00"), end: at("10:00") },
      at("12:00"),
    );
    markJira(dir, entry.id, { key: "PROJ-4", id: "10001" });
    expect(readTimer(dir).entries[0]!.jira).toMatchObject({ key: "PROJ-4", id: "10001" });
    editEntry(dir, entry.id, { end: at("10:30") }, at("12:00"));
    expect(readTimer(dir).entries[0]!.jira).toBeUndefined();
    expect(jiraStarted(new Date(2026, 10, 16, 9, 5, 7, 12).getTime())).toMatch(/^2026-11-16T09:05:07\.012[+-]\d{4}$/);
  });
});

describe("goals, rates and invoices", () => {
  test("goals and rates are kept and checked", () => {
    const dir = tempDir();
    expect(setGoals(dir, { day: 360, week: 1800 }).goals).toEqual({ day: 360, week: 1800 });
    expect(() => setGoals(dir, { day: 2000 })).toThrow("0 to 24 hours");
    const t = setRate(dir, "client-site", { rate: 80, currency: "eur", client: "Acme" });
    expect(t.rates["client-site"]).toEqual({ rate: 80, currency: "EUR", client: "Acme" });
    expect(t.billable["client-site"]).toBe(true); // charging for it makes it billable
    expect(() => setRate(dir, "x", { rate: 10, currency: "euro" })).toThrow("currency");
    expect(setRate(dir, "client-site", { rate: 0 }).rates).toEqual({});
    expect(() => setCalendar(dir, "file:///etc/passwd")).toThrow("https://");
    expect(setCalendar(dir, "webcal://example.com/cal.ics").calendar).toBe("webcal://example.com/cal.ics");
    expect(maskCalendar("https://calendar.google.com/calendar/ical/secret-token/basic.ics")).toBe(
      "calendar.google.com/…",
    );
  });

  test("an invoice prices billable hours per project, rounded to the quarter", () => {
    const t = timer({
      entries: [
        { id: "a", start: at("09:00"), end: at("10:10"), project: "site", task: "", billable: true },
        { id: "b", start: at("11:00"), end: at("11:30"), project: "site", task: "", billable: false },
        { id: "c", start: at("13:00"), end: at("14:00"), project: "app", task: "", billable: true },
        {
          id: "d",
          start: at("09:00", "2026-10-30"),
          end: at("10:00", "2026-10-30"),
          project: "site",
          task: "",
          billable: true,
        },
      ],
    });
    const days = workDays([], t, at("18:00"));
    const rates = {
      site: { rate: 100, currency: "USD", client: "Acme" },
      app: { rate: 50, currency: "EUR", client: "Beta" },
    };
    const inv = invoice(days, rates, { from: "2026-11-01", to: "2026-11-30", client: "" });
    expect(inv.rows).toEqual([
      { project: "site", minutes: 70, rate: 100, currency: "USD", amount: 125 }, // 1.25 h
      { project: "app", minutes: 60, rate: 50, currency: "EUR", amount: 50 },
    ]);
    expect(inv.totals).toEqual({ USD: 125, EUR: 50 });
    expect(
      invoice(days, rates, { from: "2026-11-01", to: "2026-11-30", client: "Beta" }).rows.map((r) => r.project),
    ).toEqual(["app"]);
    expect(invoiceCsv(inv).split("\n")[1]).toBe("site,1.25,100.00,USD,125.00");
  });
});

describe("recap and time per thing", () => {
  test("the weekly recap compares with the week before", () => {
    const t = timer({
      entries: [
        {
          id: "a",
          start: at("09:00", "2026-11-09"),
          end: at("12:00", "2026-11-09"),
          project: "app",
          task: "PROJ-1",
          billable: true,
        },
        {
          id: "b",
          start: at("09:00", "2026-11-11"),
          end: at("10:00", "2026-11-11"),
          project: "site",
          task: "",
          billable: false,
        },
        {
          id: "c",
          start: at("09:00", "2026-11-03"),
          end: at("11:00", "2026-11-03"),
          project: "app",
          task: "",
          billable: false,
        },
      ],
    });
    const r = weeklyRecap(workDays([], t, at("12:00")), "2026-11-09");
    expect(r).toMatchObject({
      minutes: 240,
      before: 120,
      billable: 180,
      worked: 2,
      best: { day: "2026-11-09", minutes: 180 },
    });
    expect(r.projects).toEqual([
      { name: "app", minutes: 180 },
      { name: "site", minutes: 60 },
    ]);
    expect(r.issues).toEqual([{ key: "PROJ-1", minutes: 180 }]);
  });

  test("time on a branch (a pull request's) and on a task (a todo item's)", () => {
    const events = [ev({ t: at("09:00"), branch: "feat/x" }), ev({ t: at("09:20"), branch: "feat/x" })];
    const t = timer({
      entries: [
        { id: "a", start: at("11:00"), end: at("11:45"), project: "ferry", task: "Write the docs", billable: false },
      ],
    });
    const bs = blocks(events, t, at("12:00"));
    expect(timeFor(bs, { repo: "ferry", branch: "feat/x" })).toBe(30);
    expect(timeFor(bs, { repo: "ferry", task: "write the docs" })).toBe(45);
    expect(timeFor(bs, { repo: "other", task: "write the docs" })).toBe(0);
  });
});

describe("calendar", () => {
  const ICS = [
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT",
    "UID:1",
    "DTSTART:20261116T090000Z",
    "DTEND:20261116T093000Z",
    "SUMMARY:Standup\\, daily",
    "RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4",
    "EXDATE:20261118T090000Z",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:2",
    "DTSTART;TZID=America/New_York:20261117T140000",
    "DURATION:PT1H",
    "SUMMARY:Design review",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:3",
    "DTSTART;VALUE=DATE:20261117",
    "SUMMARY:Holiday",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:4",
    "DTSTART:20261119T100000Z",
    "DTEND:20261119T110000Z",
    "STATUS:CANCELLED",
    "SUMMARY:Gone",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:5",
    "DTSTART:20261119T120000Z",
    "DTEND:20261119T130000Z",
    "TRANSP:TRANSPARENT",
    "SUMMARY:Focus time",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  test("meetings: recurring ones expanded, all-day, cancelled and free time left out", () => {
    const from = Date.UTC(2026, 10, 15),
      to = Date.UTC(2026, 11, 1);
    const ms = parseIcs(ICS, from, to);
    expect(ms.map((m) => [new Date(m.start).toISOString().slice(0, 16), (m.end - m.start) / MIN, m.title])).toEqual([
      ["2026-11-16T09:00", 30, "Standup, daily"],
      ["2026-11-17T19:00", 60, "Design review"], // 14:00 in New York, in winter (UTC-5)
      ["2026-11-23T09:00", 30, "Standup, daily"],
      ["2026-11-25T09:00", 30, "Standup, daily"],
    ]);
  });

  test("time zones keep a meeting at its wall-clock time across daylight saving", () => {
    // 09:00 in London: UTC in winter, UTC+1 in summer
    expect(new Date(icsTime("20260115T090000", "Europe/London")!).toISOString()).toBe("2026-01-15T09:00:00.000Z");
    expect(new Date(icsTime("20260715T090000", "Europe/London")!).toISOString()).toBe("2026-07-15T08:00:00.000Z");
    const weekly = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "DTSTART;TZID=Europe/London:20261019T090000",
      "DTEND;TZID=Europe/London:20261019T091500",
      "RRULE:FREQ=WEEKLY",
      "SUMMARY:Sync",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\n");
    const ms = parseIcs(weekly, Date.UTC(2026, 9, 18), Date.UTC(2026, 10, 3));
    // the clocks go back on 25 October: 08:00 UTC before, 09:00 UTC after
    expect(ms.map((m) => new Date(m.start).toISOString().slice(0, 16))).toEqual([
      "2026-10-19T08:00",
      "2026-10-26T09:00",
      "2026-11-02T09:00",
    ]);
  });

  test("reading an address: kept for a while, and errors say what went wrong", async () => {
    let calls = 0;
    const fake = (async () => {
      calls++;
      return new Response(ICS);
    }) as unknown as typeof fetch;
    const from = Date.UTC(2026, 10, 15),
      to = Date.UTC(2026, 10, 20);
    expect((await meetings("webcal://cal.test/a.ics", from, to, fake)).length).toBe(2);
    await meetings("webcal://cal.test/a.ics", from, to, fake);
    expect(calls).toBe(1);
    const notIcs = (async () => new Response("<html>")) as unknown as typeof fetch;
    await expect(meetings("https://cal.test/b.ics", from, to, notIcs)).rejects.toThrow("doesn't give a calendar");
    const missing = (async () => new Response("", { status: 404 })) as unknown as typeof fetch;
    await expect(meetings("https://cal.test/c.ics", from, to, missing)).rejects.toThrow("check the address");
  });
});
