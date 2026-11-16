// Matching a folder pair's target to a repository when the two paths are spelled differently.
import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

import { real } from "../src/gitapi.ts";
import { tempDir } from "./helpers.ts";

/** The Windows 8.3 short name of a folder, or null when the volume doesn't make them. */
function shortName(dir: string): string | null {
  const p = Bun.spawnSync(["cmd", "/c", "for %I in (.) do @echo %~sI"], { cwd: dir });
  const out = new TextDecoder().decode(p.stdout).trim();
  return out && out.toLowerCase() !== dir.toLowerCase() ? out : null;
}

describe("real paths", () => {
  test("a folder that doesn't exist keeps its resolved path", () => {
    const p = path.join(tempDir(), "missing", "..", "nope");
    expect(real(p)).toBe(path.resolve(p));
  });

  test("relative and absolute spellings agree", () => {
    const d = path.join(tempDir(), "Some Folder");
    fs.mkdirSync(d);
    expect(real(path.relative(process.cwd(), d))).toBe(real(d));
  });

  test.if(process.platform === "win32")("a Windows short name or another case is the same folder", () => {
    const d = path.join(tempDir(), "A Long Folder Name");
    fs.mkdirSync(d);
    expect(real(d.toUpperCase())).toBe(real(d));
    const short = shortName(d);
    if (short) expect(real(short)).toBe(real(d));
  });
});
