// ferry timer: the Time tab's timer from any terminal (and from editors, which run it with --json).
//   ferry timer                       what's running
//   ferry timer start [task] [--project P] [--billable] [--focus 25]
//   ferry timer stop
//   ferry timer today                 today's time, from saves, commits and timers
import path from "node:path";

import { dataDir } from "../config.ts";
import { readWork } from "../engine/worklog.ts";
import { exec } from "../proc.ts";
import { clock, dayOf, duration, lineName, workDays, type WorkEvent } from "../shared/work.ts";
import { readTimer, startTimer, stopTimer, TimerError } from "../timer.ts";
import { ExitError } from "../util.ts";
import { paint, println } from "./common.ts";
import { FlagError, FlagSet, HelpRequested } from "./flags.ts";

/** The project for a timer started here: the repository this folder is in, or the folder's name. */
async function here(): Promise<string> {
  const r = await exec(["git", "rev-parse", "--show-toplevel"]).catch(() => null);
  const top = r && r.code === 0 ? r.output.trim() : "";
  return path.basename(top || process.cwd());
}

/** The timer as editors read it (ferry timer --json). */
function statusJSON(): Record<string, unknown> {
  const t = readTimer(dataDir());
  const r = t.running;
  return r
    ? {
        running: true,
        project: r.project,
        task: r.task,
        billable: r.billable,
        start: new Date(r.start).toISOString(),
        elapsed_seconds: Math.round((Date.now() - r.start) / 1000),
        ...(r.focus
          ? { focus_minutes: r.focus, focus_left_seconds: Math.round((r.start + r.focus * 60_000 - Date.now()) / 1000) }
          : {}),
      }
    : { running: false };
}

export async function cmdTimer(args: string[]): Promise<void> {
  const f = new FlagSet("timer")
    .string("project", "", "the project (default: this repository's name)")
    .bool("billable", false, "count it as billable")
    .int("focus", 0, "a focus session of this many minutes")
    .bool("json", false, "print JSON");
  f.usage = () =>
    println(`Usage:
  ferry timer [--json]                       what's running
  ferry timer start [task] [--project P] [--billable] [--focus 25]
  ferry timer stop [--json]
  ferry timer today [--json]                 today's time, from saves, commits and timers`);
  let rest: string[];
  try {
    rest = f.parse(args);
  } catch (e) {
    if (e instanceof HelpRequested) return;
    if (e instanceof FlagError) throw new ExitError(2);
    throw e;
  }
  const [sub = "status", ...words] = rest;
  const dir = dataDir();
  const json = f.getBool("json");
  try {
    switch (sub) {
      case "status": {
        const s = statusJSON();
        if (json) return println(JSON.stringify(s));
        if (!s.running) return println('no timer is running · ferry timer start "what you\'re doing"');
        const r = readTimer(dir).running!;
        println(
          `${paint("32", "●")} ${paint("1", clock(Date.now() - r.start))}  ${r.task || "no task"} ${paint("2", `(${r.project}${r.billable ? ", billable" : ""})`)}`,
        );
        return;
      }
      case "start": {
        const project = f.getString("project") || (await here());
        const t = startTimer(dir, {
          project,
          task: words.join(" "),
          ...(f.getBool("billable") ? { billable: true } : {}),
          ...(f.getInt("focus") ? { focus: f.getInt("focus") } : {}),
        });
        if (json) return println(JSON.stringify(statusJSON()));
        const r = t.running!;
        println(
          `${paint("32", "▶")} timing ${r.task ? `"${r.task}" ` : ""}on ${paint("1", r.project)}${r.focus ? ` · focus for ${r.focus} min` : ""}`,
        );
        return;
      }
      case "stop": {
        const { entry } = stopTimer(dir);
        if (json) return println(JSON.stringify({ running: false, entry }));
        println(
          entry
            ? `${paint("31", "■")} stopped: ${duration((entry.end - entry.start) / 60_000)} on ${entry.task || entry.project}`
            : "stopped (under a minute, so nothing was kept)",
        );
        return;
      }
      case "today": {
        // the work log of every pair, and this process's view of timers (commits need the web app's repositories)
        const events: WorkEvent[] = readWork(dir, Date.now() - 86_400_000).map((r) => ({
          t: Date.parse(r.time),
          kind: "sync",
          repo: r.pair,
          branch: r.branch,
          files: r.files,
          paths: r.paths,
        }));
        const day = workDays(events, readTimer(dir)).find((d) => d.day === dayOf(Date.now()));
        if (json) return println(JSON.stringify(day ?? { minutes: 0, lines: [] }));
        if (!day) return println("nothing counted today yet");
        println(
          paint("1", `Today, ${duration(day.minutes)}`) +
            (day.billable ? paint("2", ` (${duration(day.billable)} billable)`) : ""),
        );
        for (const l of day.lines) println(`  ${lineName(l)}  ${paint("2", duration(l.minutes))}`);
        return;
      }
      default:
        throw new TimerError(`no "ferry timer ${sub}": try start, stop or today`);
    }
  } catch (e) {
    if (e instanceof TimerError) {
      process.stderr.write(paint("31", "error: ") + e.message + "\n");
      throw new ExitError(1);
    }
    throw e;
  }
}
