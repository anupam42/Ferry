// ESLint for Ferry's TypeScript (src/, test/, scripts/) and the web app (web/: .ts and .svelte).
// Formatting is Prettier's job (eslint-config-prettier turns off the rules that would clash).
import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import svelte from "eslint-plugin-svelte";
import globals from "globals";
import ts from "typescript-eslint";

import svelteConfig from "./web/svelte.config.js";

export default ts.config(
  { ignores: ["node_modules/", "dist/", "src/web/app/", "exports/", "editors/"] },

  js.configs.recommended,
  ...ts.configs.recommended,
  ...svelte.configs.recommended,
  prettier,
  ...svelte.configs.prettier,

  // Ferry itself runs on Bun
  {
    files: ["src/**", "test/**", "scripts/**", "*.js", "*.ts"],
    languageOptions: { globals: { ...globals.node, Bun: "readonly" } },
  },
  // the web app runs in the browser
  {
    files: ["web/**"],
    languageOptions: { globals: globals.browser },
  },
  // .svelte components and .svelte.ts rune modules: TypeScript inside, Svelte's config for <style lang="scss">
  {
    files: ["**/*.svelte", "**/*.svelte.ts"],
    languageOptions: { parserOptions: { parser: ts.parser, extraFileExtensions: [".svelte"], svelteConfig } },
  },

  {
    rules: {
      // `_` marks a value that's deliberately unused (a skipped tuple slot, a required parameter)
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      // `catch {}` is how an expected, harmless failure is ignored (a file that may not exist); other empty blocks are still flagged
      "no-empty": ["error", { allowEmptyCatch: true }],
      // {"a\nb"} is how an attribute gets a real newline
      "svelte/no-useless-mustaches": ["error", { ignoreStringEscape: true }],
    },
  },
  // tests reach into private members on purpose
  {
    files: ["test/**"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
);
