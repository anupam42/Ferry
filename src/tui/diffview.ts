// Draws diffs unified or side by side, with light syntax highlighting for
// common languages.
import path from "node:path";

import type { Line } from "../difftext.ts";
import { fit, Style, truncate } from "./term.ts";
import { theme } from "./theme.ts";

interface Language {
  comment: string; // line comment marker
  keywords: Set<string> | null;
}

const words = (s: string) => new Set(s.split(/\s+/).filter(Boolean));

const cLike = words(
  "if else for while do switch case default break continue return func function var let const " +
    "type struct interface class extends implements new delete this self super import export from package " +
    "public private protected static final void int string bool true false nil null undefined try catch " +
    "finally throw throws async await yield go defer select chan map range enum fn impl trait pub use mod " +
    "match mut where loop as in of typeof instanceof",
);
const pyLike = words(
  "def class if elif else for while return import from as with try except finally raise " +
    "lambda yield pass break continue and or not in is None True False global nonlocal async await self " +
    "then fi do done case esac function local export echo",
);
const sql = words("select from where insert into update delete create table drop alter join left right inner outer on group by order having limit values set and or not null as");

const languages: Record<string, Language> = {};
for (const ext of [".go", ".js", ".jsx", ".ts", ".tsx", ".java", ".kt", ".c", ".h", ".cpp", ".cc", ".hpp", ".cs", ".rs", ".swift", ".php", ".scala", ".dart"]) {
  languages[ext] = { comment: "//", keywords: cLike };
}
for (const ext of [".py", ".rb", ".sh", ".bash", ".zsh", ".ps1", ".r"]) languages[ext] = { comment: "#", keywords: pyLike };
for (const ext of [".yaml", ".yml", ".toml"]) languages[ext] = { comment: "#", keywords: null };
languages[".sql"] = { comment: "--", keywords: sql };
languages[".lua"] = { comment: "--", keywords: cLike };

const reToken = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`[^`]*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_][A-Za-z0-9_]*\b/g;

function langFor(p: string): Language | null {
  return languages[path.posix.extname(p.replaceAll("\\", "/")).toLowerCase()] ?? null;
}

/** A line comment marker that is not inside a string, or -1. */
function commentStart(s: string, marker: string): number {
  let quote = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = "";
    } else if (c === '"' || c === "'" || c === "`") quote = c;
    else if (s.startsWith(marker, i)) return i;
  }
  return -1;
}

/** Colors keywords, strings, numbers and line comments; the rest uses base. */
function highlight(text: string, lang: Language | null, base: Style): string {
  const t = theme();
  if (!lang || t.name === "mono") return base.render(text);
  let code = text, comment = "";
  if (lang.comment) {
    const i = commentStart(text, lang.comment);
    if (i >= 0) [code, comment] = [text.slice(0, i), text.slice(i)];
  }
  const kw = new Style({ fg: t.purple, bold: true });
  const str = new Style({ fg: t.yellow });
  const num = new Style({ fg: t.cyan });
  let out = "", last = 0;
  for (const m of code.matchAll(reToken)) {
    const tok = m[0];
    const c = tok[0]!;
    let st: Style | null = null;
    if (c === '"' || c === "'" || c === "`") st = str;
    else if (c >= "0" && c <= "9") st = num;
    else if (lang.keywords?.has(tok)) st = kw;
    if (!st) continue;
    if (m.index! > last) out += base.render(code.slice(last, m.index));
    out += st.render(tok);
    last = m.index! + tok.length;
  }
  if (last < code.length) out += base.render(code.slice(last));
  if (comment) out += t.muted.with({ italic: true }).render(comment);
  return out;
}

const expandTabs = (s: string) => s.replaceAll("\t", "    ");

export function renderDiff(lines: Line[], file: string, sideBySide: boolean, width: number): string {
  const t = theme();
  if (lines.length === 0) return t.muted.render("no differences");
  const lang = langFor(file);
  const add = new Style({ fg: t.green }), del = new Style({ fg: t.red }), hunk = new Style({ fg: t.cyan }), plain = new Style();
  if (sideBySide) return renderSideBySide(lines, lang, width, add, del, hunk, plain);
  const out: string[] = [];
  for (const l of lines) {
    const text = expandTabs(l.text);
    if (l.op === "+") out.push(add.render("+") + highlight(text, lang, add));
    else if (l.op === "-") out.push(del.render("-") + highlight(text, lang, del));
    else if (l.op === "@") out.push(hunk.render(text));
    else out.push(" " + highlight(text, lang, plain));
  }
  return out.join("\n");
}

function renderSideBySide(lines: Line[], lang: Language | null, width: number, add: Style, del: Style, hunk: Style, plain: Style): string {
  const col = Math.max(10, Math.floor((width - 3) / 2));
  const sep = theme().muted.render(" │ ");
  const cell = (text: string, st: Style) => fit(highlight(expandTabs(text), lang, st), col);
  const blank = " ".repeat(col);
  const out: string[] = [];
  let dels: string[] = [], adds: string[] = [];
  const flush = () => {
    for (let i = 0; i < dels.length || i < adds.length; i++) {
      const left = i < dels.length ? cell(dels[i]!, del) : blank;
      const right = i < adds.length ? cell(adds[i]!, add) : blank;
      out.push(left + sep + right);
    }
    dels = [];
    adds = [];
  };
  for (const l of lines) {
    if (l.op === "-") dels.push(l.text);
    else if (l.op === "+") adds.push(l.text);
    else if (l.op === "@") {
      flush();
      out.push(hunk.render(truncate(l.text, width)));
    } else {
      flush();
      out.push(cell(l.text, plain) + sep + cell(l.text, plain));
    }
  }
  flush();
  return out.join("\n");
}
