// TODO and FIXME comments in a repository's code, for the web app's Todo tab: found with
// `git grep` (tracked files and new ones that aren't ignored), aged by git blame, and moved
// into the README's list on request.
import fs from "node:fs";

import { codeTodoLine, findCodeTodo, insertTodo, type CodeTodo, type CodeTodoList } from "./shared/todo.ts";
import { blameLines, TodoError, type Place } from "./todo.ts";

export type { CodeTodo, CodeTodoList } from "./shared/todo.ts";

/** At most this many comments are listed (and blamed). */
export const MAX_CODE_TODOS = 400;

// prose, generated and vendored files: a TODO there isn't a code comment
const SKIP = [
  "*.md",
  "*.markdown",
  "*.txt",
  "*.rst",
  "*.lock",
  "*-lock.json",
  "*.min.js",
  "*.min.css",
  "*.map",
  "*.svg",
  "CHANGELOG*",
  "node_modules/*",
  "vendor/*",
  "dist/*",
];

/** Every TODO, FIXME, HACK and XXX comment, oldest first. */
export async function scanCodeTodos(root: string): Promise<CodeTodoList> {
  const args = [
    "git",
    "-C",
    root,
    "grep",
    "-n",
    "-I",
    "-w",
    "--null",
    "--untracked",
    "--no-color",
    "-E",
    "TODO|FIXME|HACK|XXX",
    "--",
    ".",
    ...SKIP.map((p) => `:(exclude,glob)**/${p}`),
    ...SKIP.map((p) => `:(exclude,glob)${p}`),
  ];
  const p = Bun.spawn(args, { stdout: "pipe", stderr: "ignore", env: { ...process.env, LC_ALL: "C" } });
  const out = await new Response(p.stdout).text();
  await p.exited; // 1 means no matches
  const items: CodeTodo[] = [];
  let truncated = false;
  for (const row of out.split("\n")) {
    const a = row.indexOf("\0");
    const b = a < 0 ? -1 : row.indexOf("\0", a + 1);
    if (b < 0) continue;
    const text = row.slice(b + 1).replace(/\r$/, "");
    if (text.length > 400) continue; // minified or generated
    const hit = findCodeTodo(text);
    if (!hit) continue;
    if (items.length >= MAX_CODE_TODOS) {
      truncated = true;
      break;
    }
    items.push({
      file: row.slice(0, a),
      line: +row.slice(a + 1, b),
      ...hit,
      since: null,
      by: "",
      uncommitted: false,
    });
  }
  await dateThem(root, items);
  items.sort(
    (x, y) => (x.since ?? Infinity) - (y.since ?? Infinity) || x.file.localeCompare(y.file) || x.line - y.line,
  );
  return { items, truncated };
}

/** Blame dates for each comment: one `git blame` per file, a few at a time. */
async function dateThem(root: string, items: CodeTodo[]): Promise<void> {
  const byFile = new Map<string, CodeTodo[]>();
  for (const it of items) byFile.set(it.file, [...(byFile.get(it.file) ?? []), it]);
  const files = [...byFile.keys()];
  let next = 0;
  const worker = async () => {
    while (next < files.length) {
      const f = files[next++]!;
      const here = byFile.get(f)!;
      const dates = await blameLines(
        root,
        f,
        null,
        here.map((i) => i.line),
      );
      for (const it of here) {
        const d = dates.get(it.line);
        // not in git at all (a new file) counts as not committed yet
        it.uncommitted = d ? d.uncommitted : true;
        it.since = d ? (d.uncommitted ? null : d.time) : null;
        it.by = d?.author ?? "";
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, files.length) }, worker));
}

/**
 * Adds a TODO comment to the README's list as the last item of `group`, and returns the line
 * written. The comment itself stays in the code.
 */
export function addCodeTodo(
  place: Place,
  o: { file?: unknown; kind?: unknown; text?: unknown; group?: unknown },
): string {
  if (typeof o.file !== "string" || !o.file || o.file.includes("\n")) throw new TodoError("which file is it in?");
  if (typeof o.text !== "string") throw new TodoError("the comment's text is missing");
  const kind = typeof o.kind === "string" && /^(TODO|FIXME|HACK|XXX)$/.test(o.kind) ? o.kind : "TODO";
  const group = typeof o.group === "string" ? o.group : "";
  const line = codeTodoLine({ kind, text: o.text, file: o.file });
  const text = fs.readFileSync(place.file, "utf8");
  const tmp = place.file + ".ferry-tmp";
  fs.writeFileSync(tmp, insertTodo(text, group, line));
  fs.renameSync(tmp, place.file);
  return line;
}
