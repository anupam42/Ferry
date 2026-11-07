import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";

import { dataDir, defaults, inWindow, normalize, pairID, pairToYAMLObject, SAMPLE, windowLabel, type Pair, type Settings } from "../config.ts";
import { diff, diffText } from "../difftext.ts";
import {
  Engine, pendingRequests, queueResolve, readStatuses, resolveOffline, runningPID, savedPairs, summarizeStatus,
  type PairStatus, type SavedPair,
} from "../engine/engine.ts";
import { backupDir, fromSlash, listBackups, pruneBackups, restoreBackup } from "../engine/fsops.ts";
import { allHistory, batchTime, counts, undo, type Batch } from "../engine/journal.ts";
import { parseChoice, type Change, type Kind } from "../engine/types.ts";
import { probeWatcher } from "../engine/watch.ts";
import * as gitx from "../gitx.ts";
import { Printer } from "../printer.ts";
import { which } from "../proc.ts";
import * as remote from "../remote.ts";
import * as service from "../service.ts";
import { ExitError, fmtDateHM, fmtDateTime, formatDuration, humanSize, parseDuration, parseSize, parseTime } from "../util.ts";
import { confirm, modeArrow, orDash, out, paint, printDiff, println, relTo, stdinIsTTY, VERSION } from "./common.ts";
import { FlagError, FlagSet, HelpRequested } from "./flags.ts";
import { loadPairs, newRunFlags } from "./runflags.ts";

/** Parses flags; null means help was shown. */
function parse(f: FlagSet, args: string[]): string[] | null {
  try {
    return f.parse(args);
  } catch (e) {
    if (e instanceof HelpRequested) return null;
    if (e instanceof FlagError) throw new ExitError(2);
    throw e;
  }
}

function printJSON(v: unknown): void {
  println(JSON.stringify(v, null, 2));
}

function pairFromArgs(source: string, target: string): Pair {
  const p = defaults();
  p.source = source;
  p.target = target;
  normalize(p);
  return p;
}

// ---------- init ----------

export function cmdInit(args: string[]): void {
  const file = args[0] ?? "ferry.yaml";
  if (fs.existsSync(file)) throw new Error(`${file} already exists`);
  fs.writeFileSync(file, SAMPLE);
  println(`wrote ${file} — edit the pairs, then run: ferry --config ${file}`);
}

// ---------- status ----------

export function cmdStatus(args: string[]): void {
  const f = new FlagSet("status").bool("json", false, "print JSON").bool("running", false, "only pairs that are running now");
  if (!parse(f, args)) return;
  const list = readStatuses(dataDir()).filter((s) => !f.getBool("running") || s.running);
  if (f.getBool("json")) return printJSON(list);
  if (list.length === 0) {
    println("no pairs have run yet (start one with: ferry <source> <target>)");
    return;
  }
  for (const s of list) printPairStatus(s);
}

function printPairStatus(s: PairStatus): void {
  let icon = paint("90", "○");
  if (s.running) {
    if (s.conflicts.length > 0) icon = paint("1;31", "!");
    else if (s.paused || (s.pending_batch ?? 0) > 0) icon = paint("33", "‖");
    else icon = paint("32", "●");
  }
  println(`${icon} ${paint("1", s.name)}  ${s.source} ${modeArrow(s.mode)} ${s.remote || s.target}`);
  const parts = s.running ? [s.state, `pid ${s.pid}`] : [s.state, "last seen " + ago(parseTime(s.updated_at))];
  const last = parseTime(s.last_sync);
  if (last) parts.push("last sync " + ago(last));
  parts.push(`+${s.added} ~${s.updated} -${s.deleted} ↻${s.renamed}`);
  if (s.failed > 0) parts.push(paint("31", `${s.failed} failed`));
  println("    " + paint("90", parts.join(" · ")));
  if (s.is_git) {
    let g = `git ⎇ ${orDash(s.branch ?? "")} · ${s.uncommitted} uncommitted`;
    if (s.staged > 0) g += ` · ${s.staged} staged`;
    println("    " + paint("90", g));
  }
  for (const c of s.conflicts) println("    " + paint("1;31", "! ") + c);
}

