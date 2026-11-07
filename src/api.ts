// A small local HTTP API for editors and scripts:
//
//   GET  /status                     every pair's status (JSON)
//   GET  /events                     live events (server-sent events)
//   GET  /pairs/{name}/diff?path=…   diff of one file (text); &conflict=1 for target vs source
//   GET  /pairs/{name}/history       recorded sync batches (JSON)
//   POST /pairs/{name}/pause|resume|resync|approve
//   POST /pairs/{name}/commit        ?message=…&push=1
//   POST /pairs/{name}/resolve       {"path": "...", "choice": "source|target|newer|both|merge"}
//   POST /pairs/{name}/undo          undo the last sync batch
//   POST /pairs/{name}/restore       {"at": "2h ago"}: undo every batch after that time
//   POST /pairs/{name}/ignore        {"path": "..."}: add the file to the source's .syncignore
//   GET  /pairs/{name}/stats?since=7d   history totals (JSON)
//   GET  /pairs/{name}/plan          what the next pass would do (JSON)
//
// With the web app on (ferry ui, or --serve), also:
//   GET  /                           the web app
//   GET  /info                       version, and whether pairs can be added
//   GET  /fs?path=…                  sub-folders of a folder (the folder picker)
//   POST /pairs                      add a pair (config-file keys, JSON)
//   POST /pairs/{name}/remove        stop syncing a pair
//
// Without a token it only answers requests addressed to localhost, and POSTs
// must carry an X-Ferry header, which a web page can't send cross-site.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { Engine } from "./engine/engine.ts";
import { statusJSON } from "./engine/engine.ts";
import { batchesSince } from "./engine/journal.ts";
import { eventJSON, parseChoice, type Event } from "./engine/types.ts";
import { errMsg, parseWhen } from "./util.ts";
import webPage from "./web/index.html" with { type: "text" };

const PAGE = webPage as unknown as string;

/** Adds and removes pairs while ferry runs (provided by "ferry ui"). */
export interface PairManager {
  /** Where added pairs are saved, or "" if they only last for this session. */
  configFile: string;
  add(obj: Record<string, unknown>): Promise<string[]>;
  remove(name: string): Promise<{ savedRemoval: boolean }>;
}

export interface ApiOptions {
  version?: string;
  manager?: PairManager | null;
}

type Sub = (chunk: string) => void;

const enc = new TextEncoder();

export class ApiServer {
  private subs = new Set<Sub>();
  private server: ReturnType<typeof Bun.serve> | null = null;

  constructor(private engines: Engine[], private token: string, private opts: ApiOptions = {}) {}

  /** Forwards an event to every /events subscriber. */
  broadcast(ev: Event): void {
    if (this.subs.size === 0) return;
    const chunk = `event: ${ev.kind}\ndata: ${JSON.stringify(eventJSON(ev))}\n\n`;
    for (const s of this.subs) s(chunk);
  }

