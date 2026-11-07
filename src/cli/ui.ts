// ferry ui: sync in the background and manage everything from a web page.
//
// Pairs come from --config, <source> <target>, ./ferry.yaml, or the web
// app's own config (<data dir>/ui.yaml), which is where pairs added in the
// browser are saved when no other config file is in use.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ApiServer, type PairManager } from "../api.ts";
import {
  appendPairToFile, checkOverlaps, dataDir, expandHome, isRemoteSpec, loadFile, normalize, pairsFromObject, removePairFromFile,
  type Pair, type Settings, emptySettings,
} from "../config.ts";
import { Engine } from "../engine/engine.ts";
import type { Event } from "../engine/types.ts";
import { notifySettings } from "../notify.ts";
import { Printer } from "../printer.ts";
import { isMac, isWindows, startDetached } from "../proc.ts";
import { ExitError } from "../util.ts";
import { Dispatcher } from "../webhook.ts";
import { out, paint, println, VERSION } from "./common.ts";
import { FlagError, HelpRequested } from "./flags.ts";
import { applyFlags, loadPairs, newRunFlags, settingsFrom } from "./runflags.ts";

/** The config the web app owns when the user didn't name one. */
export function uiConfigPath(): string {
  return path.join(dataDir(), "ui.yaml");
}