function ago(t: number): string {
  if (!t) return "never";
  const d = Date.now() - t;
  if (d < 60_000) return "just now";
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  return fmtDateHM(new Date(t));
}

// ---------- plan ----------

export function cmdPlan(args: string[]): void {
  const f = newRunFlags("plan")
    .string("format", "text", "text | markdown | json")
    .bool("diff", false, "include a diff for every changed file");
  f.usage = () => {
    process.stderr.write("Usage: ferry plan [--diff] [--format text|markdown|json] [run flags] <source> <target> | --config file\n");
    f.printDefaults();
  };
  const pos = parse(f, args);
  if (!pos) return;
  if (f.getBool("no-color")) out.color = false;
  const { pairs } = loadPairs(f, pos);
  interface PairPlan {
    pair: string;
    source: string;
    target: string;
    mode: string;
    changes: Change[];
    diffs?: Record<string, string>;
  }
  const plans: PairPlan[] = [];
  let total = 0;
  for (const p of pairs) {
    const e = new Engine(p, null);
    let changes: Change[];
    try {
      changes = e.plan();
    } catch (err) {
      throw new Error(`${p.name}: ${(err as Error).message}`);
    }
    const pp: PairPlan = { pair: p.name, source: p.source, target: p.remote || p.target, mode: p.mode, changes };
    if (f.getBool("diff")) {
      pp.diffs = {};
      for (const c of changes) {
        const d = planDiff(e, c);
        if (d) pp.diffs[c.path] = d;
      }
    }
    total += changes.length;
    plans.push(pp);
  }

  const format = f.getString("format");
  if (format === "json") return printJSON(plans);
  if (format === "markdown" || format === "md") {
    println("# Ferry plan");
    println(`\n_${fmtDateHM(new Date())} · ${total} change(s)_`);
    for (const pp of plans) {
      println(`\n## ${pp.pair}\n\n\`${pp.source}\` ${modeArrow(pp.mode)} \`${pp.target}\` (${pp.mode})\n`);
      if (pp.changes.length === 0) {
        println("Nothing to do.");
        continue;
      }
      println("| Change | File | Direction | Note |");
      println("|---|---|---|---|");
      for (const c of pp.changes) {
        let file = "`" + c.path + "`";
        if (c.to) file += " → `" + c.to + "`";
        println(`| ${c.kind} | ${file} | ${c.dir ?? ""} | ${c.note ?? ""} |`);
      }
      for (const c of pp.changes) {
        const d = pp.diffs?.[c.path];
        if (d) println(`\n<details><summary><code>${c.path}</code></summary>\n\n\`\`\`diff\n${d}\`\`\`\n\n</details>`);
      }
    }
    return;
  }
  for (const pp of plans) {
    println(`${paint("1", pp.pair)}  ${pp.source} ${modeArrow(pp.mode)} ${pp.target}`);
    if (pp.changes.length === 0) {
      println(paint("90", "  nothing to do"));
      continue;
    }
    for (const c of pp.changes) {
      const [sym, code] = planSymbol(c.kind);
      let line = "  " + paint(code, sym) + " ";
      if (c.dir) line += paint("90", c.dir) + " ";
      line += c.path;
      if (c.to) line += " → " + c.to;
      if (c.note) line += paint("90", "  " + c.note);
      println(line);
      const d = pp.diffs?.[c.path];
      if (d) {
        for (let l of d.replace(/\n+$/, "").split("\n")) {
          if (l.startsWith("@@")) l = paint("36", l);
          else if (l.startsWith("+")) l = paint("32", l);
          else if (l.startsWith("-")) l = paint("31", l);
          println("      " + l);
        }
      }
    }
  }
  println(paint("90", `${total} change(s); nothing was written`));
}

