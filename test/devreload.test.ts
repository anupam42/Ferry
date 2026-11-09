// ferry ui --dev: the page watcher and what the server tells browsers.
import { expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

import { ApiServer } from "../src/api.ts";
import { PageWatcher, sourcePage } from "../src/devreload.ts";
import { tempDir } from "./helpers.ts";

const until = async (f: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!f() && Date.now() < end) await Bun.sleep(20);
  return f();
};

test("the page watcher tells a style-only edit from any other edit", async () => {
  const file = path.join(tempDir(), "index.html");
  fs.writeFileSync(file, "<html><style>a { color: red; }</style><body><script>1</script></body></html>");
  const seen: string[] = [];
  const w = new PageWatcher(file, (k) => seen.push(k));
  try {
    await Bun.sleep(50);
    fs.writeFileSync(file, "<html><style>a { color: blue; }</style><body><script>1</script></body></html>");
    expect(await until(() => seen.length === 1)).toBe(true);
    expect(seen[0]).toBe("css");
    expect(w.page()).toContain("blue");

    // saved by replacing the file, the way many editors do
    fs.writeFileSync(file + ".tmp", "<html><style>a { color: blue; }</style><body><script>2</script></body></html>");
    fs.renameSync(file + ".tmp", file);
    expect(await until(() => seen.length === 2)).toBe(true);
    expect(seen[1]).toBe("page");
  } finally {
    w.stop();
  }
});

test("in dev mode the server serves the watched page and says so in /info", async () => {
  const file = path.join(tempDir(), "index.html");
  fs.writeFileSync(file, "<html><body>dev page</body></html>");
  const w = new PageWatcher(file, () => {});
  try {
    const api = new ApiServer([], "", { dev: w });
    expect(await (await api.handle(new Request("http://127.0.0.1/"))).text()).toBe("<html><body>dev page</body></html>");
    expect(((await (await api.handle(new Request("http://127.0.0.1/info"))).json()) as { dev?: unknown }).dev).toEqual({ boot: w.boot });
    const plain = new ApiServer([], "");
    expect(((await (await plain.handle(new Request("http://127.0.0.1/info"))).json()) as { dev?: unknown }).dev).toBeUndefined();
  } finally {
    w.stop();
  }
});

test("running from source finds the page", () => {
  expect(sourcePage()).toEndWith(path.join("src", "web", "index.html"));
});
