import fs from "node:fs";
import path from "node:path";

import { ApiServer } from "../api.ts";
import { Engine } from "../engine/engine.ts";
import { parseChoice, type Choice, type Event } from "../engine/types.ts";
import { notifySettings } from "../notify.ts";
import { Printer, type Sink } from "../printer.ts";
import { ExitError } from "../util.ts";
import { Dispatcher } from "../webhook.ts";
import { ComparingSpinner } from "../relayart.ts";
import { confirm, isTTY, out, paint, printDiff, println, relayStyle, stdinIsTTY, stdinLines, VERSION } from "./common.ts";
import { FlagError, HelpRequested } from "./flags.ts";
import { loadPairs, newRunFlags } from "./runflags.ts";

export async function cmdRun(args: string[]): Promise<void> {
  const f = newRunFlags();
  f.usage = () => {
    process.stderr.write("Usage: ferry run [flags] <source> <target> | --config file\n");
    f.printDefaults();
  };
  let pos: string[];
  try {
    pos = f.parse(args);
  } catch (e) {
    if (e instanceof HelpRequested) return;
    if (e instanceof FlagError) throw new ExitError(2);
    throw e;
  }
  if (f.getBool("no-color")) out.color = false;
  const { pairs, settings } = loadPairs(f, pos);
  const once = f.getBool("once");
  const dryRun = f.getBool("dry-run");

  let uiMode = f.getBool("json") ? "json" : f.getString("ui");
  const tty = isTTY();
  if (uiMode === "auto") uiMode = tty && !once ? "tui" : "plain";
  if (!["tui", "plain", "json"].includes(uiMode)) throw new Error("--ui must be auto, tui, plain or json");
  if (uiMode === "tui" && !tty) throw new Error("--ui tui needs an interactive terminal");

  notifySettings.enabled = !f.getBool("no-notify") && !once && (settings.notify === null || settings.notify);

  // "ask" needs someone to ask: the dashboard, or a prompt in an interactive
  // terminal. Otherwise the pair's headless_conflict policy applies.
  const interactive = uiMode === "tui" || (uiMode === "plain" && tty);
  let asking = false;
  for (const p of pairs) {
    if (p.mode !== "two-way" || p.conflict !== "ask") continue;
    if (interactive) asking = true;
    else p.conflict = p.headlessConflict;
  }

  const pidfile = f.getString("pidfile");
  if (pidfile !== "") {
    fs.mkdirSync(path.dirname(path.resolve(pidfile)), { recursive: true });
    fs.writeFileSync(pidfile, String(process.pid));
    process.on("exit", () => fs.rmSync(pidfile, { force: true }));
  }
  let logSink: Sink | null = null;
  const logPath = f.getString("log");
  if (logPath !== "") {
    fs.mkdirSync(path.dirname(path.resolve(logPath)), { recursive: true });
    const fd = fs.openSync(logPath, "a");
    logSink = { write: (s) => void fs.writeSync(fd, s) };
    process.on("exit", () => fs.closeSync(fd));
  }

  const printer = new Printer({
    log: logSink, color: out.color, quiet: f.getBool("quiet"), json: uiMode === "json",
    showGit: f.getBool("git"), showPair: pairs.length > 1,
  });

  // the dashboard is loaded only when it's used
  const tui = uiMode === "tui" ? await import("../tui/tui.ts") : null;
  let dashboard: InstanceType<NonNullable<typeof tui>["Dashboard"]> | null = null;
  let emit: (ev: Event) => void;
  if (tui) {
    const filePrinter = logSink ? new Printer({ out: logSink, showPair: true, showGit: true }) : null;
    emit = (ev) => {
      filePrinter?.handle(ev);
      dashboard?.addEvent(ev);
    };
  } else {
    emit = printer.handle;
  }

  // plain terminal: Relay shows up while files are compared by content
  const spinner = uiMode === "plain" && tty && !f.getBool("quiet") ? new ComparingSpinner(process.stdout, relayStyle()) : null;
  if (spinner) {
    const base = emit;
    emit = (ev) => {
      spinner.clear(); // printed lines go above Relay, which redraws on its next frame
      base(ev);
    };
  }

  // webhooks and the HTTP API see every event too
  const hooks = Dispatcher.create(settings.webhooks);
  let apiSrv: ApiServer | null = null;
  if (hooks || (settings.serve !== "" && !once)) {
    const base = emit;
    emit = (ev) => {
      base(ev);
      hooks?.handle(ev);
      apiSrv?.broadcast(ev);
    };
  }

  // a plain interactive terminal: ask about conflicts right here
  const byName = new Map<string, Engine>();
  const prompts: Event[] = [];
  let wakePrompter: (() => void) | null = null;
  if (uiMode === "plain" && asking && !once) {
    const base = emit;
    emit = (ev) => {
      base(ev);
      if (ev.kind === "conflict" && ev.held && prompts.length < 256) {
        prompts.push(ev);
        wakePrompter?.();
      }
    };
  }

  const engines = pairs.map((p) => {
    const e = new Engine(p, (ev) => emit(ev));
    byName.set(p.name, e);
    return e;
  });
  if (tui && !once) dashboard = new tui.Dashboard(engines, VERSION, settings.theme);
  if (spinner) {
    const poll = setInterval(() => {
      let done = 0, total = 0, any = false;
      for (const e of engines) {
        const c = e.getStatus().comparing;
        if (!c) continue;
        any = true;
        done += c.done;
        total += c.total;
      }
      if (any) spinner.update(done, total);
      else if (spinner.active) spinner.stop();
    }, 120);
    poll.unref();
    process.on("exit", () => spinner.stop());
  }

  // mirror needs a confirmation before anything runs
  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i]!;
    if (!p.mirror) continue;
    const list = engines[i]!.planMirror();
    if (list.length === 0) continue;
    if (!f.getBool("yes") && !p.dryRun) {
      if (!stdinIsTTY()) {
        throw new Error(`pair "${p.name}": --mirror would delete ${list.length} target files; re-run with --yes to confirm`);
      }
      println(`${paint("1;33", "!")} mirror for ${p.name} will delete ${list.length} file(s) in ${p.target} that are not in the source:`);
      for (let j = 0; j < list.length; j++) {
        if (j === 20) {
          println(`   … and ${list.length - 20} more`);
          break;
        }
        println("   - " + list[j]);
      }
      if (!(await confirm("Delete them? (backups are kept) [y/N] "))) {
        println("mirror skipped");
        continue;
      }
    }
    engines[i]!.approveMirror(list);
  }

  const ctl = new AbortController();
  const stop = () => ctl.abort();
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  if (once) {
    let code = 0, held = 0;
    for (const e of engines) {
      try {
        await e.run(ctl.signal, true);
      } catch (err) {
        emit({ time: Date.now(), pair: e.name, kind: "error", msg: (err as Error).message });
        code = 1;
      }
      const st = e.getStatus();
      if (uiMode !== "json") {
        println(`${paint("36", "done")} ${e.name}: +${st.added} ~${st.updated} -${st.deleted} ↻${st.renamed}, ${st.skipped} skipped, ${st.failed} failed${dryRun ? paint("90", " (dry-run, nothing written)") : ""}`);
      }
      if (st.failed > 0) code = 1;
      for (const rel of e.heldConflicts()) {
        if (asking && uiMode === "plain") {
          const c = await askChoice(e, rel);
          if (c) {
            await e.resolveSync(rel, c);
            continue;
          }
        }
        held++;
      }
    }
    stdinLines.close();
    if (held > 0 && uiMode !== "json") {
      println(`${paint("1;33", "!")} ${held} conflict(s) left as they are. See them with: ferry conflicts`);
    }
    if (code !== 0) throw new ExitError(code);
    if (held > 0) throw new ExitError(3);
    return;
  }

  if (settings.serve !== "") {
    apiSrv = new ApiServer(engines, settings.serveToken);
    try {
      apiSrv.listen(settings.serve);
    } catch (err) {
      emit({ time: Date.now(), pair: "", kind: "error", msg: "HTTP API: " + (err as Error).message });
      apiSrv = null;
    }
  }

  if (uiMode === "plain") {
    for (const p of pairs) {
      const arrow = p.mode === "two-way" ? "⇄" : "→";
      println(`${paint("1", "ferry " + VERSION)} ${paint("90", p.name)}  ${p.source} ${arrow} ${p.remote || p.cloud || p.target}`);
    }
    if (settings.serve !== "") println(paint("90", "HTTP API on http://" + settings.serve));
    println(paint("90", "watching for changes… press Ctrl+C to stop"));
  }

  const running = Promise.all(
    engines.map((e) =>
      e.run(ctl.signal, false).catch((err) => emit({ time: Date.now(), pair: e.name, kind: "error", msg: (err as Error).message })),
    ),
  );

  if (uiMode === "plain" && asking) {
    void (async () => {
      while (!ctl.signal.aborted) {
        const ev = prompts.shift();
        if (!ev) {
          await new Promise<void>((r) => {
            wakePrompter = r;
            ctl.signal.addEventListener("abort", () => r(), { once: true });
          });
          wakePrompter = null;
          continue;
        }
        const e = byName.get(ev.pair);
        if (!e) continue;
        await Bun.sleep(300); // let the sync pass finish printing
        if (!e.getStatus().conflicts.includes(ev.path!)) continue;
        const c = await askChoice(e, ev.path!);
        if (c) e.resolve(ev.path!, c);
      }
    })();
  }

  if (dashboard) {
    await dashboard.run(ctl.signal);
    ctl.abort();
    await running;
    apiSrv?.stop();
    for (const e of engines) {
      const st = e.getStatus();
      println(`${paint("36", "stopped")} ${e.name}: +${st.added} ~${st.updated} -${st.deleted} ↻${st.renamed} this session`);
    }
    process.exit(0);
  }

  await running;
  apiSrv?.stop();
  stdinLines.close();
  if (uiMode !== "json") println(paint("90", "stopped."));
  process.exit(0);
}

/** Prompts on the terminal. null means "decide later". */
async function askChoice(e: Engine, rel: string): Promise<Choice | null> {
  for (;;) {
    process.stdout.write(
      `\n${paint("1;31", "conflict")} ${paint("90", "[" + e.name + "]")} ${paint("1", rel)} changed on both sides.\n` +
        "  [s] keep source  [t] keep target  [n] keep newer  [b] keep both  [m] merge  [d] diff  [l] later: ",
    );
    const line = await stdinLines.read();
    if (line === null) return null;
    const answer = line.trim().toLowerCase();
    if (answer === "d" || answer === "diff") {
      const { title, lines } = await e.diff(rel, true);
      printDiff(title, lines);
      continue;
    }
    if (answer === "l" || answer === "later" || answer === "") {
      println(paint("90", `  left as is. Resolve later with: ferry resolve ${rel} --keep source|target|newer|both|merge`));
      return null;
    }
    const c = parseChoice(answer);
    if (c) return c;
  }
}
