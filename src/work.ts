// What the standup and timesheet are built from (see shared/work.ts): the work log of every
// pair's syncs, the pairs' own history from before the work log existed, and your commits in
// every repository Ferry knows about.
import path from "node:path";

import { history } from "./engine/journal.ts";
import { readWork } from "./engine/worklog.ts";
import { dayOf, type WorkEvent, type WorkResponse } from "./shared/work.ts";

export type { WorkEvent, WorkResponse } from "./shared/work.ts";

/** What work.ts needs to know about a running pair. */
export interface WorkPair {
  name: string;
  id: string;
  dataDir: string;
  target: string;
  /** remote or cloud: there's no repository on this machine */
  remote: boolean;
}

/** At most this many days back. */
export const MAX_WORK_DAYS = 120;

/**
 * Every sync and commit since `since` (ms). `repos` are the repositories' top folders (real
 * paths); `real` turns a folder into its real path so a pair's target can be matched to one.
 */
export async function workEvents(o: {
  pairs: WorkPair[];
  /** more data folders to read the work log from (Ferry's own, so pairs that aren't running still count) */
  dataDirs?: string[];
  repos: string[];
  since: number;
  real: (p: string) => string;
}): Promise<Omit<WorkResponse, "timer" | "meetings" | "calendarError">> {
  const events: WorkEvent[] = [];
  const nameOf = (target: string, pair: string) => {
    const t = o.real(target);
    const root = o.repos.filter((r) => t === r || t.startsWith(r + path.sep)).sort((a, b) => b.length - a.length)[0];
    return root ? path.basename(root) : pair;
  };

  // the work log, and before it began, each pair's own history (without branches)
  const dirs = [...new Set([...(o.dataDirs ?? []), ...o.pairs.map((p) => p.dataDir)].map((d) => o.real(d)))];
  let since = "";
  const logged = new Map<string, number>(); // pair id -> its oldest work log entry
  for (const dir of dirs) {
    for (const r of readWork(dir, o.since)) {
      const t = Date.parse(r.time);
      if (!logged.has(r.pair_id) || t < logged.get(r.pair_id)!) logged.set(r.pair_id, t);
      events.push({
        t,
        kind: "sync",
        repo: nameOf(r.target, r.pair),
        branch: r.branch,
        files: r.files,
        paths: r.paths,
      });
    }
  }
  for (const p of o.pairs) {
    const until = logged.get(p.id) ?? Infinity;
    for (const b of history(p.dataDir, p.id)) {
      const t = Date.parse(b.time);
      if (t < o.since || t >= until || b.undone) continue;
      const written = b.entries.filter((en) => en.side === "target");
      if (!written.length) continue;
      events.push({
        t,
        kind: "sync",
        repo: p.remote ? p.name : nameOf(p.target, p.name),
        branch: "",
        files: written.length,
        paths: [...new Set(written.map((en) => en.to ?? en.path))].slice(0, 5),
      });
    }
  }

  // your commits, on whichever branch git reached them from
  const commits = await Promise.all(o.repos.map((r) => myCommits(r, o.since)));
  for (const c of commits) events.push(...c);

  events.sort((a, b) => a.t - b.t);
  if (events.length) since = dayOf(events[0]!.t);
  return { events, since };
}

const run = async (args: string[]) => {
  const p = Bun.spawn(args, { stdout: "pipe", stderr: "ignore", env: { ...process.env, LC_ALL: "C" } });
  const out = await new Response(p.stdout).text();
  return (await p.exited) === 0 ? out : "";
};

/** Commits by this repository's user.email since `since` (ms), with a few of the files each changed. */
async function myCommits(root: string, since: number): Promise<WorkEvent[]> {
  const email = (await run(["git", "-C", root, "config", "user.email"])).trim();
  if (!email) return [];
  const out = await run([
    "git",
    "-C",
    root,
    "log",
    "--all",
    "--no-merges",
    "--source",
    `--author=<${email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}>`,
    "-i",
    `--since=@${Math.floor(since / 1000)}`,
    "--format=%x1e%at%x1f%S%x1f%s",
    "--name-only",
    "-n2000",
  ]);
  const repo = path.basename(root);
  const events: WorkEvent[] = [];
  for (const rec of out.split("\x1e")) {
    const [head, ...files] = rec.split("\n");
    const f = head?.split("\x1f");
    if (!f || f.length < 3) continue;
    events.push({
      t: +f[0]! * 1000,
      kind: "commit",
      repo,
      branch: f[1]!.replace(/^refs\/(heads|remotes\/[^/]+|tags)\//, ""),
      files: 0,
      paths: files.filter(Boolean).slice(0, 5),
      subject: f.slice(2).join("\x1f"),
    });
  }
  return events;
}
