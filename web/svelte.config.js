// How Svelte reads the components in web/: <style lang="scss"> goes through
// Sass (with web/styles on the load path, for tokens and mixins). Used by the
// build (scripts/build-web.ts) and by the tools that read components on their
// own: svelte-check and ESLint.
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as sass from "sass";

const STYLES = path.join(path.dirname(fileURLToPath(import.meta.url)), "styles");

/** @type {import("svelte/compiler").PreprocessorGroup} */
const scss = {
  name: "ferry-scss",
  style: ({ content, attributes, filename }) => {
    if (attributes.lang !== "scss") return undefined;
    const file = filename ?? path.join(STYLES, "component.scss");
    const out = sass.compileString(content, { loadPaths: [STYLES, path.dirname(file)], style: "expanded", syntax: "scss", url: new URL("file://" + file) });
    return { code: out.css };
  },
};

export default {
  preprocess: [scss],
  compilerOptions: { runes: true },
};
