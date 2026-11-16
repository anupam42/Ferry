// Throwaway experiments in a folder pair: start one, keep it, or drop it (after asking).
import { api } from "./api.ts";
import { act, ask, askFields, toast } from "./app.svelte.ts";
import { plural } from "./format.ts";
import { pairURL, sync } from "./sync.svelte.ts";
import type { ExperimentState, PairStatus } from "./types.ts";

/** "Try something": asks what for (optional), then copies the working folder and holds syncing. */
export async function startExperiment(p: PairStatus): Promise<void> {
  const v = await askFields({
    mood: "wink",
    title: "Try something?",
    text: `I'll copy your working folder and stop syncing into ${p.remote ? "the target" : "the repository"} while you try. Keep what you did when you're happy, or drop it and I'll put every file back as it was.`,
    yes: "Start trying",
    no: "Not now",
    primary: "yes",
    fields: [{ name: "name", label: "What are you trying?", placeholder: "e.g. a new layout for the header" }],
  });
  if (!v) return;
  const r = await act(null, () =>
    api<{ files: number }>("POST", pairURL(p.name, "experiment-start"), { name: String(v.name ?? "") }),
  );
  if (r) toast(`Go ahead: ${plural(r.files, "file")} copied, syncing is on hold`, { mood: "wink" });
  sync.soon();
}

/** Ends the experiment and syncs what it did. */
export async function keepExperiment(p: PairStatus): Promise<boolean> {
  const r = await act(null, () => api("POST", pairURL(p.name, "experiment-keep")));
  if (r) toast("Kept it. Syncing your changes now", { mood: "party" });
  sync.soon();
  return !!r;
}

/** Puts the working folder back as it was, after a press-and-hold question. */
export async function dropExperiment(p: PairStatus, ch: ExperimentState | null): Promise<boolean> {
  const n = ch ? ch.changed.length + ch.deleted.length : 0,
    added = ch?.added.length ?? 0;
  const ok = await ask({
    mood: "worried",
    hold: true,
    title: "Drop the experiment?",
    text: ch
      ? `I'll put ${plural(n, "file")} back as ${n === 1 ? "it was" : "they were"}${added ? ` and move ${plural(added, "new file")} aside into Ferry's data folder, so ${added === 1 ? "it isn't" : "they aren't"} lost` : ""}. Then syncing carries on as if you'd never tried.`
      : "I'll put every file back as it was before you started. Then syncing carries on.",
    yes: "Drop it",
    no: "Keep trying",
  });
  if (!ok) return false;
  const r = await act(null, () =>
    api<{ restored: number; moved: number; aside?: string }>("POST", pairURL(p.name, "experiment-drop")),
  );
  if (r)
    toast(
      r.moved
        ? `Back as it was. ${plural(r.moved, "new file")} moved to ${r.aside}`
        : `Back as it was: ${plural(r.restored, "file")} put back`,
      { mood: "happy" },
    );
  sync.soon();
  return !!r;
}
