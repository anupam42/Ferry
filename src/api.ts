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
//   GET  /events/recent              the last 300 notable events (for notifications after a reload)
//   GET  /connections                who is connected to GitLab, Azure DevOps and Jira (no secrets)
//   POST /connections/{gitlab|azure|jira}[/remove]   connect (checks the token first) or disconnect
//   GET  /settings · POST /settings/git     your git identity and defaults (git config --global); ferry ui only
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
import { MAX_DIFF_LINES } from "./gitclient.ts";
import type { PageChange, PageWatcher } from "./devreload.ts";
import { GitApi, type RepoManager } from "./gitapi.ts";
import * as conn from "./integrations.ts";
import { readSettings, saveGit, SettingsError } from "./settingsapi.ts";
import { errMsg, parseWhen } from "./util.ts";
import webPage from "./web/index.html" with { type: "text" };
import logoSVG from "../assets/logo/icon.svg" with { type: "text" };
import mascot_relay from "../assets/mascot/relay.svg" with { type: "text" };
import mascot_happy from "../assets/mascot/relay-happy.svg" with { type: "text" };
import mascot_focused from "../assets/mascot/relay-focused.svg" with { type: "text" };
import mascot_sleepy from "../assets/mascot/relay-sleepy.svg" with { type: "text" };
import mascot_worried from "../assets/mascot/relay-worried.svg" with { type: "text" };
import mascot_sad from "../assets/mascot/relay-sad.svg" with { type: "text" };
import mascot_thinking from "../assets/mascot/relay-thinking.svg" with { type: "text" };
import mascot_party from "../assets/mascot/relay-party.svg" with { type: "text" };
import mascot_excited from "../assets/mascot/relay-excited.svg" with { type: "text" };
import mascot_surprised from "../assets/mascot/relay-surprised.svg" with { type: "text" };
import mascot_love from "../assets/mascot/relay-love.svg" with { type: "text" };
import mascot_wink from "../assets/mascot/relay-wink.svg" with { type: "text" };
import mascot_comparing from "../assets/mascot/relay-comparing.svg" with { type: "text" };

/** Relay's expressions, served at /mascot/{name}.svg (bundled into the binary). */
const MASCOT: Record<string, string> = {
  relay: mascot_relay as unknown as string,
  happy: mascot_happy as unknown as string,
  focused: mascot_focused as unknown as string,
  sleepy: mascot_sleepy as unknown as string,
  worried: mascot_worried as unknown as string,
  sad: mascot_sad as unknown as string,
  thinking: mascot_thinking as unknown as string,
  party: mascot_party as unknown as string,
  excited: mascot_excited as unknown as string,
  surprised: mascot_surprised as unknown as string,
  love: mascot_love as unknown as string,
  wink: mascot_wink as unknown as string,
  comparing: mascot_comparing as unknown as string,
};

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
  repos?: RepoManager | null;
  /** ferry ui --dev: the page comes from the source tree and browsers are told when it changes */
  dev?: PageWatcher | null;
}

type Sub = (chunk: string) => void;

/** Event kinds kept for the web app's notifications (per-file copies are summed up by "synced"). */
const NOTABLE = new Set(["conflict", "resolved", "error", "warn", "skip", "commit", "synced", "paused", "resumed", "info"]);
const RECENT_MAX = 300;

const enc = new TextEncoder();

export class ApiServer {
  private subs = new Set<Sub>();
  private recent: Record<string, unknown>[] = [];
  private server: ReturnType<typeof Bun.serve> | null = null;

  private git: GitApi;

  constructor(private engines: Engine[], private token: string, private opts: ApiOptions = {}) {
    this.git = new GitApi(engines, opts.repos ?? null);
  }

  /** Forwards an event to every /events subscriber. */
  broadcast(ev: Event): void {
    // remember the events worth a notification, so the web app can show them after a reload
    if (NOTABLE.has(ev.kind)) {
      this.recent.push(eventJSON(ev));
      if (this.recent.length > RECENT_MAX) this.recent.splice(0, this.recent.length - RECENT_MAX);
    }
    if (this.subs.size === 0) return;
    const chunk = `event: ${ev.kind}\ndata: ${JSON.stringify(eventJSON(ev))}\n\n`;
    for (const s of this.subs) s(chunk);
  }

  /** ferry ui --dev: tells open pages that the page changed ("css" can be swapped in without a reload). */
  pageChanged(kind: PageChange): void {
    const chunk = `event: dev\ndata: ${JSON.stringify({ kind })}\n\n`;
    for (const s of this.subs) s(chunk);
  }

