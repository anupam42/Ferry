// ferry ui --dev: a reload (the app was rebuilt, or Ferry restarted) comes
// back where you were: the same section, view and scroll position. Kept in
// sessionStorage, so only this tab, and only for the next load.
import { app } from "./app.svelte.ts";
import { git, type GitView } from "./git.svelte.ts";
import { notes } from "./notes.svelte.ts";
import { sync, type View } from "./sync.svelte.ts";
import type { Mode } from "./types.ts";

const KEY = "ferry-dev-state";

interface Place { mode: Mode; gitView: GitView; syncView: View; notes: boolean; scroll: number }

/** Remembers where you are, then reloads. */
export function reloadHere(): void {
  const place: Place = { mode: app.mode, gitView: git.view, syncView: sync.view, notes: notes.open, scroll: window.scrollY };
  sessionStorage.setItem(KEY, JSON.stringify(place));
  location.reload();
}

/** After a dev reload: back to the same place. The scroll waits until the page is tall enough (views load their data). */
export function restorePlace(): void {
  const raw = sessionStorage.getItem(KEY);
  if (!raw) return;
  sessionStorage.removeItem(KEY);
  let p: Partial<Place>;
  try { p = JSON.parse(raw) as Partial<Place>; } catch { return; }
  if (p.mode) app.mode = p.mode;
  if (p.gitView) git.view = p.gitView;
  if (p.syncView) sync.view = p.syncView;
  if (p.notes) notes.open = true;
  const y = p.scroll ?? 0;
  if (!y) return;
  const end = Date.now() + 4000;
  const tryScroll = () => {
    if (document.documentElement.scrollHeight - window.innerHeight >= y || Date.now() > end) { window.scrollTo(0, y); return; }
    requestAnimationFrame(tryScroll);
  };
  requestAnimationFrame(tryScroll);
}
