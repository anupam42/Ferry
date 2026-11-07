// The flags shared by run, plan, doctor and service install, and turning them
// plus a config file into pairs.
import fs from "node:fs";

import { checkOverlaps, defaults, loadFile, normalize, emptySettings, type Pair, type Settings } from "../config.ts";
import { ExitError, parseDuration, parseSize } from "../util.ts";
import { usage } from "./usage.ts";
import { FlagSet } from "./flags.ts";

export function newRunFlags(name = "run"): FlagSet {
  const d = defaults();
  return new FlagSet(name)
    .string("config", "", "YAML config with one or more pairs")
    .string("pair", "", "only run the pair with this name (with --config)")
    .string("mode", d.mode, "one-way | two-way")
    .bool("two-way", false, "shorthand for --mode two-way")
    .bool("delete", false, "shorthand for --on-delete propagate")
    .string("on-delete", "keep", "file deleted on one side: keep | restore (two-way) | propagate")
    .string("headless-conflict", d.headlessConflict, "conflicts when nobody can be asked: hold | keep-both | source | target | newer")
    .bool("mirror", false, "on start, delete target files that aren't in source (asks first)")
    .bool("yes", false, "don't ask for confirmation (mirror)")
    .string("conflict", d.conflict, "two-way conflicts: ask | hold | source | target | newer | keep-both")
    .bool("merge", false, "two-way: try a three-way merge of text files before calling it a conflict")
    .multi("ignore", "glob to ignore, gitignore syntax (repeatable)")
    .multi("only", "sync only paths matching this glob, gitignore syntax (repeatable)")
    .bool("no-gitignore", false, "don't read .gitignore files")
    .bool("no-default-ignores", false, "don't apply the built-in ignore list")
    .string("branch", "", "switch to (or create) this branch in the target first")
    .string("auto-commit", "", "enable auto-commit with this message template ({summary} {count} {files} {source} {datetime})")
    .duration("auto-commit-interval", d.autoCommit.interval, "auto-commit interval")
    .bool("push", false, "push after auto-commit")
    .bool("pull-rebase", false, "pull --rebase before pushing")
    .bool("pr", false, "open a pull request after pushing (needs the gh CLI)")
    .string("pr-base", "", "base branch for --pr")
    .string("before-commit", "", 'command that must pass before ferry commits (e.g. "npm test")')
    .bool("sign", false, "sign commits (git commit -S)")
    .string("author", "", 'author for commits made by ferry, "Name <email>"')
    .duration("check-upstream", 0, "fetch every interval and pause while target is behind upstream (e.g. 5m)")
    .bool("auto-pull", false, "with --check-upstream: pull --rebase instead of pausing")
    .bool("no-guard", false, "don't pause while the target is mid merge/rebase")
    .string("max-size", "50MB", "skip files larger than this (0 = no limit)")
    .string("binary", d.binary, "binary files: allow | warn | skip")
    .bool("lfs", false, "track large and binary files with git LFS instead of skipping them")
    .string("secrets", d.secrets, "files that look like credentials: warn | block | off")
    .multi("secret-allow", "glob never flagged as a secret (repeatable)")
    .string("eol", d.eol, "line endings of text files written to the target: keep | lf | crlf")
    .string("symlinks", d.symlinks, "skip | follow | link")
    .int("batch-limit", d.batchLimit, "batches bigger than this wait for activity to settle")
    .string("batch-action", d.batchAction, "large batches: apply | confirm")
    .duration("batch-settle", d.batchSettle, "quiet time required before applying a large batch")
    .int("max-ops", 0, "max file operations per second (0 = unlimited)")
    .int("backups", d.backups, "versions to keep before overwrite/delete (0 = off)")
    .string("backup-max-age", "", "prune backups older than this (e.g. 30d)")
    .string("backup-max-size", "", "prune the oldest backups past this total (e.g. 1GB)")
    .bool("trash", false, "also send deleted files to the OS trash / recycle bin")
    .string("watcher", d.watcher, "auto | native | poll")
    .duration("interval", d.interval, "poll interval")
    .duration("settle", d.settle, "quiet time before applying changes")
    .string("every", "", "sync on a timer instead of watching (e.g. 15m)")
    .string("window", "", "only sync between these times, e.g. 09:00-18:00")
    .string("days", "", "only sync on these days, e.g. mon-fri or sat,sun")
    .string("ui", "auto", "auto | tui | plain | json")
    .bool("json", false, "shorthand for --ui json (NDJSON events on stdout)")
    .string("theme", "", "dashboard colors: auto | dark | light | mono")
    .string("serve", "", "serve the local HTTP API on this address (e.g. 127.0.0.1:7878)")
    .string("serve-token", "", "bearer token required by the HTTP API")
    .multi("webhook", "post conflicts, errors, pauses and commits to this URL (repeatable)")
    .bool("once", false, "sync once and exit")
    .bool("dry-run", false, "show what would change without writing")
    .bool("quiet", false, "plain mode: only summaries, warnings and errors")
    .bool("no-color", false, "disable colors (NO_COLOR is honored too)")
    .bool("no-notify", false, "disable desktop notifications")
    .bool("git", false, "plain mode: print git status after each batch")
    .string("log", "", "also append a plain-text log to this file")
    .string("pidfile", "", "write the process id to this file");
}