  /** Starts listening on "host:port" (":port" means every interface). */
  listen(addr: string): void {
    const i = addr.lastIndexOf(":");
    if (i < 0) throw new Error(`serve address "${addr}": expected host:port`);
    let hostname = addr.slice(0, i) || "0.0.0.0";
    if (hostname.startsWith("[") && hostname.endsWith("]")) hostname = hostname.slice(1, -1);
    const port = Number(addr.slice(i + 1));
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`serve address "${addr}": bad port`);
    this.server = Bun.serve({ hostname, port, idleTimeout: 120, fetch: (req) => this.handle(req) });
  }

  stop(): void {
    this.server?.stop(true);
  }

  /** The request handler (exported for tests). */
  async handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const denied = this.guard(req, url);
    if (denied) return denied;
    let parts: string[];
    try {
      parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    } catch {
      return text("bad path", 400);
    }
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      return new Response(PAGE, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          // the page is self-contained: no outside scripts, styles or frames
          "Content-Security-Policy": "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    if (req.method === "GET" && url.pathname === "/status") {
      return json(this.engines.map((e) => statusJSON(e.getStatus())));
    }
    if (req.method === "GET" && url.pathname === "/info") {
      const m = this.opts.manager;
      return json({
        version: this.opts.version ?? "", can_add: !!m, config_file: m?.configFile ?? "",
        home: os.homedir(), platform: process.platform, sep: path.sep,
      });
    }
    if (req.method === "GET" && url.pathname === "/fs") return this.listDir(url);
    if (req.method === "GET" && url.pathname === "/events") return this.events(req);
    if (req.method === "POST" && url.pathname === "/pairs") return this.addPair(req);
    if (parts[0] === "pairs" && parts.length === 3) {
      const e = this.engines.find((x) => x.name === parts[1]);
      if (!e) return text(`no pair named ${JSON.stringify(parts[1])}`, 404);
      const action = parts[2]!;
      if (req.method === "GET" && action === "diff") return this.diff(e, url);
      if (req.method === "GET" && action === "history") return json(e.history());
      if (req.method === "GET" && action === "stats") return this.stats(e, url);
      if (req.method === "GET" && action === "plan") {
        try {
          return json(e.plan());
        } catch (err) {
          return text(errMsg(err), 409);
        }
      }
      if (req.method === "POST") return this.action(e, action, url, req);
    }
    return text("404 page not found", 404);
  }

  private guard(req: Request, url: URL): Response | null {
    if (this.token !== "") {
      let got = (req.headers.get("Authorization") ?? "").replace(/^Bearer /, "");
      if (got === "") got = url.searchParams.get("token") ?? "";
      if (got !== this.token) return text("missing or wrong token", 401);
      return null;
    }
    // no token: refuse anything not addressed to localhost (DNS rebinding)
    let host = req.headers.get("Host") ?? url.host;
    const m = /^(\[[^\]]*\]|[^:]*)(?::\d+)?$/.exec(host);
    if (m) host = m[1]!;
    if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) {
      return text("set serve_token to use the API from other hosts", 403);
    }
    if (req.method === "POST" && !req.headers.get("X-Ferry")) return text("POST requests need an X-Ferry header", 403);
    return null;
  }

  private events(req: Request): Response {
    let sub: Sub | null = null;
    let ping: ReturnType<typeof setInterval> | null = null;
    const done = () => {
      if (sub) this.subs.delete(sub);
      if (ping) clearInterval(ping);
    };
    const stream = new ReadableStream({
      start: (ctl) => {
        const write = (s: string) => {
          try {
            ctl.enqueue(enc.encode(s));
          } catch {
            done();
          }
        };
        write(": connected\n\n");
        sub = write;
        this.subs.add(sub);
        ping = setInterval(() => write(": ping\n\n"), 30_000);
        req.signal.addEventListener("abort", done, { once: true });
      },
      cancel: done,
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
  }

  private async diff(e: Engine, url: URL): Promise<Response> {
    const rel = url.searchParams.get("path") ?? "";
    if (rel === "") return text("path is required", 400);
    const { title, lines } = await e.diff(rel, url.searchParams.get("conflict") === "1");
    let out = title + "\n";
    for (const l of lines) out += (l.op === "@" ? l.text : l.op + l.text) + "\n";
    return new Response(out, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }

  private stats(e: Engine, url: URL): Response {
    const since = url.searchParams.get("since") ?? "7d";
    let t = 0;
    if (since !== "all" && since !== "") {
      try {
        t = parseWhen(since);
      } catch (err) {
        return text(errMsg(err), 400);
      }
    }
    return json(e.stats(t));
  }

  /** Sub-folders of a folder, for the web app's folder picker. */
  private listDir(url: URL): Response {
    const raw = url.searchParams.get("path") || os.homedir();
    const dir = path.resolve(raw.startsWith("~") ? path.join(os.homedir(), raw.slice(1)) : raw);
    const hidden = url.searchParams.get("hidden") === "1";
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      return text(`can't open ${dir}: ${errMsg(err)}`, 404);
    }
    const dirs = entries
      .filter((d) => (d.isDirectory() || (d.isSymbolicLink() && isDir(path.join(dir, d.name)))) && (hidden || !d.name.startsWith(".")))
      .map((d) => d.name)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    const parent = path.dirname(dir);
    return json({ path: dir, parent: parent === dir ? "" : parent, home: os.homedir(), dirs, is_git: isDir(path.join(dir, ".git")) });
  }

  private async addPair(req: Request): Promise<Response> {
    const m = this.opts.manager;
    if (!m) return text("adding pairs needs ferry ui", 405);
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return text("expected a JSON object with source and target", 400);
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) return text("expected a JSON object with source and target", 400);
    try {
      const names = await m.add(body as Record<string, unknown>);
      return json({ added: names, saved_to: m.configFile });
    } catch (err) {
      return text(errMsg(err), 400);
    }
  }

  private async body(req: Request): Promise<Record<string, unknown>> {
    try {
      const b = await req.json();
      return b && typeof b === "object" ? (b as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }

  private async action(e: Engine, action: string, url: URL, req: Request): Promise<Response> {
    const q = url.searchParams;
    switch (action) {
      case "restore": {
        const b = await this.body(req);
        const at = String(b.at ?? q.get("at") ?? "");
        let t: number;
        try {
          t = parseWhen(at);
        } catch (err) {
          return text(errMsg(err), 400);
        }
        if (t > Date.now()) return text("that time is in the future", 400);
        if (b.dry_run) {
          const bs = batchesSince(e.dataDir, e.id, t);
          const files = new Set(bs.flatMap((x) => x.entries.map((en) => en.path)));
          return json({ restored_to: new Date(t).toISOString(), batches: bs.length, files: [...files].sort(), dry_run: true });
        }
        try {
          const r = e.restoreTo(t);
          return json({ restored_to: new Date(t).toISOString(), batches: r.batches.length, reverted: r.done.length, problems: r.problems });
        } catch (err) {
          return text(errMsg(err), 409);
        }
      }
      case "ignore": {
        const p = String((await this.body(req)).path ?? q.get("path") ?? "");
        try {
          const line = e.ignorePath(p);
          return json({ ignored: p, rule: line, already: line === "" });
        } catch (err) {
          return text(errMsg(err), 400);
        }
      }
      case "remove": {
        const m = this.opts.manager;
        if (!m) return text("removing pairs needs ferry ui", 405);
        try {
          return json({ removed: e.name, ...(await m.remove(e.name)) });
        } catch (err) {
          return text(errMsg(err), 400);
        }
      }
      case "pause":
        e.setPaused(true);
        break;
      case "resume":
        e.setPaused(false);
        break;
      case "resync":
        e.resync();
        break;
      case "approve":
        e.approveBatch();
        break;
      case "commit":
      case "push":
        e.commit(q.get("message") || "sync: {summary}", action === "push" || q.get("push") === "1");
        break;
      case "resolve": {
        let body: { path?: unknown; choice?: unknown };
        try {
          body = (await req.json()) as typeof body;
        } catch {
          body = {};
        }
        if (typeof body.path !== "string" || body.path === "") {
          return text(`expected {"path": "...", "choice": "source|target|newer|both|merge"}`, 400);
        }
        const c = parseChoice(String(body.choice ?? ""));
        if (!c) return text("choice must be source, target, newer, both or merge", 400);
        e.resolve(body.path, c);
        break;
      }
      case "undo":
        try {
          const { batch, problems } = e.undoLast();
          return json({ undone: batch.id, time: batch.time, problems });
        } catch (err) {
          return text(errMsg(err), 409);
        }
      default:
        return text("unknown action " + action, 404);
    }
    return json({ ok: action });
  }
}

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function json(v: unknown): Response {
  return new Response(JSON.stringify(v, null, 2) + "\n", { headers: { "Content-Type": "application/json" } });
}

function text(s: string, status: number): Response {
  return new Response(s + "\n", { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
