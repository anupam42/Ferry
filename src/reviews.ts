// Pull request conversations for the web app: read the description, the
// general comments, reviews and line comments (with the code they point at),
// reply to them, add a comment, and resolve or reopen threads.
//
// GitHub goes through the GitHub CLI (gh api graphql), GitLab through the
// connected token (or `glab api` when only the CLI is set up), Azure DevOps
// through the connected token. Comment text is always passed as data
// (stdin / JSON / a raw -f field), never through a shell.
import type { AzComment, AzList, AzPullRequest, AzThread, GhConversation, GhGraphQLResult, GhUser, GlDiscussion, GlMergeRequest, GlNote, GlUser } from "./apitypes.ts";
import fs from "node:fs";
import path from "node:path";

import { GitClientError } from "./gitclient.ts";
import * as conn from "./integrations.ts";
import { exec, which } from "./proc.ts";
import type { Conversation, Review, ReviewComment, ReviewThread, SnippetLine } from "./shared/git.ts";
export type { Conversation, Review, ReviewComment, ReviewThread, SnippetLine } from "./shared/git.ts";






const num = (v: unknown) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new GitClientError("not a pull request number");
  return n;
};
const text = (v: unknown, what = "comment") => {
  if (typeof v !== "string" || !v.trim()) throw new GitClientError(`write a ${what} first`);
  if (v.length > 60_000) throw new GitClientError(`that ${what} is too long`);
  return v;
};
const opaqueId = (v: unknown) => {
  const s = String(v ?? "");
  if (!/^[A-Za-z0-9_=:\-.]{1,200}$/.test(s)) throw new GitClientError("that isn't a comment thread");
  return s;
};

async function remote(root: string): Promise<conn.Remote & { url: string }> {
  const r = await exec(["git", "-C", root, "remote", "get-url", "origin"], {});
  if (r.code !== 0) throw new GitClientError("this repository has no remote called origin", "no-remote");
  const url = r.stdout.trim();
  return { ...conn.parseRemote(url), url };
}

/** Lines around `line` of a file on the pull request's branch (or the work tree), for line comments outside GitHub. */
async function snippetAround(root: string, branch: string, file: string, line: number | null): Promise<SnippetLine[]> {
  if (!line || !file) return [];
  let content = "";
  const r = branch ? await exec(["git", "-C", root, "show", `origin/${branch}:${file}`], {}) : { code: 1, stdout: "" };
  if (r.code === 0) content = r.stdout;
  else {
    try {
      const abs = path.resolve(root, file);
      if (abs.startsWith(path.resolve(root) + path.sep)) content = fs.readFileSync(abs, "utf8");
    } catch {}
  }
  if (!content) return [];
  const lines = content.split("\n");
  const from = Math.max(1, line - 4), to = Math.min(lines.length, line + 2);
  const out: SnippetLine[] = [];
  for (let n = from; n <= to; n++) out.push({ op: " ", no: n, text: lines[n - 1] ?? "", target: n === line });
  return out;
}

// ---------- GitHub (gh) ----------

const ghEnv = () => ({ ...process.env, GH_PROMPT_DISABLED: "1", NO_COLOR: "1" });

async function gh<T>(root: string, args: string[], stdin?: string): Promise<T> {
  if (!which("gh")) throw new GitClientError("install the GitHub CLI (gh) and run `gh auth login` to read and reply to reviews here", "no-cli");
  const r = await exec(["gh", ...args], { cwd: root, env: ghEnv(), stdin, timeoutMs: 60_000 });
  if (r.code !== 0) {
    const m = (r.stderr || r.error || "gh failed").trim().split("\n").slice(0, 2).join(" ");
    if (/Could not resolve to a PullRequest/i.test(m)) throw new GitClientError("there's no pull request with that number here", "not-found");
    throw new GitClientError(/auth|login|401/i.test(m) ? "gh isn't signed in: run `gh auth login`" : m, /auth|login|401/i.test(m) ? "auth" : "cli-failed");
  }
  const out = r.stdout.trim();
  return (out ? JSON.parse(out) : {}) as T;
}

function ghRepo(url: string): { owner: string; name: string } {
  const m = /github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(url.trim());
  if (!m) throw new GitClientError("couldn't tell which GitHub repository origin is");
  return { owner: m[1]!, name: m[2]! };
}

