// A project's todo list, read from its README: every "- [ ] …" / "- [x] …"
// checklist line, grouped by the heading (or bold-only line) it's under, so a
// "## Todo", a "## Status" with "### Backend" and "### Frontend", or a list of
// ideas all show up.
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
  /** the heading the first checklist is under, or "" when the README has none */
  heading: string;
  items: TodoItem[];
  /** edits go to the working folder of a folder pair, which then syncs them into the repository */
  via: string;
}

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const ITEM = /^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)$/;
const BOLD_GROUP = /^\*\*([^*].*?)\*\*:?\s*$/;
const DUE = /\s*(?:\(due:?\s*(\d{4}-\d{2}-\d{2})\)|📅\s*(\d{4}-\d{2}-\d{2}))/i;

const plainText = (s: string) => s.replace(/[*_`]/g, "").trim();

/**
 * Every checklist in a README's text ("- [ ] …" and "- [x] …" lines, outside code blocks), each
 * item under the heading (or bold-only line) it sits in, with its line number; dates from git
 * are filled in later. A group name that appears under two different headings ("Backend" under
 * both Status and Ideas) gets its parent's name in front, so the two stay apart. `heading` is the
 * section the list starts in.
 */
export function parseTodo(text: string): { heading: string; items: TodoItem[] } {
  const lines = text.split(/\r?\n/);
  // the headings around the current line, outermost first, and a bold-only line under the last one
  const path: { level: number; name: string }[] = [];
  let bold = "",
    fence = false;
  const found: { item: TodoItem; path: string[] }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (/^\s*(```|~~~)/.test(l)) {
      fence = !fence;
      continue;
    }
    if (fence) continue;
    const h = HEADING.exec(l);
    if (h) {
      const level = h[1]!.length;
      while (path.length && path[path.length - 1]!.level >= level) path.pop();
      path.push({ level, name: plainText(h[2]!) });
      bold = "";
      continue;
    }
    const b = BOLD_GROUP.exec(l);
    if (b) {
      bold = plainText(b[1]!);
      continue;
    }
    const m = ITEM.exec(l);
    if (!m) continue;
    let body = m[3]!;
    const d = DUE.exec(body);
    const due = d ? (d[1] ?? d[2] ?? null) : null;
    if (d) body = (body.slice(0, d.index) + body.slice(d.index + d[0].length)).trim();
    // a level-1 heading is the document's title, not a group
    const names = path.filter((p) => p.level > 1).map((p) => p.name);
    if (bold) names.push(bold);
    found.push({
      path: names,
      item: {
        line: i + 1,
        raw: l,
        text: body,
        done: m[2] !== " ",
        due,
        group: names[names.length - 1] ?? "",
        depth: Math.floor(m[1]!.replace(/\t/g, "  ").length / 2),
        since: null,
        by: "",
        uncommitted: false,
      },
    });
  }
  // the same name under different parents: "Status › Backend" and "Ideas › Backend"
  const parents = new Map<string, Set<string>>();
  for (const f of found) {
    const set = parents.get(f.item.group) ?? new Set<string>();
    set.add(f.path.slice(0, -1).join(" › "));
    parents.set(f.item.group, set);
  }
  for (const f of found)
    if ((parents.get(f.item.group)?.size ?? 0) > 1 && f.path.length > 1) f.item.group = f.path.slice(-2).join(" › ");
  const heading = found[0]?.path[0] ?? "";
  return { heading, items: found.map((f) => f.item) };
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
