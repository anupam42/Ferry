// The Git client: repositories, the selected one's state, and the actions on it.
import { api, ApiError, enc } from "./api.ts";
import { act, app, ask, toast } from "./app.svelte.ts";
import { plural } from "./format.ts";
import type { PullRequest, PushIssue, RemoteCheckResponse, RepoEntry, RepoStateResponse } from "./types.ts";

export type GitView =
  | "files"
  | "changes"
  | "history"
  | "insights"
  | "branches"
  | "stashes"
  | "prs"
  | "issues"
  | "tags"
  | "worktrees"
  | "undo";
export type RemoteJob = "" | "fetch" | "pull" | "push";

class Git {
  repos = $state<RepoEntry[]>([]);
  loaded = $state(false);
  selected = $state(localStorage.getItem("ferry-repo") || "");
  /** the selected repository's state; null while loading or when it can't be read */
  state = $state<RepoStateResponse | null>(null);
  error = $state("");
  view = $state<GitView>("changes");
  /** what the remote has, per repository */
  remote = $state<Record<string, RemoteCheckResponse>>({});
  /** fetch / pull / push running, or just finished */
  busy = $state<RemoteJob>("");
  done = $state<{ job: RemoteJob; until: number } | null>(null);
  /** bumped after every action, so views that load their own data reload */
  bump = $state(0);
  /** drawers */
  adding = $state(false);
  review = $state<string | null>(null);
  conflict = $state<string | null>(null);
  /** the commit open in the commit drawer */
  commit = $state<string | null>(null);
  /** two branches (or tags, or commits) side by side in the compare drawer */
  compare = $state<{ base: string; head: string } | null>(null);
  /** the pull request open in the conversation drawer, or whose checks are shown */
  pr = $state<{ pr: PullRequest; provider: string } | null>(null);
  checks = $state<PullRequest | null>(null);
  /** Shape my history is open */
  shaping = $state(false);
  /** the file open in the file drawer */
  file = $state<string | null>(null);
  /** the folder the Files view shows, per repository */
  folder = $state<Record<string, string>>({});

  current = $derived(this.repos.find((r) => r.id === this.selected) ?? null);
  url = (action: string) => `/git/${this.selected}/${action}`;

  select(id: string): void {
    if (id === this.selected) return;
    this.selected = id;
    localStorage.setItem("ferry-repo", id);
    this.state = null;
    this.error = "";
    void this.refresh().then(() => this.checkRemote(false));
  }

  async refresh(): Promise<void> {
    try {
      this.repos = await api<RepoEntry[]>("GET", "/git/repos");
    } catch {
      this.repos = [];
    }
    this.loaded = true;
    if (!this.repos.some((r) => r.id === this.selected)) this.selected = this.repos[0]?.id ?? "";
    if (!this.selected) {
      this.state = null;
      return;
    }
    const id = this.selected;
    try {
      const st = await api<RepoStateResponse>("GET", this.url("state"));
      if (id === this.selected) {
        this.state = st;
        this.error = "";
      }
    } catch (e) {
      if (id === this.selected) {
        this.state = null;
        this.error = (e as Error).message;
      }
    }
  }

  /**
   * Runs a Git action, says how it went, and refreshes. Throws on failure
   * (with the server's code, e.g. "diverged"), after refreshing.
   */
  async act<T extends Record<string, unknown>>(
    action: string,
    body: Record<string, unknown> = {},
    ok?: string | ((r: T) => string),
    mood = "happy",
  ): Promise<T> {
    try {
      const r = await api<T & { paused?: string[]; conflicts?: string[] }>("POST", this.url(action), body);
      const text = typeof ok === "function" ? ok(r) : ok;
      if (text) toast(text, { mood });
      if (r.paused?.length)
        toast(`I paused syncing ${r.paused.join(", ")} while you do this. Resume it when you're ready.`, {
          mood: "sleepy",
        });
      if (r.conflicts?.length)
        toast(`${plural(r.conflicts.length, "file")} need your decision: see the top of the page.`, {
          error: true,
          mood: "worried",
        });
      return r;
    } finally {
      this.bump++;
      await this.refresh();
    }
  }

  /** act(), but failures become a toast and null. */
  async try<T extends Record<string, unknown>>(
    action: string,
    body: Record<string, unknown> = {},
    ok?: string | ((r: T) => string),
    mood = "happy",
  ): Promise<T | null> {
    try {
      return await this.act<T>(action, body, ok, mood);
    } catch (e) {
      toast((e as Error).message, { error: true });
      return null;
    }
  }