const GH_QUERY = `query($owner: String!, $name: String!, $num: Int!) {
  viewer { login }
  repository(owner: $owner, name: $name) { pullRequest(number: $num) {
    id title url body state headRefName baseRefName author { login }
    comments(first: 100) { nodes { id author { login } body createdAt } }
    reviews(first: 50) { nodes { author { login } state body submittedAt } }
    reviewThreads(first: 100) { nodes {
      id isResolved isOutdated path line originalLine viewerCanResolve viewerCanUnresolve
      comments(first: 50) { nodes { id author { login } body createdAt diffHunk } }
    } }
  } }
}`;

/** The end of a GitHub diff hunk (which stops at the commented line), numbered. */
function hunkSnippet(hunk: string, keep = 8): SnippetLine[] {
  const lines = hunk.split("\n");
  const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(lines[0] ?? "");
  let oldNo = m ? +m[1]! : 0, newNo = m ? +m[2]! : 0;
  const out: SnippetLine[] = [];
  for (const l of lines.slice(m ? 1 : 0)) {
    const op = (l[0] === "+" || l[0] === "-" ? l[0] : " ") as SnippetLine["op"];
    out.push({ op, no: op === "-" ? oldNo : newNo, text: l.slice(1), target: false });
    if (op !== "+") oldNo++;
    if (op !== "-") newNo++;
  }
  const tail = out.slice(-keep);
  if (tail.length) tail[tail.length - 1]!.target = true;
  return tail;
}

async function githubConversation(root: string, url: string, n: number): Promise<Conversation> {
  const { owner, name } = ghRepo(url);
  const r = await gh<GhConversation>(root, ["api", "graphql", "-f", "query=" + GH_QUERY, "-f", "owner=" + owner, "-f", "name=" + name, "-F", "num=" + n]);
  const pr = r?.data?.repository?.pullRequest;
  if (!pr) throw new GitClientError(`there's no pull request #${n} here`);
  const me = r?.data?.viewer?.login ?? "";
  const who = (a: GhUser | null | undefined) => a?.login ?? "ghost";
  return {
    provider: "GitHub", number: n, title: pr.title, url: pr.url, body: pr.body ?? "", author: who(pr.author), state: pr.state,
    branch: pr.headRefName, base: pr.baseRefName, subjectId: pr.id, me,
    comments: pr.comments.nodes.map((c) => ({ id: c.id, author: who(c.author), body: c.body, date: c.createdAt, mine: who(c.author) === me })),
    reviews: pr.reviews.nodes.filter((v) => v.state !== "PENDING").map((v) => ({ author: who(v.author), state: v.state, body: v.body ?? "", date: v.submittedAt ?? "" })),
    threads: pr.reviewThreads.nodes.map((t) => ({
      id: t.id, path: t.path, line: t.line ?? t.originalLine ?? null, resolved: t.isResolved, outdated: t.isOutdated,
      canResolve: t.isResolved ? !!t.viewerCanUnresolve : !!t.viewerCanResolve,
      snippet: t.comments.nodes[0]?.diffHunk ? hunkSnippet(t.comments.nodes[0].diffHunk) : [],
      comments: t.comments.nodes.map((c) => ({ id: c.id, author: who(c.author), body: c.body, date: c.createdAt, mine: who(c.author) === me })),
    })),
  };
}

async function githubMutate(root: string, mutation: string, vars: Record<string, string>): Promise<void> {
  const args = ["api", "graphql", "-f", "query=" + mutation];
  for (const [k, v] of Object.entries(vars)) args.push("-f", `${k}=${v}`);
  const r = await gh<GhGraphQLResult | null>(root, args);
  if (r?.errors?.length) throw new GitClientError(r.errors[0]!.message ?? "GitHub refused that");
}

// ---------- GitLab (token, or glab) ----------

