// Notifications: Ferry's notable events (from /events/recent, then live),
// what's been read, and the choices about them. The drawer and the rail's badge read this.
import { api } from "./api.ts";
import { app, toast } from "./app.svelte.ts";
import type { FerryEvent } from "./events.ts";
import { describe, important, NOTABLE, type Filter, type NoteAction } from "./notes.ts";
import { sync } from "./sync.svelte.ts";

export interface NotePrefs { desktop: boolean; routine: boolean }

function readPrefs(): NotePrefs {
  try { return { desktop: false, routine: false, ...JSON.parse(localStorage.getItem("ferry-note-prefs") || "{}") }; }
  catch { return { desktop: false, routine: false }; }
}

class Notes {
  list = $state<FerryEvent[]>([]);
  /** everything up to this time counts as read */
  lastRead = $state(Number(localStorage.getItem("ferry-read") || 0));
  prefs = $state<NotePrefs>(readPrefs());
  open = $state(false);
  filter = $state<Filter>("all");

  unread = $derived(this.list.filter((ev) => Date.parse(ev.time ?? "") > this.lastRead && important(describe(ev))).length);

  async load(): Promise<void> {
    const recent = await api<FerryEvent[]>("GET", "/events/recent").catch(() => []);
    // keep anything that arrived live while this was loading
    const seen = new Set(recent.map((e) => e.time + "|" + e.kind + "|" + e.pair + "|" + e.path));
    this.list = [...recent, ...this.list.filter((e) => !seen.has(e.time + "|" + e.kind + "|" + e.pair + "|" + e.path))].slice(-500);
  }

  /** A live event: kept if it's notable; a desktop pop-up when it needs you and the tab is hidden. */
  add(ev: FerryEvent): void {
    if (ev.kind === "error" && ev.pair) toast(`${ev.pair}: ${ev.message || "error"}`, { error: true });
    if (ev.kind === "commit" && ev.pair) toast(`${ev.pair}: ${ev.message}`, { mood: "party" });
    if (ev.kind === "conflict" && ev.held && document.hidden) document.title = "(!) Ferry";
    if (!NOTABLE.has(ev.kind)) return;
    const list = [...this.list, { ...ev, time: ev.time || new Date().toISOString() }];
    if (list.length > 500) list.splice(0, list.length - 500);
    this.list = list;
    const d = describe(ev);
    if (d && (d.cat === "needs" || d.cat === "errors") && this.prefs.desktop && document.hidden && "Notification" in window && Notification.permission === "granted") {
      const n = new Notification("Ferry · " + ev.pair, { body: d.title + (d.detail ? "\n" + d.detail : ""), icon: "/logo.svg", tag: ev.pair + "|" + (ev.path || ev.kind) });
      n.onclick = () => { window.focus(); if (d.action) this.run(d.action); n.close(); };
    }
  }

  /** Marks everything shown so far as read (closing the drawer does this). */
  markRead(upTo = this.list.reduce((t, ev) => Math.max(t, Date.parse(ev.time ?? "") || 0), this.lastRead)): void {
    this.lastRead = Math.max(upTo, this.lastRead);
    localStorage.setItem("ferry-read", String(this.lastRead));
  }
  markAllRead(): void { this.markRead(Date.now()); }

  setPrefs(p: Partial<NotePrefs>): void {
    this.prefs = { ...this.prefs, ...p };
    localStorage.setItem("ferry-note-prefs", JSON.stringify(this.prefs));
  }
  /** Turns desktop pop-ups on (asking the browser first) or off. False when the browser said no. */
  async setDesktop(on: boolean): Promise<boolean> {
    if (on && "Notification" in window && Notification.permission !== "granted" && (await Notification.requestPermission()) !== "granted") {
      toast("Your browser didn't allow pop-ups. You can allow them in its site settings.", { error: true });
      return false;
    }
    this.setPrefs({ desktop: on });
    return true;
  }

  /** Does what a notification offers: opens the pair's files or activity, a file's changes, or a link. */
  run(a: NoteAction): void {
    if ("url" in a) { window.open(a.url, "_blank", "noopener"); return; }
    this.close();
    app.go("sync");
    if ("diff" in a) { sync.select(a.diff.pair); sync.diff = { pair: a.diff.pair, file: a.diff.file, conflict: false }; return; }
    sync.select(a.pair);
    sync.view = a.view;
  }

  toggle(): void { if (this.open) this.close(); else this.open = true; }
  close(): void { if (!this.open) return; this.open = false; this.markRead(); }
}

export const notes = new Notes();

// a held conflict marked the tab's title while it was hidden: coming back clears it
if (typeof document !== "undefined") document.addEventListener("visibilitychange", () => { if (!document.hidden && document.title.startsWith("(!)")) document.title = "Ferry"; });
