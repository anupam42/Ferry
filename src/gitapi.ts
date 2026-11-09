// HTTP routes for the web app's Git client (see gitclient.ts):
//
//   GET  /git/repos                         repositories: opened directly, and pair targets
//   POST /git/repos                         {"action": "clone"|"create"|"add", "url", "path"}
//   POST /git/repos/remove                  {"id"}: forget a repository (nothing is deleted)
//   GET  /git/{id}/{state|log|commit|commit-diff|diff|branches|stashes|tags|worktrees|prs|conflict|ai-message}
//   POST /git/{id}/{stage|unstage|stage-lines|discard|commit|undo|fetch|pull|push|branch-*|merge|cherry-pick|
//                   revert|tag-*|stash|stash-apply|stash-drop|worktree-*|resolve|finish|pr-checkout}
//
// When a repository is also the target of a folder pair, actions that change
// its files (switching branches, pulling, merging…) pause that pair first,
// so Ferry doesn't sync the result back into the working folder.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import * as ai from "./ai.ts";
import type { Engine } from "./engine/engine.ts";
import * as g from "./gitclient.ts";
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

/** Actions that rewrite files in the work tree: a pair syncing this repository is paused first. */
const CHANGES_FILES = new Set([
  "branch-switch", "pull", "merge", "cherry-pick", "revert", "undo", "discard", "stash", "stash-apply",
  "resolve", "finish", "pr-checkout",
]);

export class GitApi {
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
      const code = e instanceof g.GitClientError ? e.code : "";
      return json({ error: errMsg(e), code }, e instanceof g.GitClientError ? 409 : 500);
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
      case "log": return json(await g.log(root, { skip: Number(q.get("skip") ?? 0), limit: Number(q.get("limit") ?? 50), ref: q.get("ref") || undefined }));
      case "commit": return json(await g.commitDetail(root, q.get("hash")));
      case "commit-diff": return json(await g.commitFileDiff(root, q.get("hash"), q.get("path")));
      case "diff": return json(await g.fileDiff(root, q.get("path"), q.get("staged") === "1"));
      case "conflict": return json(await g.conflictDiff(root, q.get("path")));
      case "branches": return json(await g.branches(root));
      case "stashes": return json(await g.stashes(root));
      case "tags": return json(await g.tags(root));
      case "worktrees": return json(await g.worktrees(root));
      case "prs": return json(await g.pullRequests(root));
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
      case "pull": await g.pull(root, b.strategy); return done();
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
      case "pr-checkout": await g.checkoutPullRequest(root, b.number); return done();
    }
    return fail("unknown action " + action, 404);
  }

  /** Pauses every running pair whose target is inside root; returns their names. */
  private pausePairs(root: string): string[] {
    const names: string[] = [];
    for (const e of this.engines) {
      const t = path.resolve(e.cfg.target);
      if (e.cfg.remote || e.cfg.cloud || (t !== root && !t.startsWith(root + path.sep))) continue;
      if (!e.getStatus().userPaused) {
        e.setPaused(true);
        names.push(e.name);
      }
    }
    return names;
  }
}

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