async function gl<T>(root: string, method: "GET" | "POST" | "PUT", p: string, body?: Record<string, unknown>): Promise<T> {
  if (conn.status().gitlab.connected) return conn.gitlabApi<T>(method, p, body);
  if (!which("glab")) throw new GitClientError("connect GitLab (Connections, on the left), or install glab and run `glab auth login`", "not-connected");
  const args = ["glab", "api", "--method", method, p.replace(/^\//, "")];
  for (const [k, v] of Object.entries(body ?? {})) args.push(typeof v === "string" ? "-f" : "-F", `${k}=${v}`);
  const r = await exec(args, { cwd: root, timeoutMs: 60_000 });
  if (r.code !== 0) throw new GitClientError((r.stderr || r.error || "glab failed").trim().split("\n")[0]!, "cli-failed");
  return JSON.parse(r.stdout || "null") as T;
}

async function gitlabConversation(root: string, project: string, n: number): Promise<Conversation> {
  const id = encodeURIComponent(project);
  const [mr, discussions, me] = await Promise.all([
    gl<GlMergeRequest>(root, "GET", `/projects/${id}/merge_requests/${n}`),
    gl<GlDiscussion[]>(root, "GET", `/projects/${id}/merge_requests/${n}/discussions?per_page=100`),
    gl<GlUser>(root, "GET", "/user").catch(() => null),
  ]);
  const mine = (a: GlUser | null | undefined) => !!me && a?.username === me.username;
  const comments: ReviewComment[] = [], threads: ReviewThread[] = [];
  for (const d of discussions) {
    const notes = (d.notes ?? []).filter((x) => !x.system);
    if (!notes.length) continue;
    const toC = (x: GlNote): ReviewComment => ({ id: String(x.id), author: x.author?.name || x.author?.username || "", body: x.body ?? "", date: x.created_at, mine: mine(x.author) });
    const pos = notes[0].position;
    const file = pos?.new_path || pos?.old_path;
    if (pos && file) {
      const line = pos.new_line ?? pos.old_line ?? null;
      threads.push({
        id: String(d.id), path: file, line, resolved: !!notes[0].resolved, outdated: false, canResolve: !!notes[0].resolvable,
        snippet: await snippetAround(root, mr.source_branch, file, line), comments: notes.map(toC),
      });
    } else if (notes.length > 1 || notes[0].resolvable) {
      threads.push({ id: String(d.id), path: "", line: null, resolved: !!notes[0].resolved, outdated: false, canResolve: !!notes[0].resolvable, snippet: [], comments: notes.map(toC) });
    } else comments.push(toC(notes[0]));
  }
  return {
    provider: "GitLab", number: n, title: mr.title, url: mr.web_url, body: mr.description ?? "", author: mr.author?.name || mr.author?.username || "",
    state: String(mr.state ?? "").toUpperCase(), branch: mr.source_branch, base: mr.target_branch, subjectId: String(n), me: me?.username ?? "",
    comments, reviews: [], threads,
  };
}

// ---------- Azure DevOps (token) ----------

const azureBase = (r: Extract<conn.Remote, { kind: "azure" }>) =>
  `https://dev.azure.com/${encodeURIComponent(r.org)}/${encodeURIComponent(r.project)}/_apis/git/repositories/${encodeURIComponent(r.repo)}`;

function azureCheck(r: Extract<conn.Remote, { kind: "azure" }>) {
  const org = conn.azureOrg();
  if (!org) throw new GitClientError("connect Azure DevOps first (Connections, on the left)", "not-connected");
  if (org.toLowerCase() !== r.org.toLowerCase()) throw new GitClientError(`this repository is in the ${r.org} organization, but Ferry is connected to ${org}`, "not-connected");
}

async function azureConversation(root: string, r: Extract<conn.Remote, { kind: "azure" }>, n: number): Promise<Conversation> {
  azureCheck(r);
  const base = azureBase(r);
  const [pr, th] = await Promise.all([
    conn.azureApi<AzPullRequest>("GET", `${base}/pullrequests/${n}`),
    conn.azureApi<AzList<AzThread>>("GET", `${base}/pullRequests/${n}/threads`),
  ]);
  const strip = (ref: string) => String(ref ?? "").replace(/^refs\/heads\//, "");
  const comments: ReviewComment[] = [], threads: ReviewThread[] = [];
  const reviews: Review[] = (pr.reviewers ?? []).filter((v) => v.vote).map((v) => ({
    author: v.displayName, state: v.vote >= 10 ? "APPROVED" : v.vote === 5 ? "APPROVED" : v.vote === -10 ? "CHANGES_REQUESTED" : "COMMENTED", body: "", date: "",
  }));
  for (const t of th.value) {
    if (t.isDeleted) continue;
    const cs = (t.comments ?? []).filter((c) => c.commentType !== "system" && !c.isDeleted);
    if (!cs.length) continue;
    const toC = (c: AzComment): ReviewComment => ({ id: String(c.id), author: c.author?.displayName ?? "", body: c.content ?? "", date: c.publishedDate, mine: false });
    const ctx = t.threadContext;
    const resolved = ["fixed", "closed", "byDesign", "wontFix"].includes(t.status ?? "");
    if (ctx?.filePath) {
      const file = String(ctx.filePath).replace(/^\//, "");
      const line = ctx.rightFileStart?.line ?? ctx.leftFileStart?.line ?? null;
      threads.push({ id: String(t.id), path: file, line, resolved, outdated: false, canResolve: !!t.status, snippet: await snippetAround(root, strip(pr.sourceRefName), file, line), comments: cs.map(toC) });
    } else if (cs.length > 1 || t.status) {
      threads.push({ id: String(t.id), path: "", line: null, resolved, outdated: false, canResolve: !!t.status, snippet: [], comments: cs.map(toC) });
    } else comments.push(toC(cs[0]));
  }
  return {
    provider: "Azure DevOps", number: n, title: pr.title, body: pr.description ?? "", author: pr.createdBy?.displayName ?? "", state: String(pr.status ?? "").toUpperCase(),
    url: `https://dev.azure.com/${encodeURIComponent(r.org)}/${encodeURIComponent(r.project)}/_git/${encodeURIComponent(r.repo)}/pullrequest/${n}`,
    branch: strip(pr.sourceRefName), base: strip(pr.targetRefName), subjectId: String(n), me: "", comments, reviews, threads,
  };
}

// ---------- what the routes call ----------

export async function conversation(root: string, number: unknown): Promise<Conversation> {
  const n = num(number);
  const r = await remote(root);
  const c = r.kind === "gitlab" ? await gitlabConversation(root, r.project, n)
    : r.kind === "azure" ? await azureConversation(root, r, n)
    : await githubConversation(root, r.url, n);
  c.comments.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  return c;
}

/** Answers a line comment (or a discussion thread). */
export async function reply(root: string, number: unknown, threadId: unknown, body: unknown): Promise<void> {
  const n = num(number), t = opaqueId(threadId), msg = text(body, "reply");
  const r = await remote(root);
  if (r.kind === "gitlab") {
    await gl(root, "POST", `/projects/${encodeURIComponent(r.project)}/merge_requests/${n}/discussions/${t}/notes`, { body: msg });
  } else if (r.kind === "azure") {
    azureCheck(r);
    await conn.azureApi("POST", `${azureBase(r)}/pullRequests/${n}/threads/${t}/comments`, { content: msg, parentCommentId: 1, commentType: 1 });
  } else {
    await githubMutate(root, "mutation($id: ID!, $body: String!) { addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $id, body: $body }) { comment { id } } }", { id: t, body: msg });
  }
}

/** Adds a comment to the pull request's general conversation. */
export async function comment(root: string, number: unknown, subjectId: unknown, body: unknown): Promise<void> {
  const n = num(number), msg = text(body);
  const r = await remote(root);
  if (r.kind === "gitlab") {
    await gl(root, "POST", `/projects/${encodeURIComponent(r.project)}/merge_requests/${n}/notes`, { body: msg });
  } else if (r.kind === "azure") {
    azureCheck(r);
    await conn.azureApi("POST", `${azureBase(r)}/pullRequests/${n}/threads`, { comments: [{ parentCommentId: 0, content: msg, commentType: 1 }], status: 4 /* closed: a plain comment, not something to resolve */ });
  } else {
    await githubMutate(root, "mutation($id: ID!, $body: String!) { addComment(input: { subjectId: $id, body: $body }) { commentEdge { node { id } } } }", { id: opaqueId(subjectId), body: msg });
  }
}

/** Resolves a thread, or reopens it. */
export async function resolve(root: string, number: unknown, threadId: unknown, resolved: boolean): Promise<void> {
  const n = num(number), t = opaqueId(threadId);
  const r = await remote(root);
  if (r.kind === "gitlab") {
    await gl(root, "PUT", `/projects/${encodeURIComponent(r.project)}/merge_requests/${n}/discussions/${t}?resolved=${resolved}`);
  } else if (r.kind === "azure") {
    azureCheck(r);
    await conn.azureApi("PATCH", `${azureBase(r)}/pullRequests/${n}/threads/${t}`, { status: resolved ? "fixed" : "active" });
  } else {
    await githubMutate(root, resolved
      ? "mutation($id: ID!) { resolveReviewThread(input: { threadId: $id }) { thread { id } } }"
      : "mutation($id: ID!) { unresolveReviewThread(input: { threadId: $id }) { thread { id } } }", { id: t });
  }
}
