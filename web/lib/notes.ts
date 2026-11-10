// Notifications, the plain part (unit-tested): what each event from Ferry
// means for a person (a category, Relay's face, a sentence, and something to
// do about it), and how the list is grouped. Actions are data; the drawer runs them.
import type { FerryEvent } from "./types.ts";
import { plural } from "./format.ts";

/** Event kinds that can become a notification. */
export const NOTABLE = new Set(["conflict", "resolved", "error", "warn", "skip", "commit", "synced", "paused", "resumed", "info"]);

export type Category = "needs" | "errors" | "commits" | "sync";
export const CAT: Record<Category, string> = { needs: "Needs you", errors: "Errors", commits: "Commits", sync: "Syncs" };

export type NoteAction =
  | { label: string; pair: string; view: "files" | "activity" }
  | { label: string; diff: { pair: string; file: string } }
  | { label: string; url: string };

export interface Note { cat: Category; mood: string; title: string; detail: string; action?: NoteAction }

const cap = (x: string) => (x ? x.charAt(0).toUpperCase() + x.slice(1) : x);

/** What an event means, or null for noise. */
export function describe(ev: FerryEvent): Note | null {
  const pair = ev.pair ?? "";
  const file = ev.path ? ev.path.split("/").pop()! : "";
  const go = (label: string, view: "files" | "activity"): NoteAction => ({ label, pair, view });
  const seeChanges: NoteAction | undefined = ev.path ? { label: "See changes", diff: { pair, file: ev.path } } : undefined;
  const m = ev.message || "";
  switch (ev.kind) {
    case "conflict":
      return ev.held
        ? { cat: "needs", mood: "worried", title: `${file} changed in both folders`, detail: "Pick which version to keep. Nothing is overwritten until you do.", action: go("Resolve", "files") }
        : { cat: "sync", mood: "thinking", title: `Settled a conflict in ${file}`, detail: m };
    case "resolved": return { cat: "sync", mood: "happy", title: `${file}: sorted out`, detail: m };
    case "error": return { cat: "errors", mood: "sad", title: cap(m.split(":")[0]!) || "Something went wrong", detail: (ev.path ? ev.path + " · " : "") + m, action: go("Details", "activity") };
    case "warn":
      if (/possible secret/i.test(m)) return { cat: "needs", mood: "surprised", title: `${file} might contain a password or key`, detail: "Check it before you commit. " + m.replace(/^possible secret: /i, "Found: ").replace(/ — check before committing$/, "."), action: seeChanges };
      if (/waiting for approval|large batch/i.test(m)) return { cat: "needs", mood: "surprised", title: m.replace(/ \(press y in the dashboard\)/, ""), detail: "A big batch of changes is waiting. Approve it when you're ready.", action: go("Review", "files") };
      if (/merged with \d+ conflict/i.test(m)) return { cat: "needs", mood: "worried", title: `${file} has conflict markers`, detail: m, action: seeChanges };
      return { cat: "errors", mood: "thinking", title: cap(m.split(":")[0]!), detail: m };
    case "skip":
      return /secret/i.test(m)
        ? { cat: "needs", mood: "surprised", title: `Held back ${file}: it looks like a secret`, detail: m }
        : { cat: "sync", mood: "thinking", title: `Skipped ${file}`, detail: m };
    case "commit": {
      if (/^pushed /.test(m)) return { cat: "commits", mood: "party", title: `Pushed ${m.slice(7)}`, detail: "Your commits are on the remote." };
      if (/^opened pull request /.test(m)) return { cat: "commits", mood: "excited", title: "Opened a pull request", detail: m.slice(20), action: { label: "Open", url: m.slice(20) } };
      const [hash, ...rest] = m.split(" ");
      return { cat: "commits", mood: "party", title: `Committed: ${rest.join(" ")}`, detail: "commit " + hash };
    }
    case "synced": {
      const n: Record<string, number> = Object.fromEntries([...m.matchAll(/([+~\-↻!])(\d+)/g)].map((x) => [x[1]!, +x[2]!]));
      const parts = [n["+"] && `${n["+"]} added`, n["~"] && `${n["~"]} updated`, n["-"] && `${n["-"]} deleted`, n["↻"] && `${n["↻"]} renamed`].filter(Boolean);
      const total = (n["+"] || 0) + (n["~"] || 0) + (n["-"] || 0) + (n["↻"] || 0);
      if (n["!"]) return { cat: "errors", mood: "sad", title: `${plural(n["!"], "file")} couldn't be copied`, detail: parts.join(", "), action: go("Details", "activity") };
      return { cat: "sync", mood: "happy", title: `Copied ${plural(total, "file")}`, detail: parts.join(", "), action: go("See files", "files") };
    }
    case "paused": return { cat: "sync", mood: "sleepy", title: m === "paused by user" ? "Paused" : "Paused for a moment", detail: m === "paused by user" ? "Syncing stopped until you resume." : m };
    case "resumed": return { cat: "sync", mood: "happy", title: "Back to syncing", detail: m === "resumed" ? "" : m };
    case "info":
      if (/^(undid|restored to|pulled|pushed|uploaded|ignored|pruned)/i.test(m) || /ignored from now on/.test(m)) return { cat: "sync", mood: "wink", title: (ev.path ? ev.path + ": " : "") + cap(m), detail: "" };
      return null;
  }
  return null;
}

/** Counts as unread (and on the badge): anything that isn't a routine sync. */
export const important = (d: Note | null) => !!d && d.cat !== "sync";

/** The day heading for a time: "Today", "Yesterday", "Monday, 3 November". */
export function dayOf(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return "Today";
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
}

export type Filter = "all" | Category;
export interface Row { ev: FerryEvent; d: Note; group: string }

/** The list for a filter: newest first, what needs you on top under "All"; routine syncs only when asked. */
export function noteList(events: FerryEvent[], filter: Filter, routine: boolean, now = new Date()) {
  const t = (ev: FerryEvent) => Date.parse(ev.time ?? "") || 0;
  const items = events.map((ev, i) => ({ ev, d: describe(ev), i })).filter((x): x is { ev: FerryEvent; d: Note; i: number } => !!x.d)
    .sort((a, b) => t(b.ev) - t(a.ev) || b.i - a.i); // newest first; same time: the later one first
  const counts: Record<Filter, number> = { all: 0, needs: 0, errors: 0, commits: 0, sync: 0 };
  for (const x of items) { counts[x.d.cat]++; if (x.d.cat !== "sync" || routine) counts.all++; }
  let shown = items.filter((x) => (filter === "all" ? x.d.cat !== "sync" || routine : x.d.cat === filter));
  if (filter === "all") shown = [...shown.filter((x) => x.d.cat === "needs"), ...shown.filter((x) => x.d.cat !== "needs")];
  const rows: Row[] = shown.slice(0, 200).map((x) => ({ ...x, group: filter === "all" && x.d.cat === "needs" ? "Needs you" : dayOf(x.ev.time ?? "", now) }));
  return { rows, counts, all: items };
}
