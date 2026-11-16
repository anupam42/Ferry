// TODO comments in the code: finding them, aging them with blame, and moving one into the README.
import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

import { addCodeTodo, scanCodeTodos } from "../src/codetodo.ts";
import { codeTodoLine, findCodeTodo, insertTodo, parseTodo, type CodeTodo } from "../src/shared/todo.ts";
import { inList, reminder } from "../web/lib/todo.ts";
import { tempDir } from "./helpers.ts";

const DAY = 86_400_000;

function repo(): { d: string; git: (...a: string[]) => void } {
  const d = path.join(tempDir(), "r");
  fs.mkdirSync(d);
  const git = (...a: string[]) => {
    Bun.spawnSync(["git", "-C", d, ...a], {
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "T",
        GIT_AUTHOR_EMAIL: "t@e",
        GIT_COMMITTER_NAME: "T",
        GIT_COMMITTER_EMAIL: "t@e",
        GIT_AUTHOR_DATE: "2025-01-01T12:00:00Z",
        GIT_COMMITTER_DATE: "2025-01-01T12:00:00Z",
      },
    });
  };
  git("init", "-q");
  return { d, git };
}

const code = (o: Partial<CodeTodo>): CodeTodo => ({
  file: "src/a.ts",
  line: 1,
  kind: "TODO",
  text: "retry pushes",
  who: "",
  since: null,
  by: "",
  uncommitted: false,
  ...o,
});

