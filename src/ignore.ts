// .gitignore-style path matching.
//
// Supported syntax: blank lines, # comments, ! negation, trailing / for
// directories, leading / or inner / to anchor, *, ?, [abc], and **.
// Rules can be scoped to a base directory, which is how nested .gitignore
// files work. Later rules win, as in git.
import fs from "node:fs";

interface Rule {
  re: RegExp;
  negate: boolean;
  dirOnly: boolean;
  base: string; // slash path ("" = root)
}

const quoteMeta = (s: string) => s.replace(/[\\^$.*+?()[\]{}|\/-]/g, "\\$&");

export class Matcher {
  private rules: Rule[] = [];

  constructor(...patterns: string[]) {
    this.add("", patterns);
  }

  /** An independent copy (rules are immutable, so copying the list is enough). */
  clone(): Matcher {
    const c = new Matcher();
    c.rules = this.rules.slice();
    return c;
  }

  get length(): number {
    return this.rules.length;
  }

  /** Reads a gitignore-format file; base is the slash path of its directory. Missing files are fine. */
  addFile(file: string, base: string): void {
    let text: string;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      return;
    }
    const lines = text.split("\n");
    if (lines.length && lines[lines.length - 1] === "") lines.pop();
    this.add(base, lines);
  }

  /** Compiles patterns scoped to base. */
  add(base: string, patterns: readonly string[]): void {
    base = base.replace(/^\/+|\/+$/g, "");
    for (const p of patterns) {
      const r = compile(p, base);
      if (r) this.rules.push(r);
    }
  }

  /** Applies the rules to exactly this path (no parent check). */
  private matchOne(rel: string, isDir: boolean): boolean {
    let ignored = false;
    for (const r of this.rules) {
      if (r.dirOnly && !isDir) continue;
      if (r.base !== "" && !rel.startsWith(r.base + "/")) continue;
      if (r.re.test(rel)) ignored = !r.negate;
    }
    return ignored;
  }

  /** Whether rel is ignored, directly or because a parent directory is. */
  match(rel: string, isDir: boolean): boolean {
    if (this.rules.length === 0) return false;
    rel = rel.replace(/^\/+|\/+$/g, "");
    // parents first: git can't re-include a file inside an excluded directory
    const parts = rel.split("/");
    for (let i = 1; i < parts.length; i++) {
      if (this.matchOne(parts.slice(0, i).join("/"), true)) return true;
    }
    return this.matchOne(rel, isDir);
  }

  /** match() without the parent check, for walks that already skipped excluded parents. */
  matchDirect(rel: string, isDir: boolean): boolean {
    return this.matchOne(rel, isDir);
  }
}

function compile(p: string, base: string): Rule | null {
  p = p.replace(/\r+$/, "");
  // trailing spaces are ignored unless escaped
  while (p.endsWith(" ") && !p.endsWith("\\ ")) p = p.slice(0, -1);
  if (p === "" || p.startsWith("#")) return null;
  let negate = false;
  if (p.startsWith("!")) {
    negate = true;
    p = p.slice(1);
  } else if (p.startsWith("\\!") || p.startsWith("\\#")) {
    p = p.slice(1);
  }
  let dirOnly = false;
  if (p.endsWith("/")) {
    dirOnly = true;
    p = p.replace(/\/+$/, "");
  }
  if (p === "") return null;
  const anchored = p.includes("/");
  if (p.startsWith("/")) p = p.slice(1);

  let src = "^";
  if (base !== "") src += quoteMeta(base) + "/";
  if (!anchored) src += "(?:.*/)?";
  src += globToRegex(p) + "$";
  try {
    return { re: new RegExp(src, "s"), negate, dirOnly, base };
  } catch {
    return null;
  }
}

function globToRegex(g: string): string {
  let out = "";
  for (let i = 0; i < g.length; i++) {
    const c = g[i]!;
    switch (c) {
      case "*":
        if (g[i + 1] === "*") {
          // "**/" => any number of dirs; "/**" at end => everything inside; "**" => anything
          if (g[i + 2] === "/") {
            out += "(?:.*/)?";
            i += 2;
          } else {
            out += ".*";
            i++;
          }
        } else {
          out += "[^/]*";
        }
        break;
      case "?":
        out += "[^/]";
        break;
      case "[": {
        let j = i + 1;
        if (g[j] === "!" || g[j] === "^") j++;
        if (g[j] === "]") j++;
        while (j < g.length && g[j] !== "]") j++;
        if (j >= g.length) {
          out += "\\[";
          continue;
        }
        let cls = g.slice(i + 1, j);
        if (cls.startsWith("!")) cls = "^" + cls.slice(1);
        out += "[" + cls.replaceAll("\\", "\\\\") + "]";
        i = j;
        break;
      }
      case "\\":
        if (i + 1 < g.length) {
          i++;
          out += quoteMeta(g[i]!);
        }
        break;
      default:
        out += quoteMeta(c);
    }
  }
  return out;
}
