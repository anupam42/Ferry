// File icons and the language bar (web/lib/fileicons.ts, src/shared/languages.ts).
import { describe, expect, test } from "bun:test";

import { languageOf, languageShares } from "../src/shared/languages.ts";
import FILE_ICONS from "../web/lib/fileicons.json";
import { fileIcon, folderIcon, ICON_NAMES } from "../web/lib/fileicons.ts";

describe("file icons", () => {
  test("by language and framework", () => {
    expect(fileIcon("App.svelte")).toBe("svelte");
    expect(fileIcon("main.rs")).toBe("rust");
    expect(fileIcon("server.py")).toBe("python");
    expect(fileIcon("main.go")).toBe("go");
    expect(fileIcon("index.ts")).toBe("typescript");
    expect(fileIcon("Page.tsx")).toBe("react-ts");
    expect(fileIcon("styles.scss")).toBe("sass");
  });
  test("exact names win over the extension", () => {
    expect(fileIcon("package.json")).toBe("nodejs");
    expect(fileIcon("tsconfig.json")).toBe("tsconfig");
    expect(fileIcon("Cargo.toml")).toBe("rust");
    expect(fileIcon("angular.json")).toBe("angular");
    expect(fileIcon("Dockerfile")).toBe("docker");
    expect(fileIcon("Dockerfile.dev")).toBe("docker");
    expect(fileIcon("README.md")).toBe("readme");
    expect(fileIcon(".gitignore")).toBe("git");
    expect(fileIcon(".env.production")).toBe("tune");
  });
  test("compound endings win over the plain extension", () => {
    expect(fileIcon("app.component.ts")).toBe("angular");
    expect(fileIcon("diff.test.ts")).toBe("test-ts");
    expect(fileIcon("types.d.ts")).toBe("typescript-def");
    expect(fileIcon("git.svelte.ts")).toBe("svelte");
    // the ending alone isn't a file name with that ending
    expect(fileIcon(".test.ts")).toBe("typescript");
  });
  test("unknown files and folders get the generic icons", () => {
    expect(fileIcon("notes")).toBe("document");
    expect(fileIcon("thing.unknownext")).toBe("document");
    expect(folderIcon("src")).toBe("folder-src");
    expect(folderIcon(".github")).toBe("folder-github");
    expect(folderIcon("Whatever")).toBe("folder-base");
  });
  test("every icon the mapping can return is in the generated table (run scripts/gen-file-icons.ts after adding one)", () => {
    const icons = FILE_ICONS as Record<string, { body: string }>;
    expect(ICON_NAMES.filter((n) => !icons[n])).toEqual([]);
    for (const n of ICON_NAMES) expect(icons[n]!.body).toContain("<");
  });
});

describe("languages", () => {
  test("code and markup count; data, prose and vendored code don't", () => {
    expect(languageOf("src/main.ts")?.name).toBe("TypeScript");
    expect(languageOf("web/App.svelte")?.name).toBe("Svelte");
    expect(languageOf("lib.rs")?.name).toBe("Rust");
    expect(languageOf("Dockerfile")?.name).toBe("Dockerfile");
    expect(languageOf("package.json")).toBeNull();
    expect(languageOf("README.md")).toBeNull();
    expect(languageOf("node_modules/x/index.js")).toBeNull();
    expect(languageOf("vendor/lib.go")).toBeNull();
    expect(languageOf("docs/site.css")).toBeNull();
    expect(languageOf("app.min.js")).toBeNull();
  });
  test("shares by bytes, largest first, adding up to 1", () => {
    const s = languageShares([
      { path: "a.ts", size: 600 },
      { path: "b.ts", size: 200 },
      { path: "c.py", size: 200 },
      { path: "README.md", size: 5000 },
      { path: "empty.rs", size: 0 },
    ]);
    expect(s.map((l) => [l.name, l.share])).toEqual([
      ["TypeScript", 0.8],
      ["Python", 0.2],
    ]);
    expect(languageShares([{ path: "README.md", size: 10 }])).toEqual([]);
  });
  test("many small languages fold into Other", () => {
    const files = ["a.ts", "b.py", "c.rs", "d.go", "e.java", "f.rb", "g.php", "h.swift", "i.kt", "j.lua"].map(
      (p, i) => ({
        path: p,
        size: i === 0 ? 10_000 : 10,
      }),
    );
    const s = languageShares(files, 4);
    expect(s.length).toBeLessThanOrEqual(4);
    expect(s[0]!.name).toBe("TypeScript");
    expect(s.at(-1)!.name).toBe("Other");
    expect(s.reduce((n, l) => n + l.share, 0)).toBeCloseTo(1, 10);
  });
});