  /** Asks the server what the remote has (it fetches at most once a minute unless force); announces new arrivals. */
  async checkRemote(force: boolean, quiet = false): Promise<RemoteCheckResponse | null> {
    const id = this.selected;
    if (!id) return null;
    let r: RemoteCheckResponse;
    try {
      r = await api<RemoteCheckResponse>("GET", this.url("remote-check") + (force ? "?force=1" : ""));
    } catch {
      return null;
    }
    const prev = this.remote[id];
    this.remote[id] = r;
    if (!quiet && prev && r.behind > prev.behind && this.selected === id) {
      const fresh = r.incoming.slice(0, r.behind - prev.behind);
      toast(
        `${whoPushed(fresh)} pushed ${plural(r.behind - prev.behind, "commit")} to ${r.upstream}. Pull to stay in step.`,
        { mood: "surprised" },
      );
    }
    if (this.selected === id && this.state && (this.state.behind !== r.behind || this.state.ahead !== r.ahead)) {
      this.state = { ...this.state, behind: r.behind, ahead: r.ahead };
    }
    return r;
  }

  start(): void {
    void this.refresh().then(() => this.checkRemote(false));
    // only while the Git client is on screen
    const onScreen = () => !document.hidden && app.mode === "git";
    setInterval(() => {
      if (onScreen()) void this.refresh();
    }, 3000);
    // keep an eye on the remote while a repository is open
    setInterval(() => {
      if (onScreen() && !this.busy) void this.checkRemote(false);
    }, 90_000);
    document.addEventListener("visibilitychange", () => {
      if (onScreen()) void this.checkRemote(false);
    });
  }
}

export const git = new Git();

export { fileList, repoMood, whoPushed, type RepoMood } from "./gitmood.ts";
import { fileList, whoPushed } from "./gitmood.ts";

// ---------- fetch, pull and push, safely ----------

/** Runs one remote job at a time, keeping the dock's animation in step. */
export async function remoteJob(job: Exclude<RemoteJob, "">, run: () => Promise<boolean>): Promise<void> {
  if (git.busy) return;
  git.busy = job;
  let ok = false;
  try {
    ok = await run();
  } finally {
    git.busy = "";
    if (ok) {
      git.done = { job, until: Date.now() + 1600 };
      setTimeout(() => {
        if (git.done?.job === job) git.done = null;
      }, 1700);
    }
  }
}

export async function doFetch(): Promise<boolean> {
  const r = await git.try("fetch", {}, "Fetched the latest from the remote", "happy");
  await git.checkRemote(false);
  return !!r;
}

/** After a pull: false while a merge or rebase still needs you. */
async function afterRemote(): Promise<boolean> {
  const now = git.state;
  await git.checkRemote(false, true);
  if (now && (now.operation || now.files.some((f) => f.conflicted))) {
    toast(
      now.operation
        ? "Some files need your decision before you carry on: see the top of the page."
        : "Pulled. Some of your edits overlap what came in: pick what to keep at the top of the page.",
      { error: true, mood: "worried" },
    );
    return false;
  }
  return true;
}

/** Pull: warns first when incoming commits touch files you're editing (the server sets those edits aside and puts them back). */
export async function doPull(strategy = "", quiet = false): Promise<boolean> {
  const st = git.state,
    rc = git.remote[git.selected];
  if (!strategy && !quiet && st && rc) {
    const dirty = rc.overlap.filter((p) => st.files.some((f) => f.path === p));
    if (dirty.length) {
      const ok = await ask({
        mood: "thinking",
        title: "Incoming changes touch files you're editing",
        text: `${fileList(dirty)} ${dirty.length === 1 ? "was" : "were"} also changed on ${rc.upstream}. I'll set your uncommitted edits aside, pull, then put them back. If both sides changed the same lines, you'll pick what to keep.`,
        yes: "Pull safely",
        no: "Not now",
        yesMood: "wink",
        primary: "yes",
      });
      if (!ok) return false;
    }
  }
  try {
    await git.act("pull", { strategy }, quiet ? "" : "Pulled the latest commits", "party");
    return await afterRemote();
  } catch (e) {
    if (e instanceof ApiError && e.code === "diverged") {
      const rebase = await ask({
        mood: "thinking",
        title: "Both sides have new commits.",
        primary: "yes",
        text: "Your branch and the remote have each moved on. Rebase replays your commits on top of the remote's, for a straight line (usually what you want). Merge keeps both histories as they are.",
        yes: "Rebase my commits",
        no: "Merge them",
        yesMood: "wink",
        noMood: "thinking",
      });
      const r = await git.try(
        "pull",
        { strategy: rebase ? "rebase" : "merge" },
        quiet ? "" : "Caught up with the remote",
        "party",
      );
      return r ? await afterRemote() : false;
    }
    if (!(e instanceof ApiError && e.code === "conflicts")) toast((e as Error).message, { error: true });
    return false;
  }
}

const ISSUE: Record<PushIssue["kind"], string> = {
  secret: "Possible secret",
  "env-file": "Secret file",
  "conflict-marker": "Conflict marker",
  "large-file": "Large file",
  debug: "Leftover debugging",
};

