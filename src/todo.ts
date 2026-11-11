// The web app's Todo tab: the checklists in a repository's README (see shared/todo.ts),
// with git blame saying when each item was added or ticked, and edits written
// back into the README.
import fs from "node:fs";
import path from "node:path";

import { editTodoLine, parseTodo, type TodoList } from "./shared/todo.ts";

export type { TodoItem, TodoList } from "./shared/todo.ts";

export class TodoError extends Error {
  constructor(
    msg: string,
    readonly code = "",
  ) {
    super(msg);
  }
}

const NAMES = ["README.md", "readme.md", "Readme.md", "README.markdown", "README"];

/** The README at the repository's top level, by its path in the repository. */
export function findReadme(root: string): string | null {
  let have: string[];
  try {
    have = fs.readdirSync(root);
  } catch {
    return null;
  }
  return NAMES.find((n) => have.includes(n)) ?? have.find((n) => /^readme(\.\w+)?$/i.test(n)) ?? null;
}

/**
 * Where to read and write a README: normally the repository's own file, but when
 * the repository is a folder pair's target and the pair's working folder has the
 * same file, that copy (the pair syncs it into the repository; editing the
 * repository's copy would be overwritten or fought over).
 */
export interface Place {
  /** the file to read and edit */
  file: string;
  /** the folder pair it belongs to, or "" */
  via: string;
}

/** The todo list, with dates from git blame. `place` is where the README's text lives. */
export async function readTodo(root: string, rel: string | null, place: Place | null): Promise<TodoList> {
  if (!rel || !place) return { file: null, heading: "", items: [], via: "" };
  const text = fs.readFileSync(place.file, "utf8");
  const { heading, items } = parseTodo(text);
  if (items.length) {
    const dates = await blameLines(root, rel, place.file === path.join(root, rel) ? null : place.file);
    for (const it of items) {
      const d = dates.get(it.line);
      if (!d) continue;
      it.since = d.time;
      it.by = d.author;
      it.uncommitted = d.uncommitted;
    }
  }
  return { file: rel, heading, items, via: place.via };
}

/** Ticks, unticks or dates the item on `line`, if that line still reads `raw`. */
export function editTodo(file: string, line: unknown, raw: unknown, o: { done?: unknown; due?: unknown }): void {
  if (typeof line !== "number" || !Number.isInteger(line) || line < 1) throw new TodoError("which line?");
  if (typeof raw !== "string") throw new TodoError("the line's text is missing");
  if (o.due !== undefined && o.due !== null && !(typeof o.due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.due)))
    throw new TodoError("a date looks like 2026-12-01");
  if (o.done !== undefined && typeof o.done !== "boolean") throw new TodoError("done is true or false");
  const text = fs.readFileSync(file, "utf8");
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  if (lines[line - 1] !== raw)
    throw new TodoError("the README changed since this list was read: have another look", "changed");
  const next = editTodoLine(raw, {
    ...(o.done !== undefined ? { done: o.done as boolean } : {}),
    ...(o.due !== undefined ? { due: (o.due as string | null) || null } : {}),
  });
  if (next === raw) return;
  lines[line - 1] = next;
  const tmp = file + ".ferry-tmp";
  fs.writeFileSync(tmp, lines.join(eol));
  fs.renameSync(tmp, file);
}

/** When each line of the file last changed, by line number. `contents`: blame this text instead of the work tree's. */
async function blameLines(
  root: string,
  rel: string,
  contents: string | null,
): Promise<Map<number, { time: number; author: string; uncommitted: boolean }>> {
  const out = new Map<number, { time: number; author: string; uncommitted: boolean }>();
  const args = ["git", "-C", root, "blame", "--porcelain", ...(contents ? ["--contents", contents] : []), "--", rel];
  const p = Bun.spawn(args, { stdout: "pipe", stderr: "ignore", env: { ...process.env, LC_ALL: "C" } });
  const text = await new Response(p.stdout).text();
  if ((await p.exited) !== 0) return out;
  const info = new Map<string, { time: number; author: string }>();
  let cur = "",
    lineNo = 0;
  for (const l of text.split("\n")) {
    const head = /^([0-9a-f]{40,64}) \d+ (\d+)/.exec(l);
    if (head) {
      cur = head[1]!;
      lineNo = +head[2]!;
      if (!info.has(cur)) info.set(cur, { time: 0, author: "" });
      continue;
    }
    const meta = info.get(cur);
    if (!meta) continue;
    if (l.startsWith("author ")) meta.author = l.slice(7);
    else if (l.startsWith("author-time ")) meta.time = +l.slice(12) * 1000;
    else if (l.startsWith("\t")) {
      const uncommitted = /^0+$/.test(cur);
      out.set(lineNo, {
        time: uncommitted ? Date.now() : meta.time,
        author: uncommitted ? "" : meta.author,
        uncommitted,
      });
    }
  }
  return out;
}
