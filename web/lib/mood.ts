// Relay's face and words for a folder pair's state.
import { ago, plural } from "./format.ts";
import type { PairStatus } from "./types.ts";

export type Tone = "green" | "blue" | "amber" | "red";
export interface Mood {
  face: string;
  /** the animated comparing art, rather than a still face */
  anim?: boolean;
  say: string;
  hint: string;
  /** 0–1 while comparing */
  progress?: number;
  tone: Tone;
  label: string;
}

/** lastError: the pair's most recent error, if it happened in the last two minutes. */
export function mood(p: PairStatus, lastError?: { at: number; msg: string }, now = Date.now()): Mood {
  if (p.comparing) {
    const { done, total } = p.comparing;
    return {
      face: "comparing",
      anim: true,
      say: "I'm comparing your files…",
      hint: `${done} of ${total} checked by content`,
      progress: total ? done / total : 0,
      tone: "blue",
      label: `comparing ${done}/${total}`,
    };
  }
  if (p.conflicts.length)
    return {
      face: "worried",
      say: `${plural(p.conflicts.length, "file")} changed in both folders.`,
      hint: "Pick which version to keep below. Nothing is overwritten until you decide.",
      tone: "red",
      label: plural(p.conflicts.length, "conflict"),
    };
  if (lastError && now - lastError.at < 120_000)
    return { face: "sad", say: "Something went wrong.", hint: lastError.msg, tone: "red", label: "error" };
  if (p.pending_batch > 0)
    return {
      face: "surprised",
      say: `That's a lot: ${p.pending_batch} changes at once.`,
      hint: "Approve them when you're ready (button above).",
      tone: "amber",
      label: "waiting for you",
    };
  if (p.user_paused)
    return {
      face: "sleepy",
      say: "Paused. Taking a nap.",
      hint: "I'll catch up on everything you change when you resume.",
      tone: "amber",
      label: "paused",
    };
  if (p.guard_reason)
    return { face: "thinking", say: "Paused for a moment.", hint: p.guard_reason, tone: "amber", label: "paused" };
  if (p.pending || !p.watcher)
    return { face: "focused", say: "Syncing…", hint: "Copying what changed.", tone: "blue", label: "syncing" };
  const synced = !!p.last_sync && !p.last_sync.startsWith("0001");
  const fresh = synced && now - Date.parse(p.last_sync) < 8000;
  const last = synced ? " · last copy " + ago(p.last_sync) : "";
  return {
    face: fresh ? "party" : "happy",
    say: fresh ? "Done! Everything's copied." : "All synced.",
    hint: `The target matches your working folder${last}.`,
    tone: "green",
    label: "watching",
  };
}
