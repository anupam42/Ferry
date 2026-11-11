// The history graph's layout (plain TypeScript, unit-tested): commits in lanes.
import type { Commit } from "./types.ts";

export const LANE_COLOURS = ["#22A06B", "#2A78D6", "#E0592A", "#8B5CF6", "#D6457A", "#1FA3B8", "#C99A1B", "#5B6B8A"];
export const GRAPH = { row: 44, lane: 14, pad: 10, max: 12 };

/** A piece of line crossing a row: from lane to lane, over the top half, the bottom half, or all of it. */
export interface Edge {
  from: number;
  to: number;
  half: "top" | "bottom" | "all";
  c: number;
}
export interface GraphRow {
  col: number;
  c: number;
  lines: Edge[];
}

/**
 * Lays commits (newest first, children before parents) out in lanes. Each
 * row gets its node's lane and colour, and the line pieces that cross it:
 * lanes passing straight through, lanes curving into this commit (where
 * branches meet), and lines out to its parents (where a merge forks).
 * pin: the commit HEAD points at, whose branch always takes the first lane.
 */
export function graphLayout(
  commits: Pick<Commit, "hash" | "parents">[],
  pin?: string,
): { rows: GraphRow[]; width: number } {
  const lanes: (string | null)[] = [],
    colour: number[] = [];
  let next = 0,
    width = 1;
  if (pin && commits.some((c) => c.hash === pin)) {
    lanes[0] = pin;
    colour[0] = 0;
    next = 1;
  }
  const rows = commits.map((c) => {
    const before = lanes.slice(),
      beforeColour = colour.slice();
    let col = lanes.indexOf(c.hash);
    if (col < 0) {
      // a branch tip: no child seen yet
      col = lanes.indexOf(null);
      if (col < 0) col = lanes.length;
      colour[col] = next++ % LANE_COLOURS.length;
      beforeColour[col] = colour[col]!;
    }
    const lines: Edge[] = [];
    before.forEach((hash, j) => {
      if (!hash) return;
      if (hash === c.hash) {
        lines.push({ from: j, to: col, half: "top", c: beforeColour[j]! });
        if (j !== col) lanes[j] = null;
      } else lines.push({ from: j, to: j, half: "all", c: beforeColour[j]! });
    });
    const [first, ...others] = c.parents;
    lanes[col] = first || null;
    if (first) lines.push({ from: col, to: col, half: "bottom", c: colour[col]! });
    for (const p of others) {
      let k = lanes.indexOf(p);
      if (k < 0) {
        k = lanes.indexOf(null);
        if (k < 0) k = lanes.length;
        lanes[k] = p;
        colour[k] = next++ % LANE_COLOURS.length;
      }
      lines.push({ from: col, to: k, half: "bottom", c: colour[k]! });
    }
    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop();
    width = Math.max(width, before.length, lanes.length, col + 1);
    return { col, c: colour[col]!, lines };
  });
  return { rows, width: Math.min(width, GRAPH.max) };
}

/** An SVG path for one piece: straight down, or a smooth curve between lanes. */
export function edgePath(e: Edge): string {
  const { row: H, lane: L, pad } = GRAPH;
  const x = (j: number) => pad + j * L,
    mid = H / 2;
  const curve = (x1: number, y1: number, x2: number, y2: number) =>
    x1 === x2 ? `M${x1} ${y1}V${y2}` : `M${x1} ${y1}C${x1} ${(y1 + y2) / 2} ${x2} ${(y1 + y2) / 2} ${x2} ${y2}`;
  return e.half === "all"
    ? curve(x(e.from), 0, x(e.to), H)
    : e.half === "top"
      ? curve(x(e.from), 0, x(e.to), mid)
      : curve(x(e.from), mid, x(e.to), H);
}

const AVATAR = ["#2F55D4", "#3D5A99", "#7C3AED", "#2E7D5B", "#C2410C", "#0E7490", "#BE185D", "#4B5563"];
/** The same person always gets the same colour. */
export function avatar(author: string, email = ""): { initials: string; colour: string } {
  let n = 0;
  for (const ch of email || author) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
  return {
    initials:
      author
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((w) => (w[0] ? w[0].toUpperCase() : ""))
        .join("") || "?",
    colour: AVATAR[n % AVATAR.length]!,
  };
}
