// Shape my history, the plain part (unit-tested): where a pause starts a new
// commit, what each group did to its files overall, and a first message for it.
import type { ShapeBatch } from "../../src/shared/git.ts";
import { plural } from "./format.ts";

export type Op = "add" | "update" | "delete";

/** Pauses that start a new commit, in minutes; 0 keeps everything in one. */
export const GAPS: [number, string][] = [
  [5, "5 min"],
  [15, "15 min"],
  [30, "30 min"],
  [60, "1 hour"],
  [0, "Never (one commit)"],
];

/** The batch indexes where a new commit starts: after every pause of gap minutes or more. */
export function cutsFromGap(batches: Pick<ShapeBatch, "time">[], gap: number): Set<number> {
  const cuts = new Set<number>();
  if (gap)
    for (let i = 1; i < batches.length; i++)
      if (Date.parse(batches[i]!.time) - Date.parse(batches[i - 1]!.time) >= gap * 60000) cuts.add(i);
  return cuts;
}

/** Batch indexes grouped into commits: [[0, 1], [2], [3, 4]]. */
export function groupsOf(count: number, cuts: Set<number>): number[][] {
  const out: number[][] = [[]];
  for (let i = 0; i < count; i++) {
    if (cuts.has(i) && out[out.length - 1]!.length) out.push([]);
    out[out.length - 1]!.push(i);
  }
  return count ? out : [];
}

/** What a group did to each file overall: added then edited is still "added"; added then deleted is nothing. */
export function filesOf(batches: ShapeBatch[], idx: number[]): { path: string; op: Op }[] {
  const seen = new Map<string, { first: Op; last: Op }>();
  for (const f of idx.flatMap((i) => batches[i]!.files)) {
    const x = seen.get(f.path);
    seen.set(f.path, x ? { first: x.first, last: f.op } : { first: f.op, last: f.op });
  }
  return [...seen].flatMap(([path, { first, last }]) =>
    first === "add" && last === "delete"
      ? []
      : [{ path, op: (first === "add" ? "add" : last === "delete" ? "delete" : "update") as Op }],
  );
}

/** "Add about.html, update index.html and 2 more": each kind of change in turn. issueKey ("SHOP-42") goes in front. */
export function suggestMessage(files: { path: string; op: Op }[], issueKey = ""): string {
  const name = (p: string) => p.split("/").pop() ?? p;
  const verbs: Record<Op, string> = { add: "add", update: "update", delete: "remove" };
  const byOp: Partial<Record<Op, string[]>> = {};
  for (const f of files) (byOp[f.op] ||= []).push(name(f.path));
  const list = (xs: string[]) =>
    xs.length <= 2 ? xs.join(" and ") : `${xs.slice(0, 2).join(", ")} and ${xs.length - 2} more`;
  const parts = (["add", "update", "delete"] as Op[])
    .filter((op) => byOp[op])
    .map((op) => `${verbs[op]} ${list(byOp[op]!)}`);
  let msg = parts.length ? parts.join(", ") : "update files";
  msg = msg[0]!.toUpperCase() + msg.slice(1);
  return issueKey ? `${issueKey}: ${msg}` : msg;
}

/** How long between two times: "a moment", "12 minutes", "2 h 5 min". */
export function span(a: string, b: string): string {
  const m = Math.round((Date.parse(b) - Date.parse(a)) / 60000);
  return m < 1
    ? "a moment"
    : m < 60
      ? plural(m, "minute")
      : `${Math.floor(m / 60)} h ${m % 60 ? (m % 60) + " min" : ""}`.trim();
}
export const opMark = (op: Op) => (op === "add" ? "+" : op === "delete" ? "−" : "✎");
