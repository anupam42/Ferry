// Settings → git: reads and writes "git config --global", here pointed at a scratch file.
import { afterAll, beforeAll, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

import { ApiServer } from "../src/api.ts";
import { tempDir } from "./helpers.ts";

let saved: string | undefined;
let cfg = "";
beforeAll(() => {
  saved = process.env.GIT_CONFIG_GLOBAL;
  cfg = path.join(tempDir(), "gitconfig");
  fs.writeFileSync(cfg, "");
  process.env.GIT_CONFIG_GLOBAL = cfg; // never the real ~/.gitconfig
});
afterAll(() => {
  if (saved === undefined) delete process.env.GIT_CONFIG_GLOBAL;
  else process.env.GIT_CONFIG_GLOBAL = saved;
});

const repos = { list: () => [], add() {}, remove() {} };
const post = (api: ApiServer, body: unknown) =>
  api.handle(new Request("http://127.0.0.1/settings/git", { method: "POST", headers: { "X-Ferry": "1" }, body: JSON.stringify(body) }));

test("reads and saves your git identity and defaults", async () => {
  const api = new ApiServer([], "", { repos });
  const res = await post(api, { name: "Anupam Udupi", email: "anupam@example.com", default_branch: "main", pull: "rebase", sign: true });
  expect(res.status).toBe(200);
  const got = (await (await api.handle(new Request("http://127.0.0.1/settings"))).json()) as { git: Record<string, unknown>; data_dir: string };
  expect(got.git).toEqual({ name: "Anupam Udupi", email: "anupam@example.com", default_branch: "main", pull: "rebase", sign: true });
  expect(got.data_dir).toBeTruthy();
  const text = fs.readFileSync(cfg, "utf8");
  expect(text).toContain("defaultBranch = main");
  expect(text).toContain("rebase = true");

  // back to git's defaults: the keys are removed, not set to empty
  await post(api, { default_branch: "", pull: "", sign: false });
  const after = fs.readFileSync(cfg, "utf8");
  expect(after).not.toContain("defaultBranch");
  expect(after).not.toContain("rebase");
  expect(after).not.toContain("gpgsign");
  expect(after).toContain("name = Anupam Udupi");
});

test("refuses values git would choke on, and needs ferry ui to change anything", async () => {
  const api = new ApiServer([], "", { repos });
  for (const bad of [{ name: "" }, { email: "not an email" }, { name: "two\nlines" }, { default_branch: "bad..name" }, { default_branch: "-x" }, { pull: "squash" }]) {
    const r = await post(api, bad);
    expect(r.status).toBe(400);
  }
  const plain = new ApiServer([], "");
  expect((await post(plain, { name: "X" })).status).toBe(405);
  // a web page on another site can't send the X-Ferry header
  const noHeader = await api.handle(new Request("http://127.0.0.1/settings/git", { method: "POST", body: "{}" }));
  expect(noHeader.status).toBe(403);
});
