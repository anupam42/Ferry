// The web app's entry point: loads what it needs from Ferry, then mounts the app.
import { mount } from "svelte";

import App from "./App.svelte";
import { api } from "./lib/api.ts";
import { app } from "./lib/app.svelte.ts";
import { reloadHere, restorePlace } from "./lib/devstate.ts";
import { connectEvents } from "./lib/events.ts";
import { git } from "./lib/git.svelte.ts";
import { notes } from "./lib/notes.svelte.ts";
import { releases } from "./lib/releases.svelte.ts";
import { relay } from "./lib/relay.svelte.ts";
import { sync } from "./lib/sync.svelte.ts";
import "./lib/look.svelte.ts"; // keeps theme and look applied
import type { Info } from "./lib/types.ts";

async function start() {
  try {
    app.info = await api<Info>("GET", "/info");
  } catch {
    app.online = false;
  }
  void app.loadConnections();
  void app.loadSettings();
  sync.start();
  git.start();
  void notes.load();
  releases.start();
  restorePlace(); // after a dev reload: the same section, view and scroll
  mount(App, { target: document.getElementById("app")! });
  connectEvents({ info: app.info, reload: reloadHere, onEvent: (ev) => { sync.onEvent(ev); notes.add(ev); relay.onEvent(ev); }, onOnline: (up) => { if (up) sync.soon(); } });
}

void start();