describe("code todos", () => {
  test("a keyword counts only as the first word of a comment", () => {
    expect(findCodeTodo("  // TODO: retry with backoff")).toEqual({
      kind: "TODO",
      text: "retry with backoff",
      who: "",
    });
    expect(findCodeTodo("x = 1 # FIXME(ana) breaks on Windows")).toEqual({
      kind: "FIXME",
      text: "breaks on Windows",
      who: "ana",
    });
    expect(findCodeTodo("/* HACK - until the API is fixed */")?.text).toBe("until the API is fixed");
    expect(findCodeTodo("<!-- TODO add a logo -->")?.text).toBe("add a logo");
    expect(findCodeTodo(" * XXX")).toEqual({ kind: "XXX", text: "", who: "" });
    expect(findCodeTodo("-- TODO: index this column")?.kind).toBe("TODO");
    // not comments, or the keyword isn't the comment's first word
    expect(findCodeTodo('const f = "TODO.txt";')).toBeNull();
    expect(findCodeTodo("#   - url: https://hooks.slack.com/services/XXX")).toBeNull();
    expect(findCodeTodo('expect(x).toBe("// TODO: inside a string")')).toBeNull();
    expect(findCodeTodo("// remember the TODO list")).toBeNull();
    expect(findCodeTodo("const TODO = 1;")).toBeNull();
    expect(findCodeTodo('  expect(f("  // TODO: in a string, after spaces")).toBe(1);')).toBeNull();
    expect(findCodeTodo("// TODO comments are listed in the Todo tab")).toBeNull();
    expect(findCodeTodo("// TODO: comments here need a rewrite")?.text).toBe("comments here need a rewrite");
    expect(findCodeTodo('x = "a"; // TODO(bo): later')?.who).toBe("bo");
  });

  test("a comment becomes a README line; a new group goes after the list", () => {
    expect(codeTodoLine({ kind: "FIXME", text: "breaks on **Windows**", file: "src/a.ts" })).toBe(
      "- [ ] **breaks on Windows** — a FIXME in `src/a.ts`",
    );
    expect(codeTodoLine({ kind: "TODO", text: "", file: "src/a.ts" })).toBe("- [ ] **TODO in `src/a.ts`**");

    const readme = "# P\r\n\r\n## Todo\r\n\r\n- [ ] one\r\n\r\n### Web\r\n\r\n- [ ] two\r\n\r\n## Dev\r\n\r\nText.\r\n";
    const added = insertTodo(readme, "Web", "- [ ] three");
    expect(added).toBe(readme.replace("- [ ] two\r\n", "- [ ] two\r\n- [ ] three\r\n"));
    const fresh = insertTodo(readme, "From the code", "- [ ] three");
    expect(parseTodo(fresh).items.map((i) => [i.text, i.group])).toEqual([
      ["one", "Todo"],
      ["two", "Web"],
      ["three", "From the code"],
    ]);
    // adding a second one joins the group the first made
    const again = insertTodo(fresh, "From the code", "- [ ] four");
    expect(parseTodo(again).items.map((i) => i.group)).toEqual(["Todo", "Web", "From the code", "From the code"]);
    expect(again).toContain("\r\n");
    expect(again).not.toMatch(/[^\r]\n/);
    // no list at all: a Todo section at the end
    expect(insertTodo("# P\n\nHello.\n", "", "- [ ] x")).toBe("# P\n\nHello.\n\n## Todo\n\n- [ ] x\n");
  });

  test("scanning finds comments in tracked and new files, oldest first, and skips prose", async () => {
    const { d, git } = repo();
    fs.mkdirSync(path.join(d, "src"));
    fs.writeFileSync(path.join(d, "src", "old.ts"), "const a = 1;\n// TODO: retry pushes\n");
    fs.writeFileSync(path.join(d, "README.md"), "# P\n\n// TODO: not code\n");
    fs.writeFileSync(path.join(d, ".gitignore"), "ignored.ts\n");
    git("add", ".");
    git("commit", "-qm", "first");
    fs.writeFileSync(path.join(d, "src", "new.py"), "# FIXME breaks on Windows\n");
    fs.writeFileSync(path.join(d, "ignored.ts"), "// TODO: ignored\n");

    const { items, truncated } = await scanCodeTodos(d);
    expect(truncated).toBe(false);
    expect(items.map((i) => [i.file, i.line, i.kind, i.text, i.uncommitted])).toEqual([
      ["src/old.ts", 2, "TODO", "retry pushes", false],
      ["src/new.py", 1, "FIXME", "breaks on Windows", true],
    ]);
    expect(items[0]!.since).toBe(Date.parse("2025-01-01T12:00:00Z"));
    expect(items[0]!.by).toBe("T");
  });

  test("adding one writes it into the README and leaves the code alone", async () => {
    const { d } = repo();
    const file = path.join(d, "README.md");
    fs.writeFileSync(file, "# P\n\n## Todo\n\n- [ ] one\n");
    const line = addCodeTodo(
      { file, via: "" },
      { file: "src/a.ts", kind: "TODO", text: "retry pushes", group: "From the code" },
    );
    expect(line).toBe("- [ ] **retry pushes** — a TODO in `src/a.ts`");
    const items = parseTodo(fs.readFileSync(file, "utf8")).items;
    expect(items.map((i) => i.group)).toEqual(["Todo", "From the code"]);
    expect(inList(code({}), items)).toBe(true);
    expect(inList(code({ file: "src/b.ts" }), items)).toBe(false);
    expect(() => addCodeTodo({ file, via: "" }, { text: "x" })).toThrow("which file");
  });

  test("Relay nudges about comments over six months old, after the list's own reminders", () => {
    const now = Date.parse("2026-11-16T12:00:00Z");
    const old = code({ file: "src/engine/sync.ts", since: now - 240 * DAY });
    const r = reminder(
      [
        {
          line: 1,
          raw: "",
          text: "x",
          done: false,
          due: null,
          group: "",
          depth: 0,
          since: now,
          by: "",
          uncommitted: false,
        },
      ],
      "2026-11-16",
      now,
      [code({ since: now - 10 * DAY }), old],
    );
    expect(r.say).toBe("A TODO in sync.ts has been waiting 8 months.");
    expect(reminder([], "2026-11-16", now, [old]).hint).toContain("a TODO comment in the code");
  });
});
