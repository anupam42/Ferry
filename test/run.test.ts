import { expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

import { ApiServer } from "../src/api.ts";
import { dataDir } from "../src/config.ts";
import { readStatuses } from "../src/engine/engine.ts";
import { width } from "../src/tui/term.ts";
import { Dashboard } from "../src/tui/tui.ts";
import { read, setup, write } from "./helpers.ts";

const until = async (cond: () => boolean, ms = 5000) => {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) await Bun.sleep(25);
  return cond();
};

test("watch mode syncs live and stops cleanly when aborted", async () => {
  const { e, r, s, d } = setup((p) => {
    p.mode = "two-way";
    p.settle = 50;
  });
  const ctl = new AbortController();
  const running = e.run(ctl.signal, false);
  await until(() => r.has("synced") || e.getStatus().watcher !== "");
  write(s, "live.txt", "hi");
  expect(await until(() => read(d, "live.txt") === "hi")).toBe(true);
  write(d, "back.txt", "from target");
  expect(await until(() => read(s, "back.txt") === "from target")).toBe(true);
  expect(fs.existsSync(path.join(dataDir(), e.id, "engine.pid"))).toBe(true);
  ctl.abort();
  await running;
  expect(fs.existsSync(path.join(dataDir(), e.id, "engine.pid"))).toBe(false);
  expect(readStatuses(dataDir())[0]!.state).toBe("stopped");
});

test("the dashboard fits the terminal", () => {
  const { e, s } = setup();
  write(s, "a.txt", "x");
  const dash = new Dashboard([e], "1.2.0", "mono");
  dash.addEvent({ time: Date.now(), pair: e.name, kind: "add", path: "src/deep/file-with-a-very-long-name-that-must-be-cut.ts", dir: "→" });
  const lines = (dash as any).view() as string[];
  expect(lines.length).toBe(24);
  for (const l of lines) expect(width(l)).toBeLessThanOrEqual(80);
  expect(lines[0]).toContain("ferry");
  expect(lines.join("\n")).toContain("Activity");
  // (help is plain text; Screen.draw cuts it to the terminal width)
  for (const mode of ["history", "diff"]) {
    (dash as any).mode = mode;
    for (const l of (dash as any).view() as string[]) expect(width(l)).toBeLessThanOrEqual(80);
  }
});

test("api: status, history, unknown pair, token", async () => {
  const { e } = setup();
  const api = new ApiServer([e], "");
  const get = (p: string, init?: RequestInit) => api.handle(new Request("http://127.0.0.1:7878" + p, init));
  const st = (await (await get("/status")).json()) as { name: string }[];
  expect(st[0].name).toBe(e.name);
  expect((await get("/pairs/nope/history")).status).toBe(404);
  expect((await get(`/pairs/${encodeURIComponent(e.name)}/history`)).status).toBe(200);
  expect((await get(`/pairs/${encodeURIComponent(e.name)}/undo`, { method: "POST", headers: { "X-Ferry": "1" } })).status).toBe(409);
  const locked = new ApiServer([e], "s3cret");
  expect((await locked.handle(new Request("http://example.com/status"))).status).toBe(401);
  expect((await locked.handle(new Request("http://example.com/status", { headers: { Authorization: "Bearer s3cret" } }))).status).toBe(200);
});
