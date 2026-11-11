// ferry ui --dev: what the server tells browsers.
import { expect, test } from "bun:test";

import { ApiServer } from "../src/api.ts";
import { newBoot, runningFromSource } from "../src/devreload.ts";

test("in dev mode /info carries the boot id, so a page can tell the server restarted", async () => {
  const dev = { boot: newBoot() };
  const api = new ApiServer([], "", { dev });
  expect(((await (await api.handle(new Request("http://127.0.0.1/info"))).json()) as { dev?: unknown }).dev).toEqual({
    boot: dev.boot,
  });
  expect(newBoot()).not.toBe(dev.boot);
  const plain = new ApiServer([], "");
  expect(
    ((await (await plain.handle(new Request("http://127.0.0.1/info"))).json()) as { dev?: unknown }).dev,
  ).toBeUndefined();
});

test("open pages hear what changed in the web app", async () => {
  const api = new ApiServer([], "");
  const res = await api.handle(new Request("http://127.0.0.1/events"));
  const reader = res.body!.getReader();
  api.pageChanged("css");
  let text = "";
  const dec = new TextDecoder();
  while (!text.includes("event: dev")) text += dec.decode((await reader.read()).value);
  expect(text).toContain('event: dev\ndata: {"kind":"css"}');
  await reader.cancel();
});

test("running from source is recognised", () => {
  expect(runningFromSource()).toBe(true);
});
