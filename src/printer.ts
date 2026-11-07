// Renders engine events as plain colored text or NDJSON.
import { eventJSON, type Event, type Kind } from "./engine/types.ts";
import { fmtClock } from "./util.ts";

export interface Sink {
  write(s: string): void;
}

export const stdoutSink: Sink = { write: (s) => void process.stdout.write(s) };

const styles: Record<Kind, [string, string]> = {
  add: ["ADD", "32"],
  update: ["UPDATE", "33"],
  delete: ["DELETE", "31"],
  rename: ["RENAME", "35"],
  conflict: ["CONFLICT", "1;31"],
  resolved: ["RESOLVED", "32"],
  skip: ["SKIP", "90"],
  warn: ["WARN", "33"],
  error: ["ERROR", "1;31"],
  synced: ["SYNCED", "36"],
  paused: ["PAUSED", "1;33"],
  resumed: ["RESUMED", "32"],
  commit: ["COMMIT", "1;32"],
  info: ["INFO", "34"],
  git: ["GIT", "36"],
  kept: ["KEPT", "34"],
};

export function paintIf(on: boolean, code: string, s: string): string {
  return on && code ? `\x1b[${code}m${s}\x1b[0m` : s;
}

export class Printer {
  out: Sink = stdoutSink;
  log: Sink | null = null; // optional plain-text copy (no color)
  color = false;
  quiet = false;
  json = false;
  showGit = false;
  showPair = false;

  constructor(o: Partial<Printer> = {}) {
    Object.assign(this, o);
  }

  /** Prints one event. */
  handle = (ev: Event): void => {
    if (this.json) {
      const line = JSON.stringify(eventJSON(ev)) + "\n";
      this.out.write(line);
      this.log?.write(line);
      return;
    }
    if (this.quiet && ["add", "update", "delete", "rename", "skip", "info"].includes(ev.kind)) return;
    if (ev.kind === "git" && !this.showGit) return;
    this.out.write(this.format(ev, this.color));
    this.log?.write(this.format(ev, false));
  };

  format(ev: Event, color: boolean): string {
    const [tag, code] = styles[ev.kind] ?? ["", ""];
    let b = paintIf(color, "90", fmtClock(new Date(ev.time))) + " ";
    if (this.showPair) b += paintIf(color, "1", `[${ev.pair}]`) + " ";
    b += paintIf(color, code, tag.padEnd(8)) + " ";
    if (ev.dir) b += ev.dir + " ";
    if (ev.kind === "git") {
      const lines = ev.lines ?? [];
      if (lines.length === 0) b += paintIf(color, "90", "working tree clean");
      else {
        b += `${lines.length} change(s) on ${ev.msg || "(detached)"}`;
        for (let i = 0; i < lines.length; i++) {
          if (i === 15) {
            b += `\n           … ${lines.length - 15} more`;
            break;
          }
          b += "\n           " + gitLine(color, lines[i]!);
        }
      }
      return b + "\n";
    }
    if (ev.path) {
      b += ev.path;
      if (ev.to) b += " → " + ev.to;
      if (ev.msg) b += "  ";
    }
    if (ev.msg) b += ev.path ? paintIf(color, "90", ev.msg) : ev.msg;
    if (ev.dryRun) b += paintIf(color, "90", " (dry-run)");
    return b + "\n";
  }
}

function gitLine(color: boolean, l: string): string {
  if (l.length < 2) return l;
  let code = "33";
  if (l.startsWith("??")) code = "32";
  else if (l.slice(0, 2).includes("D")) code = "31";
  else if (l.slice(0, 2).includes("R")) code = "35";
  return paintIf(color, code, l);
}
