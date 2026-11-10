// HTTP routes for the web app's Git client (see gitclient.ts):
//
//   GET  /git/repos                         repositories: opened directly, and pair targets
//   POST /git/repos                         {"action": "clone"|"create"|"add", "url", "path"}
//   POST /git/repos/remove                  {"id"}: forget a repository (nothing is deleted)
//   GET  /git/{id}/{state|log|commit|commit-diff|diff|branches|stashes|tags|worktrees|prs|issues|insights|conflict|ai-message|files|file|
//                  folder|remote-check|undo-timeline|push-check|blame|file-history|search}
//   POST /git/{id}/{stage|unstage|stage-lines|discard|commit|undo|fetch|pull|push|branch-*|merge|cherry-pick|
//                   revert|tag-*|stash|stash-apply|stash-drop|worktree-*|resolve|finish|pr-checkout|issue-start|restore|branch-at|
//                   shape-diff|shape-message|shape-commit}   (GET /git/{id}/shape: the timeline to shape, see shape.ts)
//
// When a repository is also the target of a folder pair, actions that change
// its files (switching branches, pulling, merging…) pause that pair first,
// so Ferry doesn't sync the result back into the working folder.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import * as ai from "./ai.ts";
import { batchTime, history } from "./engine/journal.ts";
import type { Engine } from "./engine/engine.ts";
import * as g from "./gitclient.ts";
import * as conn from "./integrations.ts";
import * as reviews from "./reviews.ts";
import * as shaper from "./shape.ts";
import { errMsg } from "./util.ts";

export interface RepoManager {
  list(): string[];
  add(dir: string): void;
  remove(dir: string): void;
}

interface Repo {
  id: string;
  name: string;
  path: string;
  pairs: string[];
  standalone: boolean;
}

const idOf = (root: string) => crypto.createHash("sha256").update(root).digest("hex").slice(0, 12);

async function originURL(root: string): Promise<string> {
  const r = Bun.spawnSync(["git", "-C", root, "remote", "get-url", "origin"], { env: { ...process.env, LC_ALL: "C" } });
  if (r.exitCode !== 0) throw new g.GitClientError("this repository has no remote called origin", "no-remote");
  return r.stdout.toString().trim();
}

/** Actions that rewrite files in the work tree: a pair syncing this repository is paused first. */
const CHANGES_FILES = new Set([
  "branch-switch", "pull", "merge", "cherry-pick", "revert", "undo", "discard", "stash", "stash-apply",
  "resolve", "finish", "pr-checkout", "issue-start", "restore",
]);

/** Background remote checks fetch at most this often per repository; force=1 (before a push) always fetches. */
const REMOTE_CHECK_EVERY_MS = 60_000;

export class GitApi {
  private lastFetch = new Map<string, number>();
  constructor(private engines: Engine[], private repos: RepoManager | null) {}

