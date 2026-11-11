// Folder pairs: their status (GET /status, polled), live events per pair, and what's selected.
import { api, enc } from "./api.ts";
import { act, app, ask, toast } from "./app.svelte.ts";
import type { FerryEvent } from "./events.ts";
import { plural } from "./format.ts";
import { mood, type Mood } from "./mood.ts";
import type { PairStatus } from "./types.ts";

export type View = "files" | "git" | "history" | "stats" | "activity";
export const pairURL = (name: string, action: string) => `/pairs/${enc(name)}/${action}`;

class Sync {
  pairs = $state<PairStatus[]>([]);
  loaded = $state(false);
  selected = $state(localStorage.getItem("ferry-sel") || "");
  view = $state<View>("files");
  query = $state("");
  /** live events per pair, newest last (kept to 400) */
  log = $state<Record<string, FerryEvent[]>>({});
  errors = $state<Record<string, { at: number; msg: string }>>({});
  /** "clear list" on Files: hide what was copied before this time */
  cleared = $state<Record<string, number>>({});
  /** a full resync running for this pair, or just finished */
  busy = $state("");
  done = $state<{ name: string; until: number } | null>(null);
  /** bumped to reload views that fetch their own data (history, stats) */
  bump = $state(0);
  /** the file whose changes are open in the diff drawer */
  diff = $state<{ pair: string; file: string; conflict: boolean } | null>(null);
  /** the "New folder pair" drawer */
  adding = $state(false);

  current = $derived(this.pairs.find((p) => p.name === this.selected) ?? null);

  private timer: ReturnType<typeof setTimeout> | null = null;

  moodOf(p: PairStatus): Mood {
    return mood(p, this.errors[p.name]);
  }

  select(name: string): void {
    this.selected = name;
    localStorage.setItem("ferry-sel", name);
  }

  async refresh(): Promise<void> {
    try {
      this.pairs = await api<PairStatus[]>("GET", "/status");
      app.online = true;
    } catch {
      app.online = false;
      return;
    } finally {
      this.loaded = true;
    }
    if (!this.pairs.some((p) => p.name === this.selected)) this.selected = this.pairs[0]?.name ?? "";
    // comparing by content moves fast: follow it closely
    if (this.pairs.some((p) => p.comparing)) this.soon(400);
  }

  /** Refreshes shortly (several events in a row become one request). */
  soon(ms = 250): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.refresh(), ms);
  }

  onEvent(ev: FerryEvent): void {
    if (!ev.pair) return;
    const list = [...(this.log[ev.pair] ?? []), ev];
    if (list.length > 400) list.splice(0, list.length - 400);
    this.log[ev.pair] = list;
    if (ev.kind === "error")
      this.errors[ev.pair] = { at: Date.now(), msg: (ev.message || "error") + (ev.path ? ` (${ev.path})` : "") };
    this.soon();
  }

  start(): void {
    void this.refresh();
    setInterval(() => void this.refresh(), 3000);
  }
}

export const sync = new Sync();

// ---------- actions several screens share ----------

/** Settles a file that changed in both folders. */
export async function resolve(
  p: PairStatus,
  file: string,
  choice: "source" | "target" | "both" | "merge",
  label: string,
): Promise<void> {
  await act(`${file}: ${label}`, () => api("POST", pairURL(p.name, "resolve"), { path: file, choice }), "happy");
  sync.soon();
}

/** Stops syncing a file (adds it to .syncignore), after asking. */
export async function ignoreFile(p: PairStatus, file: string): Promise<void> {
  const ok = await ask({
    mood: "thinking",
    title: `Stop syncing ${file}?`,
    text: "I'll add it to .syncignore in your working folder. Copies I've already made stay where they are.",
    yes: "Ignore it",
    no: "Keep syncing it",
    yesMood: "wink",
  });
  if (!ok) return;
  const r = await act(null, () => api<{ already?: boolean }>("POST", pairURL(p.name, "ignore"), { path: file }));
  if (r) toast(r.already ? `${file} was already ignored` : `Ignoring ${file} from now on`, { mood: "wink" });
  sync.soon();
}

/** A full resync, then a clear "done" message. */
export async function syncNow(p: PairStatus): Promise<void> {
  if (sync.busy) return;
  sync.busy = p.name;
  const before = (sync.log[p.name] ?? []).length;
  const ok = await act(null, () => api("POST", pairURL(p.name, "resync")));
  if (ok) {
    for (let i = 0; i < 600; i++) {
      await new Promise((r) => setTimeout(r, 300));
      const st = (await api<PairStatus[]>("GET", "/status").catch(() => [])).find((x) => x.name === p.name);
      if (st && !st.pending && !st.comparing && i >= 2) break;
    }
    const evs = (sync.log[p.name] ?? []).slice(before);
    const copied = evs.filter((e) => ["add", "update", "delete", "rename"].includes(e.kind)).length;
    const errs = evs.filter((e) => e.kind === "error").length;
    if (errs) toast(`Finished with ${plural(errs, "error")}; see Activity`, { error: true });
    else
      toast(copied ? `Sync finished: ${plural(copied, "file")} copied` : "Sync finished: everything already matched", {
        mood: "party",
      });
    sync.done = { name: p.name, until: Date.now() + 1600 };
    setTimeout(() => (sync.done = null), 1700);
  }
  sync.busy = "";
  void sync.refresh();
}

/** Stops watching a pair, after a press-and-hold question. */
export async function stopPair(p: PairStatus): Promise<void> {
  const ok = await ask({
    mood: "worried",
    hold: true,
    yes: "Stop",
    no: "Keep syncing",
    title: `Stop syncing “${p.name}”?`,
    text: "I'll stop watching these two folders. Nothing is deleted, and you can add the pair again any time.",
  });
  if (!ok) return;
  const r = await act(null, () => api<{ savedRemoval: boolean }>("POST", pairURL(p.name, "remove")));
  if (r)
    toast(r.savedRemoval ? `Stopped and removed ${p.name}. See you!` : `Stopped syncing ${p.name} for this session.`, {
      mood: "sleepy",
    });
  void sync.refresh();
}

/** A path with the home folder shortened to ~. */
export const short = (path: string) => {
  const home = app.info?.home;
  return home && path.startsWith(home) ? "~" + path.slice(home.length) : path;
};