function planSymbol(k: Kind): [string, string] {
  switch (k) {
    case "add": return ["+", "32"];
    case "delete": return ["-", "31"];
    case "rename": return ["↻", "35"];
    case "conflict": return ["!", "1;31"];
    case "kept": return ["◇", "34"];
  }
  return ["~", "33"];
}

/** The diff a planned change would cause, as unified text. */
function planDiff(e: Engine, c: Change): string {
  const read = (p: string) => {
    try {
      return fs.readFileSync(p);
    } catch {
      return Buffer.alloc(0);
    }
  };
  const none = Buffer.alloc(0);
  const src = e.sourcePath(c.path), dst = e.targetPath(c.path);
  let a: Buffer, b: Buffer;
  if (c.kind === "add") [a, b] = [none, read(c.dir === "←" ? dst : src)];
  else if (c.kind === "delete") [a, b] = [read(c.dir === "←" ? src : dst), none];
  else if (c.kind === "update" && c.dir === "←") [a, b] = [read(src), read(dst)];
  else if (c.kind === "update" || c.kind === "conflict") [a, b] = [read(dst), read(src)];
  else return "";
  return diffText(diff(a, b, 3));
}

// ---------- commit ----------

export async function cmdCommit(args: string[]): Promise<void> {
  const f = new FlagSet("commit")
    .string("m", "", "commit message (default: summary of changed files)")
    .bool("push", false, "push after committing")
    .bool("sign", false, "sign the commit (git commit -S)")
    .string("author", "", 'commit author, "Name <email>"');
  const pos = parse(f, args);
  if (!pos) return;
  const dir = pos[0] ?? ".";
  if (!(await gitx.isRepo(dir))) throw new Error(`${dir} is not a git repository`);
  const lines = await gitx.status(dir).catch(() => [] as string[]);
  if (lines.length === 0) {
    println("nothing to commit");
    return;
  }
  const msg = f.getString("m") || "sync: " + summarizeStatus(lines);
  const hash = await gitx.commitAll(dir, msg, { author: f.getString("author"), sign: f.getBool("sign") });
  println(`${paint("32", "committed")} ${hash} ${msg}`);
  if (f.getBool("push")) {
    await gitx.push(dir);
    println(paint("32", "pushed ") + (await gitx.currentBranch(dir)));
  }
}

// ---------- diff ----------

export async function cmdDiff(args: string[]): Promise<void> {
  const f = new FlagSet("diff").bool("sides", false, "compare target vs source instead of HEAD vs target");
  const pos = parse(f, args);
  if (!pos) return;
  if (pos.length !== 3) throw new Error("usage: ferry diff [--sides] <source> <target> <file>");
  const p = pairFromArgs(pos[0]!, pos[1]!);
  const { title, lines } = await new Engine(p, null).diff(relTo(p, pos[2]!), f.getBool("sides"));
  printDiff(title, lines);
}

// ---------- backups ----------

