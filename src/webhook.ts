// Posts selected engine events to Slack, Discord, ntfy or any HTTP endpoint.
import type { Webhook } from "./config.ts";
import { eventJSON, type Event } from "./engine/types.ts";

/** Sent when a webhook doesn't list its own events. */
export const DEFAULT_EVENTS = ["conflict", "error", "paused", "commit"];

/** Identical messages per webhook are rate limited to one per this gap. */
export const webhookSettings = { minGapMs: 10_000 };

export class Dispatcher {
  private last = new Map<string, number>();

  private constructor(private hooks: Webhook[]) {}

  /** null when there are no webhooks. */
  static create(hooks: Webhook[]): Dispatcher | null {
    return hooks.length > 0 ? new Dispatcher(hooks) : null;
  }

  /** Sends ev to every webhook that wants it, in the background. */
  handle(ev: Event): void {
    for (const h of this.hooks) {
      if (!wants(h, ev)) continue;
      const key = `${h.url}|${ev.pair}|${ev.kind}|${ev.path ?? ""}`;
      const t = this.last.get(key);
      if (t !== undefined && Date.now() - t < webhookSettings.minGapMs) continue;
      this.last.set(key, Date.now());
      void send(h, ev).catch(() => {});
    }
  }
}

function wants(h: Webhook, ev: Event): boolean {
  const events = h.events && h.events.length > 0 ? h.events : DEFAULT_EVENTS;
  return events.some((k) => k === "all" || k === ev.kind);
}

/** The payload style, picked from the URL when format is auto or empty. */
export function format(h: Webhook): string {
  if (h.format && h.format !== "auto") return h.format;
  let host: string;
  try {
    host = new URL(h.url).host.toLowerCase();
  } catch {
    return "json";
  }
  if (host.includes("hooks.slack.com")) return "slack";
  if (host.includes("discord.com") || host.includes("discordapp.com")) return "discord";
  if (host.includes("ntfy")) return "ntfy";
  return "json";
}

/** The human-readable line used by chat formats. */
export function text(ev: Event): string {
  const what = ev.to
    ? `${ev.path ?? ""} → ${ev.to} ${ev.msg ?? ""}`.trim()
    : `${ev.path ?? ""} ${ev.msg ?? ""}`.trim();
  return `ferry [${ev.pair}] ${ev.kind}: ${what}`;
}

export async function send(h: Webhook, ev: Event): Promise<void> {
  let body: string;
  const headers: Record<string, string> = { "Content-Type": "application/json", "User-Agent": "ferry" };
  switch (format(h)) {
    case "slack":
      body = JSON.stringify({ text: text(ev) });
      break;
    case "discord":
      body = JSON.stringify({ content: text(ev) });
      break;
    case "ntfy":
      body = `${ev.path ?? ""} ${ev.msg ?? ""}`.trim();
      headers["Content-Type"] = "text/plain; charset=utf-8";
      headers.Title = `ferry: ${ev.pair} ${ev.kind}`;
      headers.Tags = ev.kind;
      if (ev.kind === "error" || ev.kind === "conflict") headers.Priority = "high";
      break;
    default:
      body = JSON.stringify(eventJSON(ev));
  }
  const resp = await fetch(h.url, { method: "POST", body, headers, signal: AbortSignal.timeout(10_000) });
  await resp.body?.cancel();
  if (resp.status >= 300) throw new Error(`webhook ${h.url}: ${resp.status} ${resp.statusText}`);
}
