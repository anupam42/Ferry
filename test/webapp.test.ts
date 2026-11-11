// The web app (web/: Svelte 5, TypeScript, SCSS): its build, its tokens, and how it's served.
import { beforeAll, expect, test } from "bun:test";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { buildWeb, WEB_OUT } from "../scripts/build-web.ts";
import { ApiServer } from "../src/api.ts";

beforeAll(async () => {
  await buildWeb();
}, 60_000);

test("the build writes the page, a bundled app and the stylesheet", () => {
  for (const f of ["index.html", "app.js", "app.css"]) expect(fs.existsSync(path.join(WEB_OUT, f))).toBe(true);
  const js = fs.readFileSync(path.join(WEB_OUT, "app.js"), "utf8");
  expect(js).not.toMatch(/^\s*(import|export) /m); // one self-contained bundle
  // what goes over the wire: Svelte compiles away, so this is nearly all the app itself (the old page is ~125 KB gzipped)
  expect(Bun.gzipSync(js).length).toBeLessThan(200_000);
});

test("SCSS tokens become theme variables, accents and backgrounds", () => {
  const css = fs.readFileSync(path.join(WEB_OUT, "app.css"), "utf8");
  expect(css).toMatch(/:root,\s*\[data-theme=["']?light["']?\]\s*\{[^}]*--accent:\s*#2586e6/i);
  expect(css).toMatch(/\[data-theme=["']?dark["']?\]\s*\{[^}]*--accent:\s*#4c9df5/i);
  for (const name of ["ocean", "forest", "sunset", "grape", "graphite"]) expect(css).toContain(`[data-accent=${name}]`);
  for (const name of ["plain", "sky", "mint", "lavender", "sand"]) expect(css).toContain(`[data-bg=${name}]`);
  expect(css).toContain("--bg-relay-l:");
  expect(css).toMatch(/\[data-size=small\]\s*\{\s*--zoom:\s*0?\.9/);
});

test("/ serves the app with a strict content policy that allows only its own scripts", async () => {
  const api = new ApiServer([], "");
  const page = await api.handle(new Request("http://127.0.0.1/"));
  expect(page.status).toBe(200);
  const html = await page.text();
  expect(html).toContain('<script type="module" src="/app.js">');
  const csp = page.headers.get("Content-Security-Policy")!;
  // the one inline script (the theme, before first paint) is allowed by its exact hash, not by 'unsafe-inline'
  const inline = /<script>([\s\S]*?)<\/script>/.exec(html)![1]!;
  expect(csp).toContain(`'sha256-${crypto.createHash("sha256").update(inline).digest("base64")}'`);
  expect(csp).toMatch(/script-src 'self' 'sha256-[^']+'; /);
  expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
  expect(csp).toContain("frame-ancestors 'none'");

  const js = await api.handle(new Request("http://127.0.0.1/app.js"));
  expect(js.headers.get("Content-Type")).toContain("javascript");
  const css = await api.handle(new Request("http://127.0.0.1/app.css"));
  expect(css.headers.get("Content-Type")).toContain("text/css");
  expect((await api.handle(new Request("http://127.0.0.1/../package.json"))).status).not.toBe(200);
});

test("the old /next address sends you to /, keeping the token", async () => {
  const api = new ApiServer([], "");
  for (const p of ["/next", "/next/", "/next/app.js"]) {
    const r = await api.handle(new Request("http://127.0.0.1" + p + "?token=abc"));
    expect(r.status).toBe(302);
    expect(r.headers.get("Location")).toBe("/?token=abc");
  }
});

test("with an access token, the app's code and pictures load without it; the page and your data don't", async () => {
  const api = new ApiServer([], "s3cret");
  const get = (p: string, auth = false) => api.handle(new Request("http://example.com" + p, { headers: auth ? { Authorization: "Bearer s3cret" } : {} }));
  for (const p of ["/app.js", "/app.css", "/logo.svg", "/mascot/happy.svg"]) expect((await get(p)).status).toBe(200);
  for (const p of ["/", "/status", "/info", "/events/recent", "/mascot/../status"]) expect((await get(p)).status).toBe(401);
  expect((await get("/", true)).status).toBe(200);
  expect((await get("/status", true)).status).toBe(200);
});
