// Relay's take on a repository, and small wording helpers (plain TypeScript, unit-tested).
import { plural } from "./format.ts";
import type { Tone } from "./mood.ts";
import type { RepoStateResponse } from "./types.ts";

export interface RepoMood { face: string; say: string; hint: string; tone: Tone; label: string }

const OPERATION: Record<string, (st: RepoStateResponse) => string> = {
  merge: (st) => `Merging ${st.operationBranch || "a branch"} into ${st.branch}`,
  rebase: () => "Rebasing",
  "cherry-pick": () => "Cherry-picking a commit",
  revert: () => "Reverting a commit",
};

export function repoMood(st: RepoStateResponse | null, error = ""): RepoMood {
  if (!st) return { face: "sad", say: "I can't read this repository.", hint: error, tone: "red", label: "error" };
  const conflicts = st.files.filter((f) => f.conflicted).length;
  if (st.operation) {
    const what = OPERATION[st.operation]!(st);
    return conflicts
      ? { face: "worried", say: `${what}: ${plural(conflicts, "file")} ${conflicts === 1 ? "needs" : "need"} you.`, hint: "Choose which version to keep for each file below, then press Continue.", tone: "red", label: st.operation + " in progress" }
      : { face: "thinking", say: `${what}: all conflicts are settled.`, hint: "Press Continue to finish, or Abort to go back.", tone: "amber", label: st.operation + " in progress" };
  }
  const staged = st.files.filter((f) => f.staged).length;
  if (st.behind) return { face: "thinking", say: `There ${st.behind === 1 ? "is 1 new commit" : `are ${st.behind} new commits`} on ${st.upstream}.`, hint: "Pull to catch up" + (st.files.length ? `. You also have ${plural(st.files.length, "changed file")}.` : "."), tone: "amber", label: `${st.behind} behind` };
  if (st.files.length) return { face: "focused", say: `${plural(st.files.length, "file")} changed${staged ? `, ${staged} ready to commit` : ""}.`, hint: staged ? "Write a message and commit when you're ready." : "Tick the files (or lines) you want in the next commit.", tone: "blue", label: plural(st.files.length, "change") };
  if (st.ahead) return { face: "wink", say: `${plural(st.ahead, "commit")} ready to push.`, hint: `Push to share them on ${st.upstream}.`, tone: "blue", label: `${st.ahead} to push` };
  if (!st.head) return { face: "excited", say: "A brand-new repository!", hint: "Add some files, then make your first commit.", tone: "green", label: "empty" };
  return { face: "happy", say: "Everything's committed.", hint: st.upstream ? `In step with ${st.upstream}.` : "This branch isn't on a remote yet: push to publish it.", tone: "green", label: "clean" };
}

export const whoPushed = (commits: { author: string }[]) => {
  const names = [...new Set(commits.map((c) => c.author).filter(Boolean))];
  return names.length === 0 ? "Someone" : names.length === 1 ? names[0]! : names.length === 2 ? names.join(" and ") : `${names[0]}, ${names[1]} and ${names.length - 2} more`;
};
export const fileList = (files: string[], max = 3) => files.slice(0, max).map((p) => p.split("/").pop()).join(", ") + (files.length > max ? ` and ${files.length - max} more` : "");

