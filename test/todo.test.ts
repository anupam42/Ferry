// The Todo tab: reading a README's todo section, editing its lines, and Relay's reminders.
import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

import { editTodoLine, parseTodo, splitTodo, type TodoItem } from "../src/shared/todo.ts";
import { editTodo, findReadme, readTodo } from "../src/todo.ts";
import { daysBetween, dueLabel, reminder, waited } from "../web/lib/todo.ts";
import { tempDir } from "./helpers.ts";

const README = `# Project

Some text.

- [ ] not a todo: it's above the section

## Todo

Intro line.

- [ ] **First** — the first thing (due 2026-12-01)
- [x] **Second** — already done
  - [ ] nested 📅 2026-11-20

\`\`\`
- [ ] inside a code block
\`\`\`

### Git client

- [ ] **Stash selected files** — stash just some

**Visual**

* [X] Screenshot diff

## Development

- [ ] after the section
`;

const item = (o: Partial<TodoItem>): TodoItem => ({
  line: 1,
  raw: "",
  text: "**Thing** — it",
  done: false,
  due: null,
  group: "",
  depth: 0,
  since: null,
  by: "",
  uncommitted: false,
  ...o,
});

describe("todo", () => {
  test("reads every checklist outside code blocks, grouped by heading, with nesting and dates", () => {
    const { heading, items } = parseTodo(README);
    expect(heading).toBe("");
    expect(items.map((i) => [i.line, i.done, i.group, i.depth, i.due])).toEqual([
      [5, false, "", 0, null],
      [11, false, "Todo", 0, "2026-12-01"],
      [12, true, "Todo", 0, null],
      [13, false, "Todo", 1, "2026-11-20"],
      [21, false, "Git client", 0, null],
      [25, true, "Visual", 0, null],
      [29, false, "Development", 0, null],
    ]);
    expect(items[1]!.text).toBe("**First** — the first thing");
    expect(items[3]!.text).toBe("nested");
    expect(parseTodo("# Hi\n\nNo list.\n").items).toEqual([]);
    // a status list like "## Status / ### Backend", and the same group name under two headings
    const two = parseTodo(
      "# App\n## Status\n### Backend\n- [x] a\n### Frontend\n- [ ] b\n## Ideas\n### Backend\n- [ ] c\n",
    );
    expect(two.heading).toBe("Status");
    expect(two.items.map((i) => i.group)).toEqual(["Status › Backend", "Frontend", "Ideas › Backend"]);
  });

  test("editing a line changes only its box and its date", () => {
    const raw = "  - [ ] **A** — b (due 2026-01-02)";
    expect(editTodoLine(raw, { done: true })).toBe("  - [x] **A** — b (due 2026-01-02)");
    expect(editTodoLine(raw, { due: "2026-03-04" })).toBe("  - [ ] **A** — b (due 2026-03-04)");
    expect(editTodoLine(raw, { due: null })).toBe("  - [ ] **A** — b");
    expect(editTodoLine("- [x] c 📅 2026-01-01", { done: false, due: "2026-02-02" })).toBe("- [ ] c (due 2026-02-02)");
    expect(editTodoLine("plain line", { done: true })).toBe("plain line");
    expect(splitTodo("**Todo tab** — a new tab")).toEqual({ title: "Todo tab", rest: "a new tab" });
    expect(splitTodo("just text")).toEqual({ title: "just text", rest: "" });
  });

  test("README edits check the line first and keep line endings; blame dates the items", async () => {
    const d = path.join(tempDir(), "r");
    fs.mkdirSync(d);
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
    git("init", "-q");
    fs.writeFileSync(path.join(d, "README.md"), "# P\r\n\r\n## Todo\r\n\r\n- [ ] one\r\n- [ ] two\r\n");
    git("add", ".");
    git("commit", "-qm", "first");
    expect(findReadme(d)).toBe("README.md");
    const file = path.join(d, "README.md");
    let list = await readTodo(d, "README.md", { file, via: "" });
    expect(list.items.length).toBe(2);
    expect(list.items[0]!.by).toBe("T");
    expect(list.items[0]!.uncommitted).toBe(false);
    expect(Date.now() - list.items[0]!.since!).toBeLessThan(120_000);

    editTodo(file, 5, "- [ ] one", { done: true });
    editTodo(file, 6, "- [ ] two", { due: "2026-12-24" });
    expect(fs.readFileSync(file, "utf8")).toBe("# P\r\n\r\n## Todo\r\n\r\n- [x] one\r\n- [ ] two (due 2026-12-24)\r\n");
    expect(() => editTodo(file, 5, "- [ ] one", { done: true })).toThrow(/changed/);
    expect(() => editTodo(file, 6, "- [ ] two (due 2026-12-24)", { due: "soon" })).toThrow(/date/);

    list = await readTodo(d, "README.md", { file, via: "" });
    expect(list.items.map((i) => [i.done, i.due, i.uncommitted])).toEqual([
      [true, null, true],
      [false, "2026-12-24", true],
    ]);
    expect(await readTodo(d, null, null)).toEqual({ file: null, heading: "", items: [], via: "" });
  });

  test("dates in words", () => {
    expect(daysBetween("2026-11-11", "2026-11-14")).toBe(3);
    expect(daysBetween("2026-11-11", "2026-11-01")).toBe(-10);
    expect(dueLabel("2026-11-10", "2026-11-11")).toEqual({ text: "a day late", tone: "red" });
    expect(dueLabel("2026-11-11", "2026-11-11")).toEqual({ text: "due today", tone: "amber" });
    expect(dueLabel("2026-11-12", "2026-11-11")).toEqual({ text: "due tomorrow", tone: "amber" });
    expect(dueLabel("2026-12-30", "2026-11-11").tone).toBe("");
    const now = Date.UTC(2026, 10, 11);
    expect(waited(now - 3 * 86_400_000, now)).toBe("3 days");
    expect(waited(now - 21 * 86_400_000, now)).toBe("3 weeks");
    expect(waited(now - 100 * 86_400_000, now)).toBe("3 months");
  });

  test("Relay reminds about late items first, then ones due soon, then ones left waiting", () => {
    const day = "2026-11-11",
      ms = Date.UTC(2026, 10, 11);
    expect(reminder([], day, ms).face).toBe("thinking");
    expect(reminder([item({ done: true })], day, ms).face).toBe("party");
    const old = item({ text: "**Old** — x", since: ms - 40 * 86_400_000 });
    const soon = item({ text: "**Soon**", due: "2026-11-12" });
    const late = item({ text: "**Late**", due: "2026-11-08" });
    expect(reminder([old, soon, late], day, ms)).toMatchObject({ face: "worried", say: "“Late” is 3 days late." });
    expect(reminder([old, soon], day, ms)).toMatchObject({ face: "focused", say: "“Soon” is due tomorrow." });
    expect(reminder([old], day, ms)).toMatchObject({ face: "sleepy", say: "“Old” has been waiting 6 weeks." });
    expect(reminder([item({ since: ms })], day, ms).face).toBe("happy");
  });
});
