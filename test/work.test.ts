// Standup and timesheet: time from saves and commits, the work log, and reading your commits.
import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

import { appendWork, headBranch, readWork } from "../src/engine/worklog.ts";
import {
  attribute,
  duration,
  issueKey,
  lineName,
  standupText,
  timesheet,
  timesheetCsv,
  weekStart,
  workDays,
  type WorkEvent,
} from "../src/shared/work.ts";
import { workEvents } from "../src/work.ts";
import { tempDir } from "./helpers.ts";

const MIN = 60_000;
/** ms for a local time on a day */
const at = (day: string, hm: string) => new Date(`${day}T${hm}:00`).getTime();
const ev = (o: Partial<WorkEvent> & { t: number }): WorkEvent => ({
  kind: "sync",
  repo: "ferry",
  branch: "main",
  files: 1,
  paths: ["src/a.ts"],
  ...o,
});

describe("work", () => {
  test("time between saves counts; a long gap starts a new sitting with a lead-in", () => {
    const t0 = at("2026-11-13", "09:00");
    const events = [
      ev({ t: t0 }), // starts a sitting: 10 min lead-in
      ev({ t: t0 + 12 * MIN }), // 12
      ev({ t: t0 + 30 * MIN }), // 18
      ev({ t: t0 + 120 * MIN, kind: "commit" }), // a new sitting that starts with a commit: 30
    ];
    expect(attribute(events)).toEqual([10, 12, 18, 30]);
  });

  test("days, lines per branch, issue keys from branches and commits", () => {
    const d = "2026-11-13";
    const days = workDays([
      ev({ t: at(d, "09:00"), branch: "feature/PROJ-12-login", paths: ["src/login.ts"] }),
      ev({ t: at(d, "09:20"), branch: "feature/PROJ-12-login", paths: ["src/login.ts", "src/api.ts"] }),
      ev({ t: at(d, "09:30"), kind: "commit", branch: "feature/PROJ-12-login", subject: "Log in with SSO", paths: [] }),
      // switching to docs: the 15 minutes go to docs
      ev({ t: at(d, "09:45"), repo: "site", branch: "main", paths: ["docs/x.md"] }),
      ev({ t: at(d, "10:00"), kind: "commit", repo: "site", branch: "main", subject: "OPS-7 fix the docs", paths: [] }),
      ev({ t: at("2026-11-16", "08:00") }),
    ]);
    expect(days.map((x) => [x.day, x.minutes])).toEqual([
      ["2026-11-16", 10],
      ["2026-11-13", 70],
    ]);
    const [login, docs] = days[1]!.lines;
    expect(login).toMatchObject({ repo: "ferry", issue: "PROJ-12", minutes: 40, commits: ["Log in with SSO"] });
    expect(login!.files[0]).toBe("src/login.ts");
    expect(docs).toMatchObject({ repo: "site", issue: "OPS-7", minutes: 30 });
    expect(lineName(login!)).toBe("feature/PROJ-12-login (ferry)");
    expect(lineName(docs!)).toBe("OPS-7 (site)");
  });

  test("issue keys, durations and weeks", () => {
    expect(issueKey("feature/proj-12-login")).toBe("PROJ-12");
    expect(issueKey("main")).toBe("");
    expect(issueKey("fix/utf-8-names")).toBe("");
    expect(issueKey("sha-256 ids for OPS-9")).toBe("OPS-9");
    expect(duration(0.4)).toBe("under a minute");
    expect(duration(42)).toBe("42 m");
    expect(duration(131)).toBe("2 h 10 m");
    expect(duration(119)).toBe("2 h");
    expect(weekStart("2026-11-16")).toBe("2026-11-16"); // a Monday
    expect(weekStart("2026-11-22")).toBe("2026-11-16"); // the Sunday after
  });

  test("syncs without a branch take the nearest one; main and master are one line", () => {
    const d = "2026-11-13";
    const days = workDays([
      ev({ t: at(d, "09:00"), branch: "" }), // before anything known: takes the one after
      ev({ t: at(d, "09:10"), branch: "feat" }),
      ev({ t: at(d, "09:20"), branch: "" }), // takes the one before
      ev({ t: at(d, "11:00"), branch: "master" }),
      ev({ t: at(d, "11:10"), branch: "main" }),
      ev({ t: at(d, "11:15"), repo: "other", branch: "" }), // no branch anywhere in its repository
    ]);
    expect(days[0]!.lines.map((l) => [lineName(l), l.minutes])).toEqual([
      ["feat (ferry)", 30],
      ["ferry", 20],
      ["other", 5],
    ]);
  });

  test("the standup says the last day worked and today; the timesheet sums a week", () => {
    const days = workDays([
      ev({ t: at("2026-11-13", "09:00"), kind: "commit", subject: "Ship it" }),
      ev({ t: at("2026-11-16", "09:00") }),
      ev({ t: at("2026-11-16", "09:20") }),
    ]);
    const text = standupText(days, "2026-11-16");
    expect(text).toContain("Last time (");
    expect(text).toContain('- ferry, 30 m: "Ship it"');
    expect(text).toContain("Today so far, 30 m\n- ferry, 30 m: worked on a.ts");
    expect(standupText([], "2026-11-16")).toBe("No work recorded yet.");

    const sheet = timesheet(days, "2026-11-16");
    expect(sheet.rows).toEqual([{ name: "ferry", minutes: [30, 0, 0, 0, 0, 0, 0], total: 30, billable: 0 }]);
    expect(timesheetCsv(sheet).split("\n")[1]).toBe("ferry,0.50,0.00,0.00,0.00,0.00,0.00,0.00,0.50,0.00");
    expect(timesheet(days, "2026-11-09").rows[0]!.minutes[4]).toBe(30); // Friday the 13th
  });

  test("the work log keeps records and reads them since a time", () => {
    const dir = tempDir();
    const r = { pair: "p", pair_id: "id1", target: "/t", branch: "main", files: 2, paths: ["a"] };
    const day = 86_400_000,
      now = Date.now();
    const older = new Date(now - 30 * day).toISOString(),
      newer = new Date(now - day).toISOString();
    appendWork(dir, { ...r, time: older });
    appendWork(dir, { ...r, time: newer });
    expect(readWork(dir).length).toBe(2);
    expect(readWork(dir, now - 7 * day).map((x) => x.time)).toEqual([newer]);
    expect(readWork(path.join(dir, "none"))).toEqual([]);
  });

  test("the branch comes straight from HEAD: in a subfolder, detached, and in a worktree", () => {
    const d = path.join(tempDir(), "r");
    fs.mkdirSync(path.join(d, "sub"), { recursive: true });
    const git = (...a: string[]) =>
      Bun.spawnSync(["git", "-C", d, ...a], {
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "T",
          GIT_AUTHOR_EMAIL: "t@e",
          GIT_COMMITTER_NAME: "T",
          GIT_COMMITTER_EMAIL: "t@e",
        },
      });
    git("init", "-q", "-b", "main");
    expect(headBranch(path.join(d, "sub"))).toBe("main");
    fs.writeFileSync(path.join(d, "a"), "1");
    git("add", ".");
    git("commit", "-qm", "one");
    git("checkout", "-q", "-b", "feature/PROJ-3");
    expect(headBranch(d)).toBe("feature/PROJ-3");
    const wt = path.join(path.dirname(d), "wt");
    git("worktree", "add", "-q", "-b", "other", wt);
    expect(headBranch(wt)).toBe("other");
    git("checkout", "-q", "--detach");
    expect(headBranch(d)).toBe("");
    expect(headBranch(path.parse(d).root)).toBe("");
  });

  test("events: the work log, older pair history without it, and only your own commits", async () => {
    const data = tempDir();
    const d = path.join(tempDir(), "Repo");
    fs.mkdirSync(d);
    const git = (env: Record<string, string>, ...a: string[]) =>
      Bun.spawnSync(["git", "-C", d, ...a], { env: { ...process.env, ...env } });
    const me = {
      GIT_AUTHOR_NAME: "Me",
      GIT_AUTHOR_EMAIL: "me@x.io",
      GIT_COMMITTER_NAME: "Me",
      GIT_COMMITTER_EMAIL: "me@x.io",
    };
    const them = { ...me, GIT_AUTHOR_NAME: "Them", GIT_AUTHOR_EMAIL: "them@x.io" };
    git({}, "init", "-q", "-b", "main");
    git({}, "config", "user.email", "me@x.io");
    fs.writeFileSync(path.join(d, "a.txt"), "1");
    git(me, "add", ".");
    git(me, "commit", "-qm", "PROJ-1 mine");
    fs.writeFileSync(path.join(d, "a.txt"), "2");
    git(them, "commit", "-qam", "theirs");

    const now = Date.now();
    // the pair's own history (an older sync) and the work log (a newer one)
    fs.mkdirSync(path.join(data, "id1"), { recursive: true });
    const batch = (t: number) =>
      JSON.stringify({
        id: String(t),
        time: new Date(t).toISOString(),
        pair: "p",
        pair_id: "id1",
        source: "/s",
        target: d,
        entries: [{ op: "update", side: "target", path: "a.txt" }],
      });
    fs.writeFileSync(
      path.join(data, "id1", "history.jsonl"),
      batch(now - 3 * 3600_000) + "\n" + batch(now - 600_000) + "\n",
    );
    appendWork(data, {
      time: new Date(now - 600_000).toISOString(),
      pair: "p",
      pair_id: "id1",
      target: d,
      branch: "main",
      files: 1,
      paths: ["a.txt"],
    });

    const real = (p: string) => fs.realpathSync.native(p);
    const r = await workEvents({
      pairs: [{ name: "p", id: "id1", dataDir: data, target: d, remote: false }],
      repos: [real(d)],
      since: now - 86_400_000,
      real,
    });
    const syncs = r.events.filter((e) => e.kind === "sync");
    // the older sync from history (no branch), the newer one only once, from the work log
    expect(syncs.map((e) => [e.repo, e.branch])).toEqual([
      ["Repo", ""],
      ["Repo", "main"],
    ]);
    const commits = r.events.filter((e) => e.kind === "commit");
    expect(commits.map((c) => [c.subject, c.branch, c.paths])).toEqual([["PROJ-1 mine", "main", ["a.txt"]]]);
  });
});
