// Builds the web app (web/: Svelte 5, TypeScript, SCSS) into src/web/next/,
// which Ferry serves at /next and embeds in the compiled binary.
//
//   bun scripts/build-web.ts          build once (minified)
//   bun scripts/build-web.ts --dev    build once, readable, with dev checks
//
// Components are compiled by Svelte (TypeScript in <script lang="ts"> included);
// their <style lang="scss"> goes through Sass with web/styles on the load path,
// so every component can `@use "tokens" as *;`. Rune modules (*.svelte.ts) are
// transpiled by Bun first, then compiled by Svelte. The global stylesheet
// (web/styles/main.scss: tokens, themes, base) becomes app.css.
import fs from "node:fs";
import path from "node:path";

import type { BunPlugin } from "bun";
import * as sass from "sass";
import { compile, compileModule, preprocess } from "svelte/compiler";

const ROOT = path.resolve(import.meta.dir, "..");
export const WEB_SRC = path.join(ROOT, "web");
export const WEB_OUT = path.join(ROOT, "src", "web", "next");
const STYLES = path.join(WEB_SRC, "styles");

function scss(source: string, file: string): string {
  return sass.compileString(source, { loadPaths: [STYLES, path.dirname(file)], style: "expanded", syntax: "scss", url: new URL("file://" + file) }).css;
}

/** Compiles .svelte and .svelte.ts; each component's scoped CSS goes into styles (file → css), for app.css. */
function sveltePlugin(dev: boolean, styles: Map<string, string>): BunPlugin {
  return {
    name: "ferry-svelte",
    setup(build) {
      build.onLoad({ filter: /\.svelte$/ }, async ({ path: file }) => {
        const source = await Bun.file(file).text();
        const pre = await preprocess(source, {
          style: ({ content, attributes }) => (attributes.lang === "scss" ? { code: scss(content, file) } : undefined),
        }, { filename: file });
        const out = compile(pre.code, { filename: file, generate: "client", css: "external", dev, runes: true });
        for (const w of out.warnings) console.warn(`${path.relative(ROOT, file)}: ${w.message}`);
        if (out.css?.code) styles.set(file, out.css.code); else styles.delete(file);
        return { contents: out.js.code, loader: "js" };
      });
      build.onLoad({ filter: /\.svelte\.ts$/ }, async ({ path: file }) => {
        const ts = await Bun.file(file).text();
        const js = new Bun.Transpiler({ loader: "ts", trimUnusedImports: false }).transformSync(ts);
        const out = compileModule(js, { filename: file, generate: "client", dev });
        return { contents: out.js.code, loader: "js" };
      });
    },
  };
}

/** Builds web/ into src/web/next/ (index.html, app.js, app.css). Returns what changed. */
export async function buildWeb(o: { dev?: boolean } = {}): Promise<{ js: boolean; css: boolean; ms: number }> {
  const t0 = performance.now();
  const dev = !!o.dev;
  fs.mkdirSync(WEB_OUT, { recursive: true });
  const styles = new Map<string, string>();
  const res = await Bun.build({
    entrypoints: [path.join(WEB_SRC, "main.ts")],
    target: "browser",
    format: "esm",
    minify: !dev,
    sourcemap: dev ? "inline" : "none",
    plugins: [sveltePlugin(dev, styles)],
    define: { "import.meta.env.DEV": JSON.stringify(dev) },
    conditions: ["browser", "svelte", dev ? "development" : "production"],
  });
  if (!res.success) throw new AggregateError(res.logs, "the web app didn't build:\n" + res.logs.map((l) => String(l)).join("\n"));
  const js = await res.outputs[0]!.text();
  // the global styles, then every component's scoped styles (in a stable order, so an unchanged app makes an unchanged file)
  const style = dev ? "expanded" : "compressed";
  const scoped = [...styles].sort(([a], [b]) => a.localeCompare(b)).map(([, c]) => c).join("\n");
  const css = sass.compile(path.join(STYLES, "main.scss"), { loadPaths: [STYLES], style }).css + "\n"
    + (dev ? scoped : sass.compileString(scoped, { style, syntax: "css" }).css);
  const html = fs.readFileSync(path.join(WEB_SRC, "index.html"), "utf8");
  const write = (name: string, text: string) => {
    const file = path.join(WEB_OUT, name);
    if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === text) return false;
    fs.writeFileSync(file, text);
    return true;
  };
  const changedJS = write("app.js", js);
  const changedCSS = write("app.css", css);
  const changedHTML = write("index.html", html);
  return { js: changedJS || changedHTML, css: changedCSS, ms: Math.round(performance.now() - t0) };
}

/** True when src/web/next is missing or older than anything in web/. */
export function webOutdated(): boolean {
  const out = path.join(WEB_OUT, "app.js");
  if (!fs.existsSync(out)) return true;
  const built = fs.statSync(out).mtimeMs;
  const walk = (dir: string): boolean => fs.readdirSync(dir, { withFileTypes: true }).some((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? walk(p) : fs.statSync(p).mtimeMs > built;
  });
  return walk(WEB_SRC);
}

if (import.meta.main) {
  const dev = process.argv.includes("--dev");
  try {
    const r = await buildWeb({ dev });
    console.log(`web app built in ${r.ms} ms → ${path.relative(process.cwd(), WEB_OUT)}`);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}