  /** The port it's listening on. */
  get port(): number {
    return this.server?.port ?? 0;
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
      return new Response(this.opts.dev ? this.opts.dev.page() : PAGE, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          // the page is self-contained: no outside scripts, styles or frames
          "Content-Security-Policy": "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    if (req.method === "GET" && (url.pathname === "/logo.svg" || url.pathname === "/favicon.ico")) {
      return new Response(logoSVG as unknown as string, {
        headers: { "Content-Type": "image/svg+xml", "Cache-Control": "max-age=86400", "X-Content-Type-Options": "nosniff" },
      });
    }
    const mascotName = /^\/mascot\/([a-z]+)\.svg$/.exec(url.pathname)?.[1]
      ?? (url.pathname === "/relay.svg" ? "relay" : url.pathname === "/relay-comparing.svg" ? "comparing" : "");
    if (req.method === "GET" && mascotName && MASCOT[mascotName]) {
      return new Response(MASCOT[mascotName], {
        headers: { "Content-Type": "image/svg+xml", "Cache-Control": "max-age=86400", "X-Content-Type-Options": "nosniff" },
      });
    }
    if (req.method === "GET" && url.pathname === "/status") {
      return json(this.engines.map((e) => statusJSON(e.getStatus())));
    }
    if (req.method === "GET" && url.pathname === "/info") {
      const m = this.opts.manager;
      return json({
        version: this.opts.version ?? "", can_add: !!m, can_open_repos: !!this.opts.repos, config_file: m?.configFile ?? "",
        home: os.homedir(), platform: process.platform, sep: path.sep, ...(this.opts.dev ? { dev: { boot: this.opts.dev.boot } } : {}),
      });
    }
    if (req.method === "GET" && url.pathname === "/fs") return this.listDir(url);
    if (parts[0] === "git" && parts.length >= 2) return this.git.handle(req, url, parts);
    if (parts[0] === "connections") return this.connections(req, parts);
    if (parts[0] === "settings") return this.settings(req, parts);
    if (req.method === "GET" && url.pathname === "/events") return this.events(req);
    if (req.method === "GET" && url.pathname === "/events/recent") return json(this.recent);
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
    const conflict = url.searchParams.get("conflict") === "1";
    const { title, lines } = await e.diff(rel, conflict);
    if (url.searchParams.get("format") === "json") {
      // what the two sides are, in plain words, for the web app's change viewer
      const kind = conflict || title.startsWith("target ↔ source") ? "sides" : title.startsWith("new file") ? "new" : "head";
      const labels = {
        sides: ["In the target", "In your working folder"],
        head: ["Last commit", "Now in the target"],
        new: ["Not in the last commit", "Now in the target"],
      }[kind];
      const more = Math.max(0, lines.length - MAX_DIFF_LINES);
      return json({ path: rel, title, kind, before: labels[0], after: labels[1], lines: more ? lines.slice(0, MAX_DIFF_LINES) : lines, ...(more ? { more } : {}) });
    }
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

  /** GitLab, Azure DevOps and Jira: who is connected, connect, disconnect. Tokens are never sent back. */
  private async settings(req: Request, parts: string[]): Promise<Response> {
    try {
      if (req.method === "GET" && parts.length === 1) return json(await readSettings(this.opts.manager?.configFile ?? ""));
      if (req.method === "POST" && parts[1] === "git" && parts.length === 2) {
        // changing your global git config is for the app running on your own computer
        if (!this.opts.repos) return text("changing git settings needs ferry ui", 405);
        let body: Record<string, unknown> = {};
        try {
          const b = await req.json();
          if (b && typeof b === "object" && !Array.isArray(b)) body = b as Record<string, unknown>;
        } catch {}
        return json(await saveGit(body));
      }
      return text("404 page not found", 404);
    } catch (e) {
      return text(errMsg(e), e instanceof SettingsError ? 400 : 500);
    }
  }

  private async connections(req: Request, parts: string[]): Promise<Response> {
    if (req.method === "GET" && parts.length === 1) return json(conn.status());
    const p = parts[1] as conn.Provider;
    if (req.method !== "POST" || !["gitlab", "azure", "jira"].includes(p)) return text("404 page not found", 404);
    if (!this.opts.repos) return text("connections need ferry ui", 405);
    if (parts[2] === "remove") {
      conn.disconnect(p);
      return json({ disconnected: p });
    }
    try {
      return json(await conn.connect(p, await this.body(req)));
    } catch (e) {
      return new Response(JSON.stringify({ error: errMsg(e), code: e instanceof conn.IntegrationError ? e.code : "" }) + "\n", { status: 400, headers: { "Content-Type": "application/json" } });
    }
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
    return json({ path: dir, parent: parent === dir ? "" : parent, home: os.homedir(), dirs, is_git: isDir(path.join(dir, ".git")), drives: drives() });
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

/** Drive roots on Windows (C:\, D:\, …) so the folder picker can leave C:. Empty elsewhere. */
function drives(): string[] {
  if (process.platform !== "win32") return [];
  const out: string[] = [];
  for (let c = 65; c <= 90; c++) {
    const root = String.fromCharCode(c) + ":\\";
    if (isDir(root)) out.push(root);
  }
  return out;
}

function json(v: unknown): Response {
  return new Response(JSON.stringify(v, null, 2) + "\n", { headers: { "Content-Type": "application/json" } });
}

function text(s: string, status: number): Response {
  return new Response(s + "\n", { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