/** Before anything leaves the machine: secrets, .env files, conflict markers, huge files, leftover debugging. */
async function pushPreflight(): Promise<boolean> {
  let r: { issues: PushIssue[] };
  try {
    r = await api("GET", git.url("push-check"));
  } catch {
    return true;
  } // a failed check shouldn't stop a push
  if (!r.issues.length) return true;
  const blocks = r.issues.filter((i) => i.level === "block");
  return ask({
    mood: blocks.length ? "worried" : "thinking",
    title: blocks.length
      ? `Hold on: ${plural(blocks.length, "thing")} in this push can't be taken back`
      : `${plural(r.issues.length, "small thing")} to look at before pushing`,
    text: blocks.length
      ? "Once these are pushed, everyone with access has them, and they stay in history even if you delete them later. Fix them (or undo the commit), then push."
      : "Nothing dangerous, just things people usually don't mean to share.",
    items: r.issues.slice(0, 6).map((i) => ({
      label: ISSUE[i.kind] ?? i.kind,
      where: i.file + (i.line ? ":" + i.line : ""),
      text: i.text,
      level: i.level,
    })),
    more: Math.max(0, r.issues.length - 6),
    yes: "Push anyway",
    no: blocks.length ? "Don't push" : "Fix first",
    hold: blocks.length > 0,
    yesMood: "worried",
  });
}

/** Push: checks the remote first, and if someone pushed meanwhile, offers to bring their commits in before pushing. */
export async function doPush(force = false): Promise<boolean> {
  const st = git.state;
  if (!force && st && (st.ahead || !st.upstream) && !(await pushPreflight())) return false;
  if (!force && st?.upstream) {
    const rc = await git.checkRemote(true, true);
    if (rc?.error)
      toast("I couldn't check the remote (" + rc.error + "). Trying the push anyway.", {
        error: true,
        mood: "worried",
      });
    if (rc && rc.behind > 0) {
      const both = rc.ahead > 0;
      const text =
        `${whoPushed(rc.incoming)} pushed ${plural(rc.behind, "commit")} to ${rc.upstream} since you last pulled, so a push now would bounce. ` +
        (both
          ? `I'll replay your ${plural(rc.ahead, "commit")} on top of theirs (a rebase, your edits stay safe), then push.`
          : "I'll pull them in first, then push.") +
        (rc.overlap.length
          ? ` Heads-up: ${fileList(rc.overlap)} changed on both sides, so you may need to pick what to keep.`
          : " Their changes don't touch your files, so this should be smooth.");
      const ok = await ask({
        mood: rc.overlap.length ? "worried" : "thinking",
        title: "The remote moved on. Pull first?",
        text,
        yes: "Pull, then push",
        no: "Cancel",
        yesMood: "wink",
        primary: "yes",
      });
      if (!ok) return false;
      if (!(await doPull(both ? "rebase" : "", true))) return false;
    }
  }
  try {
    await git.act<{ branch: string }>("push", { force }, (r) => `Pushed ${r.branch}`, "party");
    await git.checkRemote(false, true);
    return true;
  } catch (e) {
    if (e instanceof ApiError && e.code === "rejected" && !force) {
      const rewrote = git.state?.lastCommit?.pushed === false;
      const ok = await ask({
        mood: "worried",
        title: "The remote has commits you don't have.",
        yes: "Pull now",
        no: "Not now",
        primary: "yes",
        text: rewrote
          ? "Pull first to bring them in. If you rewrote commits on purpose (amend, undo), you can force-push instead, which replaces the remote's version."
          : "Pull first to bring them in, then push again.",
      });
      if (ok) return doPull();
    } else toast((e as Error).message, { error: true });
    return false;
  }
}

// ---------- other actions several views share ----------

export async function discardFiles(files: string[], label: string): Promise<void> {
  const ok = await ask({
    mood: "worried",
    hold: files.length === 0,
    title: `Discard ${files.length ? label : "every change"}?`,
    yes: "Discard",
    no: "Keep my changes",
    yesMood: "sad",
    text: "The file goes back to how it was in the last commit. Your current version goes to the Trash, so you can still get it back.",
  });
  if (ok)
    await git.try<{ discarded: number }>(
      "discard",
      { files },
      (r) => `Discarded ${plural(r.discarded, "file")} (copies are in the Trash)`,
      "wink",
    );
}

export async function removeRepo(r: RepoEntry): Promise<void> {
  const ok = await ask({
    mood: "thinking",
    title: `Remove ${r.name} from the list?`,
    text: "Only the list entry goes. The repository and its files stay exactly where they are.",
    yes: "Remove",
    no: "Keep it",
  });
  if (!ok) return;
  await act("Removed from the list", () => api("POST", "/git/repos/remove", { id: r.id }), "wink");
  git.selected = "";
  await git.refresh();
}

/** Settles one conflicted file. */
export const resolveFile = (path: string, choice: "ours" | "theirs" | "both" | "done", text: string) =>
  git.try("resolve", { path, choice }, `${path}: ${text}`);

export const fileURL = (action: string, path: string, staged = false) =>
  git.url(action) + "?path=" + enc(path) + (staged ? "&staged=1" : "");