/** Copies explicitly-set flags onto p, so config file values win otherwise. */
export function applyFlags(f: FlagSet, p: Pair): void {
  const s = (n: string) => f.getString(n);
  const b = (n: string) => f.getBool(n);
  for (const name of f.setFlags()) {
    switch (name) {
      case "mode": p.mode = s(name); break;
      case "two-way": if (b(name)) p.mode = "two-way"; break;
      case "delete":
        p.delete = b(name);
        if (p.delete) p.onDelete = "propagate";
        else if (p.onDelete === "propagate") p.onDelete = "keep";
        break;
      case "on-delete": p.onDelete = s(name); break;
      case "headless-conflict": p.headlessConflict = s(name); break;
      case "mirror": p.mirror = b(name); break;
      case "conflict": p.conflict = s(name); break;
      case "merge": p.merge = b(name); break;
      case "ignore": p.ignore = [...p.ignore, ...f.getMulti(name)]; break;
      case "only": p.only = [...f.getMulti(name)]; break;
      case "no-gitignore": p.useGitignore = !b(name); break;
      case "no-default-ignores": p.defaultIgnores = !b(name); break;
      case "branch": p.branch = s(name); break;
      case "auto-commit":
        p.autoCommit.enabled = true;
        p.autoCommit.message = s(name);
        break;
      case "auto-commit-interval": p.autoCommit.interval = f.getDuration(name); break;
      case "push": p.autoCommit.push = b(name); break;
      case "pull-rebase": p.pullRebase = b(name); break;
      case "pr": p.pr = b(name); break;
      case "pr-base": p.prBase = s(name); break;
      case "before-commit": p.beforeCommit = s(name); break;
      case "sign": p.signCommits = b(name); break;
      case "author": p.commitAuthor = s(name); break;
      case "check-upstream": p.checkUpstream = f.getDuration(name); break;
      case "auto-pull": p.autoPull = b(name); break;
      case "no-guard": p.gitGuard = !b(name); break;
      case "max-size": p.maxSize = parseSize(s(name)); break;
      case "binary": p.binary = s(name); break;
      case "lfs": p.lfs = b(name); break;
      case "secrets": p.secrets = s(name); break;
      case "secret-allow": p.secretAllow = [...p.secretAllow, ...f.getMulti(name)]; break;
      case "eol": p.eol = s(name); break;
      case "symlinks": p.symlinks = s(name); break;
      case "batch-limit": p.batchLimit = f.getInt(name); break;
      case "batch-action": p.batchAction = s(name); break;
      case "batch-settle": p.batchSettle = f.getDuration(name); break;
      case "max-ops": p.maxOpsPerSec = f.getInt(name); break;
      case "backups": p.backups = f.getInt(name); break;
      case "backup-max-age": p.backupMaxAge = parseDuration(s(name)); break;
      case "backup-max-size": p.backupMaxSize = parseSize(s(name)); break;
      case "trash": p.trash = b(name); break;
      case "watcher": p.watcher = s(name); break;
      case "interval": p.interval = f.getDuration(name); break;
      case "settle": p.settle = f.getDuration(name); break;
      case "every": p.every = parseDuration(s(name)); break;
      case "window": p.window = s(name); break;
      case "days": p.days = s(name).split(","); break;
    }
  }
  p.dryRun = f.getBool("dry-run");
}

/** Merges top-level flags over the config file's settings. */
export function settingsFrom(f: FlagSet, s: Settings): Settings {
  s = { ...s, webhooks: [...s.webhooks] };
  if (f.getString("serve")) s.serve = f.getString("serve");
  if (f.getString("serve-token")) s.serveToken = f.getString("serve-token");
  if (f.getString("theme")) s.theme = f.getString("theme");
  for (const url of f.getMulti("webhook")) s.webhooks.push({ url });
  if (s.serveToken === "") s.serveToken = process.env.FERRY_TOKEN ?? "";
  return s;
}

/** Pairs from --config (or ./ferry.yaml) or from <source> <target>, with the flags applied. */
export function loadPairs(f: FlagSet, pos: string[]): { pairs: Pair[]; settings: Settings } {
  let pairs: Pair[];
  let settings = emptySettings();
  let cfgPath = f.getString("config");
  if (cfgPath === "" && pos.length === 0) {
    cfgPath = ["ferry.yaml", "ferry.yml", ".ferry.yaml"].find((c) => fs.existsSync(c)) ?? "";
    if (cfgPath === "") {
      usage();
      throw new ExitError(2);
    }
  }
  if (cfgPath !== "") {
    if (pos.length > 0) throw new Error("use either --config or <source> <target>, not both");
    ({ pairs, settings } = loadFile(cfgPath));
    const only = f.getString("pair");
    if (only !== "") {
      pairs = pairs.filter((p) => p.name === only);
      if (pairs.length === 0) throw new Error(`no pair named "${only}" in ${cfgPath}`);
    }
  } else {
    if (pos.length !== 2) throw new Error("expected <source> <target>");
    const p = defaults();
    p.source = pos[0]!;
    p.target = pos[1]!;
    pairs = [p];
  }
  for (const p of pairs) {
    applyFlags(f, p);
    normalize(p);
  }
  checkOverlaps(pairs);
  return { pairs, settings: settingsFrom(f, settings) };
}