export function cmdBackups(args: string[]): void {
  if (args.length === 0) throw new Error("usage: ferry backups list|restore|prune <source> <target> [file]");
  const sub = args[0]!;
  const f = new FlagSet("backups")
    .int("version", 1, "which version to restore (1 = newest)")
    .string("to", "", "restore to this path instead of the original location")
    .string("older-than", "", "prune: delete versions older than this (e.g. 30d)")
    .string("max-size", "", "prune: delete the oldest versions past this total per pair (e.g. 1GB)");
  const pos = parse(f, args.slice(1));
  if (!pos) return;
  if (sub === "prune") return backupsPrune(pos, f.getString("older-than"), f.getString("max-size"));
  if (pos.length < 2) throw new Error("expected <source> <target>");
  const p = pairFromArgs(pos[0]!, pos[1]!);
  const file = pos.length > 2 ? relTo(p, pos[2]!) : "";
  const list = listBackups(dataDir(), pairID(p), file);
  if (sub === "list") {
    if (list.length === 0) {
      println("no backups");
      return;
    }
    let last = "", n = 0;
    for (const b of list) {
      if (b.side + b.rel !== last) {
        last = b.side + b.rel;
        n = 0;
        println(`${paint("1", b.rel)} ${paint("90", "(" + b.side + ")")}`);
      }
      n++;
      println(`   ${n}. ${b.time ? fmtDateTime(new Date(b.time)) : b.version}  ${humanSize(b.size)}`);
    }
    println(paint("90", "stored in " + backupDir(dataDir(), pairID(p))));
    return;
  }
  if (sub === "restore") {
    if (file === "") throw new Error("restore needs a file");
    const ver = f.getInt("version");
    if (list.length < ver || ver < 1) throw new Error(`no version ${ver} for ${file} (${list.length} available)`);
    const b = list[ver - 1]!;
    const dest = f.getString("to") || path.join(b.side === "source" ? p.source : p.target, fromSlash(b.rel));
    restoreBackup(dataDir(), pairID(p), b, dest, p.backups);
    println(`${paint("32", "restored")} ${b.rel} from ${fmtDateTime(new Date(b.time))} → ${dest}`);
    return;
  }
  throw new Error("usage: ferry backups list|restore|prune ...");
}

function backupsPrune(pos: string[], olderThan: string, maxSize: string): void {
  let age: number, size: number;
  try {
    age = parseDuration(olderThan);
  } catch (e) {
    throw new Error(`--older-than: ${(e as Error).message}`);
  }
  try {
    size = parseSize(maxSize);
  } catch (e) {
    throw new Error(`--max-size: ${(e as Error).message}`);
  }
  if (age <= 0 && size <= 0) throw new Error("give --older-than (e.g. 30d) and/or --max-size (e.g. 1GB)");
  let ids: string[];
  if (pos.length >= 2) ids = [pairID(pairFromArgs(pos[0]!, pos[1]!))];
  else {
    try {
      ids = fs.readdirSync(dataDir(), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    } catch {
      ids = [];
    }
  }
  let total = 0, freed = 0;
  for (const id of ids) {
    const r = pruneBackups(dataDir(), id, age, size);
    total += r.removed;
    freed += r.freed;
  }
  println(`${paint("32", "✓")} removed ${total} backup version(s), freed ${humanSize(freed)}`);
}

// ---------- service ----------

export async function cmdService(args: string[]): Promise<void> {
  const usageErr = new Error("usage: ferry service install|uninstall|start|stop|status|logs");
  if (args.length === 0) throw usageErr;
  switch (args[0]) {
    case "install": {
      const f = newRunFlags("service install");
      const pos = parse(f, args.slice(1));
      if (!pos) return;
      let cfg = f.getString("config");
      if (cfg === "") {
        if (pos.length !== 2) throw new Error("usage: ferry service install --config ferry.yaml | <source> <target> [--two-way --delete ...]");
        const { pairs, settings } = loadPairs(f, pos);
        cfg = path.join(dataDir(), "service.yaml");
        writeServiceConfig(cfg, pairs[0]!, settings);
      }
      const where = await service.install(cfg);
      println(`${paint("32", "✓")} background service installed (${where})\n  config: ${cfg}\n  log:    ${service.logPath()}`);
      return;
    }
    case "uninstall":
      await service.uninstall();
      println(paint("32", "✓") + " service removed");
      return;
    case "start":
      return service.start();
    case "stop":
      return service.stop();
    case "status":
      println(await service.status());
      return;
    case "logs": {
      const n = parseInt(args[1] ?? "", 10);
      for (const l of service.logs(Number.isNaN(n) ? 50 : n)) println(l);
      return;
    }
  }
  throw usageErr;
}

function writeServiceConfig(file: string, p: Pair, s: Settings): void {
  const doc: Record<string, unknown> = { pairs: [pairToYAMLObject({ ...p, dryRun: false })] };
  if (s.serve) doc.serve = s.serve;
  if (s.serveToken) doc.serve_token = s.serveToken;
  if (s.webhooks.length > 0) doc.webhooks = s.webhooks;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "# generated by ferry service install\n" + YAML.stringify(doc), { mode: 0o600 });
}

