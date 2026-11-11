// A project's todo list, read from the Todo section of its README: every
// "- [ ] …" / "- [x] …" line under a heading called Todo (or To do, Todos,
// Tasks or Roadmap), grouped by the subheadings (or bold-only lines) inside it.
// An item can carry a date it should be done by, written in the line itself as
// "(due 2026-12-01)" or "📅 2026-12-01", so the list and its dates live in the
// repository. No imports: the server and the web app both use this.

export interface TodoItem {
  /** 1-based line in the README */
  line: number;
  /** the whole line as it is in the file, to check nothing changed before editing it */
  raw: string;
  /** the item's markdown, without the checkbox and the due date */
  text: string;
  done: boolean;
  /** YYYY-MM-DD, when the line names one */
  due: string | null;
  /** the subheading it's under ("" for none) */
  group: string;
  /** nesting: 0 for a top-level item */
  depth: number;
  /** when the line last changed (ms): when it was added, or ticked; null when git doesn't know */
  since: number | null;
  /** who changed it last */
  by: string;
  /** not committed yet */
  uncommitted: boolean;
}

export interface TodoList {
  /** the README's path in the repository, or null when there is none */
  file: string | null;
  /** the section's heading, or "" when the README has no todo section */
  heading: string;
  items: TodoItem[];
  /** edits go to the working folder of a folder pair, which then syncs them into the repository */
  via: string;
}

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const TODO_TITLE = /^(to-?\s?dos?|tasks|roadmap)\b/i;
const ITEM = /^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)$/;
const BOLD_GROUP = /^\*\*([^*].*?)\*\*:?\s*$/;
const DUE = /\s*(?:\(due:?\s*(\d{4}-\d{2}-\d{2})\)|📅\s*(\d{4}-\d{2}-\d{2}))/i;

/** The todo section of a README's text, with each item's line number; dates from git are filled in later. */
export function parseTodo(text: string): { heading: string; items: TodoItem[] } {
  const lines = text.split(/\r?\n/);
  let start = -1,
    level = 0,
    heading = "";
  let fence = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (/^\s*(```|~~~)/.test(l)) fence = !fence;
    if (fence) continue;
    const h = HEADING.exec(l);
    if (h && TODO_TITLE.test(h[2]!.replace(/[*_`]/g, ""))) {
      start = i;
      level = h[1]!.length;
      heading = h[2]!.replace(/[*_`]/g, "");
      break;
    }
  }
  if (start < 0) return { heading: "", items: [] };
  const items: TodoItem[] = [];
  let group = "";
  fence = false;
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i]!;
    if (/^\s*(```|~~~)/.test(l)) {
      fence = !fence;
      continue;
    }
    if (fence) continue;
    const h = HEADING.exec(l);
    if (h) {
      if (h[1]!.length <= level) break;
      group = h[2]!.replace(/[*_`]/g, "");
      continue;
    }
    const b = BOLD_GROUP.exec(l);
    if (b) {
      group = b[1]!;
      continue;
    }
    const m = ITEM.exec(l);
    if (!m) continue;
    let body = m[3]!;
    const d = DUE.exec(body);
    const due = d ? (d[1] ?? d[2] ?? null) : null;
    if (d) body = (body.slice(0, d.index) + body.slice(d.index + d[0].length)).trim();
    items.push({
      line: i + 1,
      raw: l,
      text: body,
      done: m[2] !== " ",
      due,
      group,
      depth: Math.floor(m[1]!.replace(/\t/g, "  ").length / 2),
      since: null,
      by: "",
      uncommitted: false,
    });
  }
  return { heading, items };
}

/** The line with its checkbox and due date changed; other text stays as written. */
export function editTodoLine(raw: string, o: { done?: boolean; due?: string | null }): string {
  const m = ITEM.exec(raw);
  if (!m) return raw;
  let out = raw;
  if (o.done !== undefined) out = out.replace(/\[([ xX])\]/, o.done ? "[x]" : "[ ]");
  if (o.due !== undefined) {
    const d = DUE.exec(out);
    if (d) out = out.slice(0, d.index) + out.slice(d.index + d[0].length);
    out = out.replace(/\s+$/, "");
    if (o.due) out += ` (due ${o.due})`;
  }
  return out;
}

/** An item's bold lead ("**Todo tab** — …") and the rest, for showing it as a title and a description. */
export function splitTodo(text: string): { title: string; rest: string } {
  const m = /^\*\*(.+?)\*\*\s*(?:[—–:-]\s*)?(.*)$/.exec(text);
  return m ? { title: m[1]!, rest: m[2]! } : { title: text, rest: "" };
}
