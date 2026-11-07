#!/usr/bin/env bun
// ferry — keep a working folder and a git repo folder in sync from any terminal.
import {
  cmdBackups, cmdCommit, cmdConflicts, cmdDiff, cmdDoctor, cmdHistory, cmdInit, cmdPlan, cmdResolve, cmdRestore,
  cmdService, cmdStats, cmdStatus, cmdUndo,
} from "./cli/commands.ts";
import { COMMIT, DATE, out, paint, stdinLines, VERSION } from "./cli/common.ts";
import { cmdCompletion } from "./cli/completion.ts";
import { cmdRun } from "./cli/run.ts";
import { cmdUI } from "./cli/ui.ts";
import { SUBCOMMANDS, usage } from "./cli/usage.ts";
import { ExitError } from "./util.ts";

async function main(argv: string[]): Promise<void> {
  const args = argv.filter((a) => {
    if (a === "--no-color" || a === "-no-color") {
      out.color = false;
      return false;
    }
    return true;
  });
  let cmd = "run";
  let rest = args;
  const first = args[0];
  if (first === "-h" || first === "--help") [cmd, rest] = ["help", []];
  else if (first === "-v" || first === "--version") [cmd, rest] = ["version", []];
  else if (first !== undefined && SUBCOMMANDS.includes(first)) [cmd, rest] = [first, args.slice(1)];

  switch (cmd) {
    case "run": return cmdRun(rest);
    case "init": return cmdInit(rest);
    case "status": return cmdStatus(rest);
    case "commit": return cmdCommit(rest);
    case "diff": return cmdDiff(rest);
    case "plan": return cmdPlan(rest);
    case "backups": return cmdBackups(rest);
    case "conflicts": return cmdConflicts(rest);
    case "resolve": return cmdResolve(rest);
    case "history": return cmdHistory(rest);
    case "undo": return cmdUndo(rest);
    case "restore": return cmdRestore(rest);
    case "stats": return cmdStats(rest);
    case "ui": return cmdUI(rest);
    case "doctor": return cmdDoctor(rest);
    case "service": return cmdService(rest);
    case "completion": return cmdCompletion(rest);
    case "version":
      process.stdout.write(`ferry ${VERSION} (${COMMIT}) ${DATE}\n`);
      return;
    case "help":
      usage();
      return;
  }
}

try {
  await main(process.argv.slice(2));
  stdinLines.close();
} catch (e) {
  if (e instanceof ExitError) process.exit(e.code);
  process.stderr.write(paint("31", "error: ") + (e instanceof Error ? e.message : String(e)) + "\n");
  process.exit(1);
}
