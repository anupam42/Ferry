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
//
// Without a token it only answers requests addressed to localhost, and POSTs
// must carry an X-Ferry header, which a web page can't send cross-site.
import type { Engine } from "./engine/engine.ts";
import { statusJSON } from "./engine/engine.ts";
import { eventJSON, parseChoice, type Event } from "./engine/types.ts";
import { errMsg } from "./util.ts";

type Sub = (chunk: string) => void;

const enc = new TextEncoder();

export class ApiServer {
  private subs = new Set<Sub>();
  private server: ReturnType<typeof Bun.serve> | null = null;

  constructor(private engines: Engine[], private token: string) {}

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
    const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    if (req.method === "GET" && url.pathname === "/status") {
      return json(this.engines.map((e) => statusJSON(e.getStatus())));
    }
    if (req.method === "GET" && url.pathname === "/events") return this.events(req);
    if (parts[0] === "pairs" && parts.length === 3) {
      const e = this.engines.find((x) => x.name === parts[1]);
      if (!e) return text(`no pair named ${JSON.stringify(parts[1])}`, 404);
      const action = parts[2]!;
      if (req.method === "GET" && action === "diff") return this.diff(e, url);
      if (req.method === "GET" && action === "history") return json(e.history());
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

  private async action(e: Engine, action: string, url: URL, req: Request): Promise<Response> {
    const q = url.searchParams;
    switch (action) {
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

function json(v: unknown): Response {
  return new Response(JSON.stringify(v, null, 2) + "\n", { headers: { "Content-Type": "application/json" } });
}

function text(s: string, status: number): Response {
  return new Response(s + "\n", { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
