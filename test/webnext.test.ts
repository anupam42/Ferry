// The new web app (web/: Svelte 5, TypeScript, SCSS): its build, its tokens, and how it's served.
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
  expect(js.length).toBeLessThan(400_000); // Svelte compiles away: no framework weight to speak of
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

test("/next serves the app with a strict content policy that allows only its own scripts", async () => {
  const api = new ApiServer([], "");
  const page = await api.handle(new Request("http://127.0.0.1/next"));
  expect(page.status).toBe(200);
  const html = await page.text();
  const csp = page.headers.get("Content-Security-Policy")!;
  // the one inline script (the theme, before first paint) is allowed by its exact hash, not by 'unsafe-inline'
  const inline = /<script>([\s\S]*?)<\/script>/.exec(html)![1]!;
  expect(csp).toContain(`'sha256-${crypto.createHash("sha256").update(inline).digest("base64")}'`);
  expect(csp).toMatch(/script-src 'self' 'sha256-[^']+'; /);
  expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
  expect(csp).toContain("frame-ancestors 'none'");

  const js = await api.handle(new Request("http://127.0.0.1/next/app.js"));
  expect(js.headers.get("Content-Type")).toContain("javascript");
  const css = await api.handle(new Request("http://127.0.0.1/next/app.css"));
  expect(css.headers.get("Content-Type")).toContain("text/css");
  expect((await api.handle(new Request("http://127.0.0.1/next/../package.json"))).status).not.toBe(200);
  // the current page is still the default
  expect((await (await api.handle(new Request("http://127.0.0.1/"))).text())).toContain("<title>Ferry</title>");
});