  async list(): Promise<Repo[]> {
    const out = new Map<string, Repo>();
    for (const dir of this.repos?.list() ?? []) {
      const root = (await g.repoRoot(dir)) ?? path.resolve(dir);
      out.set(root, { id: idOf(root), name: path.basename(root), path: root, pairs: [], standalone: true });
    }
    for (const e of this.engines) {
      if (e.cfg.remote || e.cfg.cloud || !fs.existsSync(e.cfg.target)) continue;
      const root = await g.repoRoot(e.cfg.target);
      if (!root) continue;
      const r = out.get(root) ?? { id: idOf(root), name: path.basename(root), path: root, pairs: [], standalone: false };
      r.pairs.push(e.name);
      out.set(root, r);
    }
    return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async handle(req: Request, url: URL, parts: string[]): Promise<Response> {
    try {
      if (parts[1] === "repos") return await this.reposRoute(req, parts);
      const repo = (await this.list()).find((r) => r.id === parts[1]);
      if (!repo) return fail("that repository isn't open in Ferry", 404);
      const action = parts[2] ?? "state";
      if (req.method === "GET") return await this.read(repo, action, url.searchParams);
      if (req.method === "POST") return await this.write(repo, action, await body(req));
      return fail("method not allowed", 405);
    } catch (e) {
      const known = e instanceof g.GitClientError || e instanceof conn.IntegrationError;
      return json({ error: errMsg(e), code: known ? (e as g.GitClientError).code : "" }, known ? 409 : 500);
    }
  }

  private async reposRoute(req: Request, parts: string[]): Promise<Response> {
    if (req.method === "GET" && parts.length === 2) return json(await this.list());
    if (req.method !== "POST") return fail("method not allowed", 405);
    if (!this.repos) return fail("opening repositories needs ferry ui", 405);
    const b = await body(req);
    if (parts[2] === "remove") {
      const r = (await this.list()).find((x) => x.id === b.id);
      if (!r || !r.standalone) return fail("only repositories you opened yourself can be removed from the list", 400);
      this.repos.remove(r.path);
      return json({ removed: r.path });
    }
    let dir: string;
    if (b.action === "clone") dir = await g.clone(b.url, b.path);
    else if (b.action === "create") dir = await g.create(b.path);
    else if (b.action === "add") {
      const root = await g.repoRoot(String(b.path ?? ""));
      if (!root) return fail("that folder isn't a git repository (choose “Create” to make it one)", 400);
      dir = root;
    } else return fail("action must be clone, create or add", 400);
    this.repos.add(dir);
    return json({ id: idOf((await g.repoRoot(dir)) ?? dir), path: dir });
  }

  private async read(r: Repo, action: string, q: URLSearchParams): Promise<Response> {
    const root = r.path;
    switch (action) {
      case "state": return json({ ...(await g.state(root)), name: r.name, pairs: r.pairs, standalone: r.standalone });
      case "log": return json(await g.log(root, { skip: Number(q.get("skip") ?? 0), limit: Number(q.get("limit") ?? 50), ref: q.get("ref") || undefined, all: q.get("all") === "1" }));
      case "commit": return json(await g.commitDetail(root, q.get("hash")));
      case "commit-diff": return json(await g.commitFileDiff(root, q.get("hash"), q.get("path")));
      case "diff": return json(await g.fileDiff(root, q.get("path"), q.get("staged") === "1"));
      case "conflict": return json(await g.conflictDiff(root, q.get("path")));
      case "files": return json(await g.trackedFiles(root));
      case "folder": return json(await g.folderEntries(root, q.get("dir")));
      case "undo-timeline": return json(await g.undoTimeline(root, Number(q.get("limit") ?? 150)));
      case "push-check": return json(await g.prePushCheck(root));
      case "blame": return json(await g.blame(root, q.get("path")));
      case "file-history": return json(await g.fileHistory(root, q.get("path")));
      case "search": return json(await g.searchHistory(root, q.get("q"), q.get("mode"), q.get("all") === "1"));
      case "pr-conversation": return json(await reviews.conversation(root, q.get("number")));
      case "remote-check": {
        const now = Date.now();
        const due = q.get("force") === "1" || now - (this.lastFetch.get(root) ?? 0) >= REMOTE_CHECK_EVERY_MS;
        if (due) this.lastFetch.set(root, now);
        const r = await g.remoteCheck(root, due);
        return json({ ...r, checkedAt: new Date(this.lastFetch.get(root) ?? now).toISOString() });
      }
      case "file": {
        // raw=1: an image's bytes, for pictures a README references (only image types are served)
        if (q.get("raw") === "1") {
          const img = await g.rawImage(root, q.get("path"));
          return new Response(img.data, { headers: { "Content-Type": img.type, "Cache-Control": "no-store" } });
        }
        return json(await g.readFile(root, q.get("path")));
      }
      case "branches": return json(await g.branches(root));
      case "stashes": return json(await g.stashes(root));
      case "tags": return json(await g.tags(root));
      case "worktrees": return json(await g.worktrees(root));
      case "prs": {
        // GitHub through gh; GitLab and Azure DevOps through their APIs once connected (glab as a fallback for GitLab)
        const remote = conn.parseRemote(await originURL(root));
        if (remote.kind === "azure") return json({ provider: "Azure DevOps", items: await conn.azurePullRequests(remote) });
        if (remote.kind === "gitlab" && conn.status().gitlab.connected) return json({ provider: "GitLab", items: await conn.gitlabMergeRequests(remote) });
        return json(await g.pullRequests(root));
      }
      case "issues": return json(await conn.jiraMyIssues());
      case "shape": return json(await shaper.timeline(root, this.engines));
      case "insights": return json({ ...(await g.insights(root, { author: q.get("author") === "me" ? "me" : "" })), sync: this.syncDays(root) });
      case "ai-message": {
        const st = await g.state(root);
        const lines = st.files.filter((f) => f.staged).map((f) => `${f.x}  ${f.path}`);
        if (!lines.length) throw new g.GitClientError("stage some changes first, then I can describe them");
        const diff = await (await import("./gitx.ts")).pendingDiff(root, true);
        const { msg, error } = await ai.tryCommitMessage(lines, diff);
        if (msg === null) throw new g.GitClientError(error, "ai");
        return json({ message: msg });
      }
    }
    return fail("unknown action " + action, 404);
  }

  private async write(r: Repo, action: string, b: Record<string, unknown>): Promise<Response> {
    const root = r.path;
    const paused = CHANGES_FILES.has(action) ? this.pausePairs(root) : [];
    const done = (extra: Record<string, unknown> = {}) => json({ ok: action, paused, ...extra });
    switch (action) {
      case "stage": await g.stage(root, b.files); return done();
      case "unstage": await g.unstage(root, b.files); return done();
      case "stage-lines": return done({ lines: await g.stageLines(root, b.path, b.lines) });
      case "discard": return done({ discarded: await g.discard(root, b.files) });
      case "commit": return done({ commit: await g.commit(root, b.message, { amend: b.amend === true, coAuthors: b.co_authors }) });
      case "undo": return done(await g.undoCommit(root));
      case "fetch": await g.fetchAll(root); return done();
      case "pull": return done(await g.pull(root, b.strategy));
      case "restore": await g.restoreTo(root, b.hash); return done();
      case "pr-reply": await reviews.reply(root, b.number, b.thread, b.body); return done();
      case "pr-comment": await reviews.comment(root, b.number, b.subject, b.body); return done();
      case "pr-resolve": await reviews.resolve(root, b.number, b.thread, b.resolved === true); return done();
      case "branch-at": return done({ branch: await g.branchAt(root, b.name, b.hash) });
      case "push": return done({ branch: await g.push(root, b.force === true) });
      case "branch-create": return done({ branch: await g.createBranch(root, b.name, b.from, b.checkout !== false) });
      case "branch-switch": return done({ branch: await g.switchBranch(root, b.name) });
      case "branch-rename": await g.renameBranch(root, b.from, b.to); return done();
      case "branch-delete": await g.deleteBranch(root, b.name, b.force === true); return done();
      case "merge": return done(await g.merge(root, b.branch));
      case "cherry-pick": return done(await g.cherryPick(root, b.hash));
      case "revert": return done(await g.revert(root, b.hash));
      case "tag-create": return done({ tag: await g.createTag(root, b.name, b.message, b.at) });
      case "tag-delete": await g.deleteTag(root, b.name); return done();
      case "tag-push": await g.pushTags(root, b.name); return done();
      case "stash": await g.stash(root, b.message); return done();
      case "stash-apply": await g.stashApply(root, b.ref, b.pop === true); return done();
      case "stash-drop": await g.stashDrop(root, b.ref); return done();
      case "worktree-add": {
        const dir = await g.addWorktree(root, b.path, b.branch, b.create === true);
        if (b.open === true) this.repos?.add(dir);
        return done({ path: dir });
      }
      case "worktree-remove": await g.removeWorktree(root, b.path, b.force === true); return done();
      case "resolve": await g.resolveConflict(root, b.path, b.choice); return done();
      case "finish": await g.finishOperation(root, b.action === "abort" ? "abort" : "continue"); return done();
      case "pr-checkout": {
        const remote = conn.parseRemote(await originURL(root));
        if (remote.kind === "github" || (remote.kind === "gitlab" && !conn.status().gitlab.connected)) await g.checkoutPullRequest(root, b.number);
        else return done({ branch: await g.checkoutRemoteBranch(root, b.branch) });
        return done();
      }
      case "shape-diff": return json(await shaper.groupDiff(root, this.engines, b));
      case "shape-message": {
        // a message for one group of syncs, from what it changed
        const t = await shaper.timeline(root, this.engines);
        const ids = new Set(Array.isArray(b.batches) ? (b.batches as unknown[]).map(String) : []);
        const files = [...new Map(t.batches.filter((x) => ids.has(x.id)).flatMap((x) => x.files).map((f) => [f.path, f])).values()];
        if (!files.length) throw new g.GitClientError("that step isn't in the timeline any more", "stale");
        let diff = "";
        for (const f of files.slice(0, 20)) {
          const d = await shaper.groupDiff(root, this.engines, { batches: [...ids], path: f.path });
          diff += `--- ${f.path}\n` + d.lines.slice(0, 120).map((l) => (l.op === "@" ? "@@ " : l.op) + l.text).join("\n") + "\n";
          if (diff.length > 40_000) break;
        }
        const { msg, error } = await ai.tryCommitMessage(files.map((f) => `${f.op === "add" ? "A" : f.op === "delete" ? "D" : "M"}  ${f.path}`), diff);
        if (msg === null) throw new g.GitClientError(error, "ai");
        return done({ message: msg });
      }
      case "shape-commit": return done(await shaper.shape(root, this.engines, b));
      case "issue-start": {
        // a branch named after the issue, and (if asked) the issue moved to "in progress"
        const key = String(b.key ?? "");
        const name = typeof b.branch === "string" && b.branch.trim() ? b.branch : conn.branchForIssue(key, String(b.summary ?? ""));
        const branch = await g.createBranch(root, name, "", true);
        const moved = b.transition === true ? await conn.jiraStartProgress(key).catch((e) => "!" + errMsg(e)) : "";
        return done({ branch, moved });
      }
    }
    return fail("unknown action " + action, 404);
  }

  /**
   * Files Ferry wrote into this repository per day, from the pairs' journals
   * (the last JOURNAL_KEEP syncs of each), or null when no pair syncs here.
   */
  private syncDays(root: string): { pairs: string[]; days: Record<string, number>; since: string } | null {
    const pairs = this.engines.filter((e) => !e.cfg.remote && !e.cfg.cloud && inside(path.resolve(e.cfg.target), root));
    if (!pairs.length) return null;
    const days: Record<string, number> = {};
    let since = "";
    for (const e of pairs) {
      for (const b of history(e.dataDir, e.id)) {
        if (b.undone) continue;
        const t = new Date(batchTime(b));
        const day = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
        const n = b.entries.filter((x) => x.side === "target").length;
        if (!n) continue;
        days[day] = (days[day] ?? 0) + n;
        if (!since || day < since) since = day;
      }
    }
    return { pairs: pairs.map((e) => e.name), days, since };
  }

  /** Pauses every running pair whose target is inside root; returns their names. */
  private pausePairs(root: string): string[] {
    const names: string[] = [];
    for (const e of this.engines) {
      const t = path.resolve(e.cfg.target);
      if (e.cfg.remote || e.cfg.cloud || !inside(t, root)) continue;
      if (!e.getStatus().userPaused) {
        e.setPaused(true);
        names.push(e.name);
      }
    }
    return names;
  }
}

const inside = (p: string, root: string) => p === root || p.startsWith(root + path.sep);

async function body(req: Request): Promise<Record<string, unknown>> {
  try {
    const b = await req.json();
    return b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function json(v: unknown, status = 200): Response {
  return new Response(JSON.stringify(v) + "\n", { status, headers: { "Content-Type": "application/json" } });
}

function fail(msg: string, status: number): Response {
  return json({ error: msg, code: "" }, status);
}