export async function cmdUI(args: string[]): Promise<void> {
  const f = newRunFlags("ui")
    .string("host", "127.0.0.1", "address to listen on (anything but localhost needs --serve-token)")
    .int("port", 7878, "port for the web app (the next free one is used if it's taken)")
    .bool("no-open", false, "don't open the browser");
  f.usage = () => {
    process.stderr.write("Usage: ferry ui [flags] [--config file | <source> <target>]\n");
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

  // where pairs come from, and where pairs added in the browser go
  let pairs: Pair[];
  let settings: Settings;
  let configFile = "";
  if (pos.length > 0) {
    ({ pairs, settings } = loadPairs(f, pos));
  } else {
    configFile = f.getString("config") || ["ferry.yaml", "ferry.yml", ".ferry.yaml"].find((c) => fs.existsSync(c)) || uiConfigPath();
    if (fs.existsSync(configFile)) {
      // a clash between saved pairs must not keep the web app from starting:
      // the pair listed later (added last) wins, and the other is set aside
      let dropped: { pair: Pair; reason: string }[];
      ({ pairs, settings, dropped } = loadFile(configFile, { allowEmpty: true, lenient: true }));
      for (const p of pairs) {
        applyFlags(f, p);
        normalize(p);
      }
      const ownFile = path.resolve(configFile) === path.resolve(uiConfigPath());
      for (const d of dropped) {
        const fixed = ownFile && removePairFromFile(configFile, d.pair.name, d.pair);
        println(
          paint("33", "! ") +
            `not starting "${d.pair.name}" (${d.pair.source} → ${d.pair.remote || d.pair.cloud || d.pair.target}): it ${d.reason}` +
            (fixed ? "; removed it from the saved pairs" : `; edit ${configFile} to fix this`),
        );
      }
      settings = settingsFrom(f, settings);
    } else {
      pairs = [];
      settings = settingsFrom(f, emptySettings());
    }
    const only = f.getString("pair");
    if (only !== "") pairs = pairs.filter((p) => p.name === only);
    configFile = path.resolve(configFile);
  }

  const host = f.getString("host");
  const local = ["127.0.0.1", "localhost", "::1"].includes(host);
  if (!local && settings.serveToken === "") {
    throw new Error("--host other than localhost needs --serve-token (or FERRY_TOKEN), so nobody else can control your folders");
  }

  notifySettings.enabled = !f.getBool("no-notify") && (settings.notify === null || settings.notify);
  // the browser answers conflicts, like the dashboard does: "ask" holds them until then
  const printer = new Printer({ color: out.color, quiet: f.getBool("quiet"), showPair: true });
  const hooks = Dispatcher.create(settings.webhooks);
  let api: ApiServer | null = null;
  const emit = (ev: Event) => {
    printer.handle(ev);
    hooks?.handle(ev);
    api?.broadcast(ev);
  };

  const ctl = new AbortController();
  const engines: Engine[] = [];
  const stops = new Map<Engine, { ctl: AbortController; done: Promise<void> }>();
  const start = (p: Pair) => {
    if (p.mirror) {
      p.mirror = false;
      emit({ time: Date.now(), pair: p.name, kind: "warn", msg: "mirror is skipped in the web app (it needs a confirmation); use ferry run --mirror once" });
    }
    const e = new Engine(p, emit);
    const own = new AbortController();
    ctl.signal.addEventListener("abort", () => own.abort(), { once: true });
    const done = e.run(own.signal, false).catch((err) => emit({ time: Date.now(), pair: e.name, kind: "error", msg: (err as Error).message }));
    engines.push(e);
    stops.set(e, { ctl: own, done });
  };

  const manager: PairManager = {
    configFile,
    async add(obj) {
      const clean = cleanPairObject(obj);
      const added = pairsFromObject(clean);
      checkOverlaps([...engines.map((e) => e.cfg), ...added]);
      // save the generated name too, so the pair can be found again to remove it
      if (clean.name === undefined && added.length === 1) clean.name = added[0]!.name;
      if (configFile !== "") appendPairToFile(configFile, clean);
      for (const p of added) start(p);
      return added.map((p) => p.name);
    },
    async remove(name) {
      const e = engines.find((x) => x.name === name);
      if (!e) throw new Error(`no pair named "${name}"`);
      const s = stops.get(e)!;
      s.ctl.abort();
      await s.done;
      engines.splice(engines.indexOf(e), 1);
      stops.delete(e);
      const savedRemoval = configFile !== "" && removePairFromFile(configFile, name, e.cfg);
      emit({ time: Date.now(), pair: name, kind: "info", msg: "stopped syncing this pair" });
      return { savedRemoval };
    },
  };

  api = new ApiServer(engines, settings.serveToken, { version: VERSION, manager });
  let port = f.getInt("port");
  for (let tries = 0; ; tries++) {
    try {
      api.listen(`${host.includes(":") ? `[${host}]` : host}:${port}`);
      break;
    } catch (e) {
      if (tries >= 20 || f.wasSet("port")) throw new Error(`can't listen on port ${port}: ${(e as Error).message}`);
      port++;
    }
  }
  for (const p of pairs) start(p);

  const shown = host === "0.0.0.0" || host === "::" ? "localhost" : host.includes(":") ? `[${host}]` : host;
  let url = `http://${shown}:${port}/`;
  if (settings.serveToken !== "") url += "?token=" + encodeURIComponent(settings.serveToken);
  println(`${paint("1", "ferry " + VERSION)} web app running at ${paint("1;36", url)}`);
  println(paint("90", pairs.length === 0 ? "no folder pairs yet: add one in the browser" : `${pairs.length} pair(s) syncing`));
  if (configFile !== "") println(paint("90", "pairs are saved in " + tildify(configFile)));
  println(paint("90", "keep this window open while you sync; press Ctrl+C to stop"));
  if (!f.getBool("no-open")) openBrowser(url);

  process.on("SIGINT", () => ctl.abort());
  process.on("SIGTERM", () => ctl.abort());
  await new Promise<void>((r) => ctl.signal.addEventListener("abort", () => r(), { once: true }));
  await Promise.all([...stops.values()].map((s) => s.done));
  api.stop();
  println(paint("90", "stopped."));
  process.exit(0);
}

/** Keeps the keys a pair can have, drops empty values, and makes local paths absolute. */
function cleanPairObject(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!/^[a-z_]+$/.test(k)) continue;
    if (v == null || v === "" || (Array.isArray(v) && v.length === 0)) continue;
    out[k] = v;
  }
  const abs = (t: unknown) => {
    if (typeof t !== "string" || t.trim() === "") return t;
    const s = t.trim();
    return isRemoteSpec(s) ? s : path.resolve(expandHome(s));
  };
  if (out.source !== undefined) out.source = abs(out.source);
  if (out.target !== undefined) out.target = abs(out.target);
  if (Array.isArray(out.targets)) out.targets = out.targets.map(abs);
  if (typeof out.source !== "string" || out.source === "") throw new Error("choose a source folder");
  if ((typeof out.target !== "string" || out.target === "") && !Array.isArray(out.targets)) throw new Error("choose a target folder");
  return out;
}

function tildify(p: string): string {
  const h = os.homedir();
  return p.startsWith(h + path.sep) ? "~" + p.slice(h.length) : p;
}

function openBrowser(url: string): void {
  const cmd = isMac ? ["open", url] : isWindows ? ["rundll32", "url.dll,FileProtocolHandler", url] : ["xdg-open", url];
  if (!startDetached(cmd)) println(paint("33", "! ") + "couldn't open a browser; open " + url + " yourself");
}
