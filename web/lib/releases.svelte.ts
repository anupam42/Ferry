// Release notes and updates: this copy of Ferry and its releases (GET
// /release, once), the update check (only when you turn it on, or press
// Check now), the notice at the top of the page, and "What's new".
import { api } from "./api.ts";
import { app, toast } from "./app.svelte.ts";
import { git, type GitView } from "./git.svelte.ts";
import { noticeKey, pickNotice, placeFor, relKey } from "./releases.ts";
import type { LatestRelease, ReleaseInfo } from "./types.ts";

const readJSON = <T>(key: string, fallback: T): T => { try { return (JSON.parse(localStorage.getItem(key) || "null") as T) ?? fallback; } catch { return fallback; } };

class Releases {
  info = $state<ReleaseInfo | null>(null);
  error = $state("");
  /** the update check is on (it's off until you turn it on) */
  checkOn = $state(localStorage.getItem("ferry-update-check") === "on");
  /** the last answer from GitHub, and when */
  last = $state<{ at: number; r: LatestRelease } | null>(readJSON("ferry-update-last", null));
  /** the newest release you've looked at */
  seen = $state(localStorage.getItem("ferry-seen-release") ?? "");
  dismissed = $state<string[]>(readJSON("ferry-notice-dismissed", []));
  folded = $state(localStorage.getItem("ferry-notice-collapsed") ?? "");
  /** What's new is open ("" for everything since you last looked, or one version) */
  whatsNew = $state<{ only: string } | null>(null);
  now = $state(Date.now());

  private loading: Promise<ReleaseInfo | null> | null = null;

  load(): Promise<ReleaseInfo | null> {
    this.loading ??= api<ReleaseInfo>("GET", "/release").then((r) => {
      this.info = r;
      // a first visit isn't an update: start from here quietly
      if (localStorage.getItem("ferry-seen-release") == null) this.markSeen();
      return r;
    }, (e) => { this.error = (e as Error).message; this.loading = null; return null; });
    return this.loading;
  }

  notice = $derived.by(() => {
    if (!this.info) return null;
    const n = pickNotice(this.info.releases, this.info.version, { checkOn: this.checkOn, last: this.last?.r ?? null, seen: this.seen, now: this.now });
    return n && !this.dismissed.includes(noticeKey(n)) ? n : null;
  });
  /** the rail's What's new dot: the newest release hasn't been looked at */
  unseen = $derived(!!this.info?.releases[0] && this.seen !== relKey(this.info.releases[0]));

  markSeen(key = this.info?.releases[0] ? relKey(this.info.releases[0]) : ""): void {
    if (!key) return;
    this.seen = key;
    localStorage.setItem("ferry-seen-release", key);
  }
  dismiss(key: string): void {
    this.dismissed = [...this.dismissed, key].slice(-20);
    localStorage.setItem("ferry-notice-dismissed", JSON.stringify(this.dismissed));
  }
  fold(key: string, on: boolean): void {
    this.folded = on ? key : "";
    if (on) localStorage.setItem("ferry-notice-collapsed", key); else localStorage.removeItem("ferry-notice-collapsed");
  }

  setCheck(on: boolean): void {
    this.checkOn = on;
    localStorage.setItem("ferry-update-check", on ? "on" : "off");
  }
  /** Asks GitHub for the newest release: always when forced, otherwise only when the check is on and a day has passed. */
  async check(force: boolean): Promise<LatestRelease | null> {
    if (!force) {
      if (!this.checkOn) return null;
      if (this.last && Date.now() - this.last.at < 86400e3) return this.last.r;
    }
    const r = await api<LatestRelease>("GET", "/release/latest");
    this.last = { at: Date.now(), r };
    localStorage.setItem("ferry-update-last", JSON.stringify(this.last));
    return r;
  }

  openWhatsNew(only = ""): void { this.whatsNew = { only }; }
  closeWhatsNew(): void { this.whatsNew = null; this.markSeen(); }

  /** A "Try it" place from the changelog, opened in the app. */
  go(place: string): void {
    const p = placeFor(place);
    if (!p) return;
    this.whatsNew = null;
    this.markSeen();
    if (p.mode === "git") { app.go("git"); git.view = p.view as GitView; }
    else if (p.mode === "settings") { app.section = p.section; localStorage.setItem("ferry-settings-sec", p.section); app.go("settings"); }
    else app.go("sync");
  }

  start(): void {
    void this.load().then(async () => {
      const r = await this.check(false).catch(() => null);
      if (r?.newer) toast(`Ferry ${r.version} is available: see Settings → Updates`, { mood: "excited" });
    });
  }
}

export const releases = new Releases();