// ---------- conflicts / resolve ----------

export async function cmdConflicts(args: string[]): Promise<void> {
  const f = new FlagSet("conflicts").bool("diff", false, "show a diff (target vs source) for each conflict");
  if (!parse(f, args)) return;
  let total = 0;
  for (const sp of savedPairs(dataDir())) {
    if (sp.conflicts.length === 0) continue;
    const run = sp.pid > 0 ? paint("32", `running (pid ${sp.pid})`) : paint("90", "not running");
    println(`${paint("1", sp.pair.name)}  ${sp.pair.source} ⇄ ${sp.pair.target}  ${run}`);
    const e = new Engine(sp.pair, null);
    for (const c of sp.conflicts) {
      total++;
      println(`  ${paint("1;31", "!")} ${c}`);
      if (f.getBool("diff")) {
        const { title, lines } = await e.diff(c, true);
        printDiff(title, lines);
      }
    }
  }
  if (total === 0) {
    println("no conflicts");
    return;
  }
  println(paint("90", "\nresolve with: ferry resolve <file> --keep source|target|newer|both|merge   (or --all)"));
}

export async function cmdResolve(args: string[]): Promise<void> {
  const f = new FlagSet("resolve")
    .string("keep", "", "source | target | newer | both | merge")
    .bool("all", false, "resolve every conflict (of --pair, or of all pairs)")
    .string("pair", "", "pair name, when files are ambiguous");
  const pos = parse(f, args);
  if (!pos) return;
  const choice = parseChoice(f.getString("keep"));
  if (!choice) throw new Error("usage: ferry resolve <file>... --keep source|target|newer|both|merge [--all] [--pair NAME]");
  const all = f.getBool("all"), pairName = f.getString("pair");
  if (!all && pos.length === 0) throw new Error("name the conflicted file(s), or use --all");

  const cands: SavedPair[] = savedPairs(dataDir()).filter((sp) => sp.conflicts.length > 0 && (pairName === "" || sp.pair.name === pairName));
  if (cands.length === 0) {
    println("no conflicts to resolve");
    return;
  }
  // pair ID → files to resolve
  const todo = new Map<string, string[]>();
  if (all) for (const sp of cands) todo.set(sp.id, sp.conflicts);
  else {
    for (const file of pos) {
      const hits: SavedPair[] = [];
      for (const sp of cands) {
        const rel = relTo(sp.pair, file);
        if (sp.conflicts.includes(rel)) {
          hits.push(sp);
          todo.set(sp.id, [...(todo.get(sp.id) ?? []), rel]);
        }
      }
      if (hits.length === 0) throw new Error(`${file} is not a conflict (see: ferry conflicts)`);
      if (hits.length > 1) throw new Error(`${file} is a conflict in several pairs; add --pair NAME`);
    }
  }

  const printer = new Printer({ color: out.color });
  for (const sp of cands) {
    const files = todo.get(sp.id) ?? [];
    if (files.length === 0) continue;
    for (const rel of files) queueResolve(dataDir(), sp.id, rel, choice);
    const pid = runningPID(dataDir(), sp.id);
    if (pid) {
      const deadline = Date.now() + 8000;
      while (pendingRequests(dataDir(), sp.id) > 0 && Date.now() < deadline) await Bun.sleep(200);
      if (pendingRequests(dataDir(), sp.id) === 0) {
        println(`${paint("32", "✓")} ${files.length} conflict(s) in ${sp.pair.name} resolved by the running ferry (pid ${pid}): kept ${choice}`);
      } else {
        println(`${paint("33", "…")} queued for ${sp.pair.name}; the running ferry (pid ${pid}) will apply it shortly`);
      }
      continue;
    }
    await resolveOffline(dataDir(), sp.id, printer.handle);
  }
}

