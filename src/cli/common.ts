import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

import type { Pair } from "../config.ts";
import type { Line } from "../difftext.ts";
import { toSlash } from "../engine/fsops.ts";

declare const FERRY_VERSION: string | undefined;
declare const FERRY_COMMIT: string | undefined;
declare const FERRY_DATE: string | undefined;

/** Set at build time with --define; these are the values for running from source. */
export const VERSION = typeof FERRY_VERSION === "string" ? FERRY_VERSION : "1.2.0";
export const COMMIT = typeof FERRY_COMMIT === "string" ? FERRY_COMMIT : "dev";
export const DATE = typeof FERRY_DATE === "string" ? FERRY_DATE : "";

export const out = {
  color: !process.env.NO_COLOR && !!process.stdout.isTTY,
};

export function paint(code: string, s: string): string {
  return out.color ? `\x1b[${code}m${s}\x1b[0m` : s;
}

export function println(s = ""): void {
  process.stdout.write(s + "\n");
}

export const isTTY = () => !!process.stdout.isTTY && !!process.stdin.isTTY;
export const stdinIsTTY = () => !!process.stdin.isTTY;

/** Reads stdin line by line; one reader is shared by every prompt. */
class LineReader {
  private rl: readline.Interface | null = null;
  private lines: string[] = [];
  private waiters: ((l: string | null) => void)[] = [];
  private closed = false;

  private open(): void {
    if (this.rl) return;
    this.rl = readline.createInterface({ input: process.stdin, terminal: false });
    this.rl.on("line", (l) => {
      const w = this.waiters.shift();
      if (w) w(l);
      else this.lines.push(l);
    });
    this.rl.on("close", () => {
      this.closed = true;
      for (const w of this.waiters.splice(0)) w(null);
    });
  }

  /** The next line, or null at end of input. */
  read(): Promise<string | null> {
    this.open();
    if (this.lines.length > 0) return Promise.resolve(this.lines.shift()!);
    if (this.closed) return Promise.resolve(null);
    return new Promise((r) => this.waiters.push(r));
  }

  close(): void {
    this.rl?.close();
    this.rl = null;
  }
}

export const stdinLines = new LineReader();

export async function confirm(prompt: string): Promise<boolean> {
  process.stdout.write(prompt);
  const line = ((await stdinLines.read()) ?? "").trim().toLowerCase();
  return line === "y" || line === "yes";
}

export function printDiff(title: string, lines: Line[]): void {
  println(paint("1", title));
  if (lines.length === 0) println(paint("90", "no differences"));
  for (const l of lines) {
    if (l.op === "+") println(paint("32", "+" + l.text));
    else if (l.op === "-") println(paint("31", "-" + l.text));
    else if (l.op === "@") println(paint("36", l.text));
    else println(" " + l.text);
  }
}

/** A path relative to the pair, or an absolute path inside either folder, as a pair-relative path. */
export function relTo(p: Pair, file: string): string {
  const abs = path.resolve(file);
  for (const root of [p.target, p.source]) {
    const r = path.relative(root, abs);
    if (!r.startsWith("..") && !path.isAbsolute(r) && fs.existsSync(abs)) return toSlash(r);
  }
  return toSlash(file);
}

export function orDash(s: string): string {
  return s === "" ? "–" : s;
}

export function modeArrow(mode: string): string {
  return mode === "two-way" ? "⇄" : "→";
}
