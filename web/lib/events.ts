// Live updates from Ferry (server-sent events), and hot reload in dev mode.
import { api, enc, token } from "./api.ts";
import type { Info } from "./types.ts";

export interface FerryEvent { kind: string; pair?: string; path?: string; to?: string; message?: string; time?: string; [k: string]: unknown }

const KINDS = ["info", "add", "update", "delete", "rename", "conflict", "resolved", "skip", "warn", "error", "synced", "paused", "resumed", "git", "commit", "kept"];

export function connectEvents(o: { info: Info | null; onEvent: (ev: FerryEvent) => void; onOnline: (up: boolean) => void }): () => void {
  const es = new EventSource("/events" + (token ? "?token=" + enc(token) : ""));
  const onEv = (m: MessageEvent) => {
    try {
      o.onEvent(JSON.parse(m.data) as FerryEvent);
    } catch {}
  };
  for (const k of KINDS) es.addEventListener(k, onEv as EventListener);
  es.onerror = () => o.onOnline(false);
  es.onopen = async () => {
    o.onOnline(true);
    // ferry --dev restarted (its code changed): reload once it answers again
    if (o.info?.dev) {
      const now = await api<Info>("GET", "/info").catch(() => null);
      if (now?.dev && now.dev.boot !== o.info.dev.boot) location.reload();
    }
  };
  if (o.info?.dev) {
    es.addEventListener("dev", ((m: MessageEvent) => {
      let d: { kind?: string; app?: string } = {};
      try {
        d = JSON.parse(m.data);
      } catch {}
      if (d.app !== "next") return; // an edit to the current page, not this one
      if (d.kind === "css") swapStyles();
      else location.reload();
    }) as EventListener);
  }
  return () => es.close();
}

/** A stylesheet-only change: load the new app.css without reloading. */
function swapStyles(): void {
  const link = document.querySelector<HTMLLinkElement>('link[rel="stylesheet"][href*="app.css"]');
  if (!link) return location.reload();
  const next = link.cloneNode() as HTMLLinkElement;
  next.href = "/next/app.css?v=" + Date.now();
  next.onload = () => link.remove();
  link.after(next);
}