// ---------- history / undo ----------

function pickBatches(pairName: string): Batch[] {
  return allHistory(dataDir()).filter((b) => pairName === "" || b.pair === pairName);
}

export function cmdHistory(args: string[]): void {
  const f = new FlagSet("history")
    .string("pair", "", "only this pair")
    .int("n", 20, "how many batches to show")
    .bool("json", false, "print JSON");
  if (!parse(f, args)) return;
  const list = pickBatches(f.getString("pair")).slice(0, Math.max(0, f.getInt("n")));
  if (f.getBool("json")) return printJSON(list);
  if (list.length === 0) {
    println("no sync batches recorded yet");
    return;
  }
  for (const b of list) {
    const c = counts(b);
    let head = `${fmtDateTime(new Date(batchTime(b)))}  ${paint("1", b.pair)}  +${c.add} ~${c.update} -${c.del} ↻${c.rename}`;
    if (b.undone) head += paint("90", "  (undone)");
    println(head + paint("90", "  id " + b.id));
    b.entries.slice(0, 5).forEach((en) => println(`     ${en.op} ${en.path}${en.to ? " → " + en.to : ""}${paint("90", " (" + en.side + ")")}`));
    if (b.entries.length > 5) println(paint("90", `     … ${b.entries.length - 5} more`));
  }
  println(paint("90", "\nundo the newest with: ferry undo   (or ferry undo --batch ID)"));
}

export async function cmdUndo(args: string[]): Promise<void> {
  const f = new FlagSet("undo")
    .string("pair", "", "only this pair")
    .string("batch", "", "undo this batch (see ferry history) instead of the newest")
    .bool("yes", false, "don't ask for confirmation");
  if (!parse(f, args)) return;
  const batchID = f.getString("batch");
  const target = pickBatches(f.getString("pair")).find((b) => (batchID === "" && !b.undone) || b.id === batchID);
  if (!target) {
    if (batchID !== "") throw new Error(`no batch ${batchID} (see: ferry history)`);
    println("nothing to undo");
    return;
  }
  const c = counts(target);
  println(`${paint("1", "undo")} batch from ${fmtDateTime(new Date(batchTime(target)))} in ${target.pair}: +${c.add} ~${c.update} -${c.del} ↻${c.rename}`);
  target.entries.slice(0, 20).forEach((en) => println(`   ${undoVerb(en.op)} ${en.path} ${paint("90", "(" + en.side + ")")}`));
  if (target.entries.length > 20) println(`   … and ${target.entries.length - 20} more`);
  if (!f.getBool("yes")) {
    if (!stdinIsTTY()) throw new Error("re-run with --yes to confirm");
    if (!(await confirm("Undo these changes? (current versions are backed up first) [y/N] "))) {
      println("nothing changed");
      return;
    }
  }
  const { done, problems } = undo(dataDir(), target, 5);
  println(`${paint("32", "✓")} reverted ${done.length} change(s)`);
  for (const p of problems) println(paint("33", "  ! ") + p);
  println(paint("90", "  In two-way mode the reverted files sync back to the other side. In one-way mode the source keeps your edits; they are copied again only if the file changes or on a full resync."));
}

function undoVerb(op: string): string {
  if (op === "add") return "remove";
  if (op === "rename") return "rename back";
  return "restore";
}

// ---------- doctor ----------

