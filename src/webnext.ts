// Serves the new web app (built from web/ by scripts/build-web.ts) at /next.
//
// Running from source, the files are read from src/web/next on every request,
// so a rebuild shows up straight away. The compiled binary carries copies made
// when it was built. If neither is there, /next says how to build it.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const DIR = path.join(import.meta.dir, "web", "next");
type Assets = { html: string; js: string; css: string };

let embedded: Assets | null | undefined;
async function fromBinary(): Promise<Assets | null> {
  if (embedded !== undefined) return embedded;
  try {
    const [html, js, css] = await Promise.all([
      import("./web/next/index.html", { with: { type: "text" } }),
      import("./web/next/app.js", { with: { type: "text" } }),
      import("./web/next/app.css", { with: { type: "text" } }),
    ]);
    embedded = { html: html.default as unknown as string, js: js.default as unknown as string, css: css.default as unknown as string };
  } catch {
    embedded = null;
  }
  return embedded;
}

async function assets(): Promise<Assets | null> {
  try {
    return { html: fs.readFileSync(path.join(DIR, "index.html"), "utf8"), js: fs.readFileSync(path.join(DIR, "app.js"), "utf8"), css: fs.readFileSync(path.join(DIR, "app.css"), "utf8") };
  } catch {
    return fromBinary();
  }
}

/** The page's one inline script (it applies the saved theme before the first paint), allowed by its hash. */
function policy(html: string): string {
  const hashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => `'sha256-${crypto.createHash("sha256").update(m[1]!).digest("base64")}'`);
  return `default-src 'self'; script-src 'self' ${hashes.join(" ")}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;
}

/** Answers /next, /next/app.js and /next/app.css; null for anything else. */
export async function serveNext(url: URL): Promise<Response | null> {
  const p = url.pathname;
  if (p !== "/next" && !p.startsWith("/next/")) return null;
  const a = await assets();
  if (!a) {
    return new Response("The new web app isn't built yet. Run: bun scripts/build-web.ts\n", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  const common = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  if (p === "/next" || p === "/next/" || p === "/next/index.html") {
    return new Response(a.html, { headers: { ...common, "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": policy(a.html) } });
  }
  if (p === "/next/app.js") return new Response(a.js, { headers: { ...common, "Content-Type": "text/javascript; charset=utf-8" } });
  if (p === "/next/app.css") return new Response(a.css, { headers: { ...common, "Content-Type": "text/css; charset=utf-8" } });
  return new Response("404 page not found\n", { status: 404, headers: { "Content-Type": "text/plain" } });
}