export async function cmdDoctor(args: string[]): Promise<void> {
  const f = newRunFlags("doctor");
  const pos = parse(f, args);
  if (!pos) return;
  if (f.getBool("no-color")) out.color = false;
  let fails = 0, warns = 0;
  const ok = (msg: string) => println(paint("32", "  ✓ ") + msg);
  const muted = (msg: string) => println(paint("90", "  · " + msg));
  const warn = (msg: string, fix = "") => {
    warns++;
    println(paint("33", "  ! ") + msg);
    if (fix) println(paint("90", "      → " + fix));
  };
  const fail = (msg: string, fix = "") => {
    fails++;
    println(paint("31", "  ✗ ") + msg);
    if (fix) println(paint("90", "      → " + fix));
  };
  const have = (name: string) => which(name) !== null;

  println(paint("1", "ferry " + VERSION) + paint("90", ` on ${process.platform}/${process.arch} (bun ${Bun.version})`));
  println(paint("1", "\nTools"));
  if (gitx.available()) {
    ok(await gitx.version());
    const [name, email] = await Promise.all([gitx.configGet(".", "user.name"), gitx.configGet(".", "user.email")]);
    if (name === "" || email === "") {
      warn("git user.name / user.email are not set; commits will fail", `git config --global user.name "You" && git config --global user.email you@example.com`);
    } else ok(`git identity: ${name} <${email}>`);
    if (await gitx.lfsAvailable(".")) ok("git-lfs installed (lfs: true works)");
    else muted("git-lfs not installed (only needed for lfs: true)");
  } else {
    fail("git is not on PATH; git features (commit, branch, guard, diff vs HEAD) are off", "install git from https://git-scm.com");
  }
  if (have("gh")) ok("gh CLI installed (pr: true works)");
  else muted("gh CLI not installed (only needed for pr: true)");
  if (have("ssh")) ok("ssh installed (remote targets work)");
  else muted("ssh not installed (only needed for user@host:path targets)");
  if (process.platform === "linux") {
    if (have("notify-send")) ok("desktop notifications via notify-send");
    else warn("notify-send not found; desktop notifications are off", "install libnotify-bin (Debian/Ubuntu) or libnotify (Fedora/Arch)");
  } else if (process.platform === "darwin") ok("desktop notifications via osascript");
  else if (process.platform === "win32") {
    if (have("powershell")) ok("desktop notifications via PowerShell toasts");
    else warn("powershell not found; desktop notifications are off");
  }

  println(paint("1", "\nData folder"));
  const dd = dataDir();
  try {
    fs.mkdirSync(dd, { recursive: true });
    const probe = path.join(dd, `doctor-${process.pid}`);
    fs.writeFileSync(probe, "");
    fs.rmSync(probe);
    ok(dd);
  } catch (e) {
    fail(`${dd} is not writable: ${(e as Error).message}`, "set FERRY_HOME to a writable folder");
  }
  const held = savedPairs(dd).reduce((n, sp) => n + sp.conflicts.length, 0);
  if (held > 0) warn(`${held} conflict(s) waiting for a decision`, "ferry conflicts");

  println(paint("1", "\nBackground service"));
  if (await service.isInstalled()) ok("installed — " + (await service.status()).trim().split("\n")[0]);
  else muted("not installed (ferry service install --config ferry.yaml)");

  println(paint("1", "\nPairs"));
  let pairs: Pair[] = [];
  try {
    if (f.getString("config") !== "" || pos.length > 0) pairs = loadPairs(f, pos).pairs;
    else if (fs.existsSync("ferry.yaml")) {
      const g = newRunFlags("doctor");
      g.parse(["--config", "ferry.yaml", ...args]);
      pairs = loadPairs(g, []).pairs;
    } else muted("no ferry.yaml here; pass --config FILE or <source> <target> to check pairs");
  } catch (e) {
    if (e instanceof ExitError) throw e;
    fail("config: " + (e as Error).message, "fix the config, or run ferry init for a commented example");
  }
  for (const p of pairs) {
    println("  " + paint("1", p.name));
    await doctorPair(p, ok, warn, fail);
  }

  println();
  if (fails > 0) {
    println(paint("31", `${fails} problem(s), ${warns} warning(s)`));
    throw new ExitError(1);
  }
  println(warns > 0 ? paint("33", `no problems, ${warns} warning(s)`) : paint("32", "all good"));
}

async function doctorPair(p: Pair, ok: (m: string) => void, warn: (m: string, fix?: string) => void, fail: (m: string, fix?: string) => void): Promise<void> {
  const ind = (s: string) => "  " + s;
  if (p.remote !== "") {
    let sp: remote.Spec;
    try {
      sp = remote.parse(p.remote);
    } catch (e) {
      return fail(ind((e as Error).message));
    }
    const r = await sp.run(`mkdir -p ${sp.dir()} && test -w ${sp.dir()} && command -v tar`, { timeoutMs: 20_000 });
    if (r.code !== 0) {
      fail(ind(`can't reach ${p.remote}: ${(r.output + " " + (r.error ?? "")).trim().split("\n")[0]}`), `check that \`ssh ${sp.host}\` works without a password prompt (ssh keys or agent)`);
    } else ok(ind(`ssh to ${sp.host} works and the folder is writable`));
    if (await gitx.isRepo(p.remote)) ok(ind("remote target is a git repo"));
  } else if (!fs.existsSync(p.target)) {
    warn(ind(`target ${p.target} doesn't exist yet`), "it will be created on the first run");
  } else if (await gitx.isRepo(p.target)) {
    ok(ind(`target is a git repo (branch ${orDash(await gitx.currentBranch(p.target))})`));
    const r = await gitx.inProgress(p.target);
    if (r !== "") warn(ind(`target has a ${r}; ferry pauses until it's finished`), "finish or abort it in the target repo");
  } else {
    warn(ind("target is not a git repo; commit features are off"), "git init " + p.target);
  }
  if (p.every > 0) ok(ind(`syncs every ${formatDuration(p.every)} (no file watcher)`));
  else {
    const roots = p.mode === "two-way" ? [p.source, p.target] : [p.source];
    for (const r of roots) {
      if (!fs.existsSync(r)) continue;
      try {
        const dirs = probeWatcher(r);
        if (r.replaceAll("\\", "/").startsWith("/mnt/") && process.env.WSL_DISTRO_NAME) {
          warn(ind(`${r} is a Windows drive inside WSL; native events don't arrive there`), "use --watcher poll, or keep the folder inside the Linux filesystem");
        } else {
          ok(ind(`native file events work for ${r} (${dirs} folders)`));
          const limit = inotifyLimit();
          if (limit > 0 && dirs > (limit * 8) / 10) {
            warn(ind(`${dirs} folders is close to the inotify limit of ${limit}`), "sudo sysctl fs.inotify.max_user_watches=524288");
          }
        }
      } catch (e) {
        const msg = (e as Error).message;
        const fix = /too many|no space/i.test(msg)
          ? "raise the limit: sudo sysctl fs.inotify.max_user_watches=524288"
          : "network drives and some containers don't send events; polling works everywhere";
        warn(ind(`native file events unavailable for ${r} (${msg}); ferry will poll`), fix);
      }
    }
  }
  if (p.window !== "" || p.days.length > 0) {
    ok(ind(`sync window ${windowLabel(p)} — ${inWindow(p) ? "inside it now" : "outside it now, so syncing is paused"}`));
  }
  if (p.secrets === "off") warn(ind("secret scanning is off"), "secrets: warn (or block)");
  if (p.lfs && !(await gitx.lfsAvailable("."))) warn(ind("lfs: true but git-lfs is not installed"), "https://git-lfs.com");
  if (p.pr && !which("gh")) warn(ind("pr: true but the gh CLI is not installed"), "https://cli.github.com");
}

function inotifyLimit(): number {
  if (os.platform() !== "linux") return 0;
  try {
    return parseInt(fs.readFileSync("/proc/sys/fs/inotify/max_user_watches", "utf8").trim(), 10) || 0;
  } catch {
    return 0;
  }
}
