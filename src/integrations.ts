// Connections to GitLab, Azure DevOps and Jira, for the web app's Git client.
//
// Credentials live in <data dir>/connections.json, readable only by the user
// (mode 0600), or come from environment variables, which win:
//   GitLab:       GITLAB_TOKEN, GITLAB_URL (default https://gitlab.com)
//   Azure DevOps: AZURE_DEVOPS_PAT, AZURE_DEVOPS_ORG
//   Jira:         JIRA_URL, JIRA_EMAIL, JIRA_API_TOKEN
// Tokens never leave this process: the web app only learns who is connected.
import fs from "node:fs";
import path from "node:path";

import { dataDir } from "./config.ts";
import type { PullRequest } from "./gitclient.ts";

export class IntegrationError extends Error {
  constructor(message: string, public code = "") {
    super(message);
  }
}

export type Provider = "gitlab" | "azure" | "jira";

interface Stored {
  gitlab?: { url: string; token: string; user?: string };
  azure?: { org: string; token: string; user?: string };
  jira?: { url: string; email: string; token: string; user?: string };
}

/** Network access, replaceable in tests. */
type Http = (url: string, init?: RequestInit) => Promise<Response>;
export let http: Http = (url, init) => fetch(url, init);
export function setHttp(f: Http): void {
  http = f;
}

const file = () => path.join(dataDir(), "connections.json");

function load(): Stored {
  try {
    return JSON.parse(fs.readFileSync(file(), "utf8")) as Stored;
  } catch {
    return {};
  }
}

function save(s: Stored): void {
  fs.mkdirSync(dataDir(), { recursive: true });
  const tmp = file() + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file());
  try {
    fs.chmodSync(file(), 0o600);
  } catch {}
}

/** Effective credentials: environment variables first, then the saved file. */
function creds(): Stored {
  const s = load();
  const env = process.env;
  if (env.GITLAB_TOKEN) s.gitlab = { url: env.GITLAB_URL || s.gitlab?.url || "https://gitlab.com", token: env.GITLAB_TOKEN, user: s.gitlab?.user };
  if (env.AZURE_DEVOPS_PAT && (env.AZURE_DEVOPS_ORG || s.azure?.org)) s.azure = { org: env.AZURE_DEVOPS_ORG || s.azure!.org, token: env.AZURE_DEVOPS_PAT, user: s.azure?.user };
  if (env.JIRA_API_TOKEN && env.JIRA_EMAIL && (env.JIRA_URL || s.jira?.url)) s.jira = { url: env.JIRA_URL || s.jira!.url, email: env.JIRA_EMAIL, token: env.JIRA_API_TOKEN, user: s.jira?.user };
  return s;
}

const fromEnv = (p: Provider) => (p === "gitlab" ? !!process.env.GITLAB_TOKEN : p === "azure" ? !!process.env.AZURE_DEVOPS_PAT : !!process.env.JIRA_API_TOKEN);

/** Who is connected where, without any secrets. */
export function status(): Record<Provider, { connected: boolean; user: string; where: string; fromEnv: boolean }> {
  const s = creds();
  return {
    gitlab: { connected: !!s.gitlab?.token, user: s.gitlab?.user ?? "", where: s.gitlab?.url ?? "", fromEnv: fromEnv("gitlab") },
    azure: { connected: !!s.azure?.token, user: s.azure?.user ?? "", where: s.azure?.org ? `dev.azure.com/${s.azure.org}` : "", fromEnv: fromEnv("azure") },
    jira: { connected: !!s.jira?.token, user: s.jira?.user ?? "", where: s.jira?.url ?? "", fromEnv: fromEnv("jira") },
  };
}

/** A base URL the user typed: https only (http for localhost), no trailing slash. */
function baseURL(v: unknown, what: string): string {
  if (typeof v !== "string" || !v.trim()) throw new IntegrationError(`${what} is required`);
  let u: URL;
  try {
    u = new URL(v.trim().replace(/\/+$/, ""));
  } catch {
    throw new IntegrationError(`${what} isn't a web address (it should start with https://)`);
  }
  const local = ["localhost", "127.0.0.1", "::1"].includes(u.hostname);
  if (u.protocol !== "https:" && !(local && u.protocol === "http:")) throw new IntegrationError(`${what} must start with https://`);
  return u.origin + u.pathname.replace(/\/+$/, "");
}

/**
 * Addresses to try for a server the user typed, often copied from the browser
 * (https://gitlab.com/me, https://acme.atlassian.net/jira/software/...).
 * Hosted services only ever live at the host; a self-hosted one may live under
 * a path (https://example.com/gitlab), so that is tried first, then the host.
 */
function serverCandidates(url: string, hosted: (host: string) => boolean): string[] {
  const u = new URL(url);
  if (hosted(u.hostname) || u.pathname === "/" || !u.pathname) return [u.origin];
  return [url, u.origin];
}

/** Tries each address in turn and returns the first that answers; otherwise the last one's error. */
async function firstThatWorks<T>(urls: string[], f: (url: string) => Promise<T>): Promise<{ url: string; value: T }> {
  let err: unknown;
  for (const url of urls) {
    try {
      return { url, value: await f(url) };
    } catch (e) {
      if (!(e instanceof IntegrationError) || !["auth", "404", "html"].includes(e.code)) throw e;
      err = e;
    }
  }
  throw err;
}

const gitlabHosted = (h: string) => h === "gitlab.com";
const jiraHosted = (h: string) => h.endsWith(".atlassian.net");

function text(v: unknown, what: string): string {
  if (typeof v !== "string" || !v.trim()) throw new IntegrationError(`${what} is required`);
  return v.trim();
}

/** Checks the credentials by asking who they belong to, then saves them. */
export async function connect(p: Provider, body: Record<string, unknown>): Promise<{ user: string }> {
  const s = load();
  if (p === "gitlab") {
    const token = text(body.token, "access token");
    const typed = body.url ? baseURL(body.url, "GitLab address") : "https://gitlab.com";
    const { url, value: me } = await firstThatWorks(serverCandidates(typed, gitlabHosted), (url) => gitlabGet<{ username: string; name: string }>({ url, token }, "/user"));
    const c = { url, token };
    s.gitlab = { ...c, user: me.name ? `${me.name} (@${me.username})` : me.username };
    save(s);
    return { user: s.gitlab.user! };
  }
  if (p === "azure") {
    const org = text(body.org, "organization").replace(/^https?:\/\/dev\.azure\.com\//, "").replace(/\/.*$/, "");
    if (!/^[\w.-]+$/.test(org)) throw new IntegrationError("the organization is the name after dev.azure.com/");
    const c = { org, token: text(body.token, "personal access token") };
    const me = await azureGet<{ authenticatedUser: { providerDisplayName?: string; customDisplayName?: string } }>(c, `https://dev.azure.com/${org}/_apis/connectionData`);
    s.azure = { ...c, user: me.authenticatedUser.customDisplayName || me.authenticatedUser.providerDisplayName || org };
    save(s);
    return { user: s.azure.user! };
  }
  const typed = baseURL(body.url, "Jira address");
  const who = { email: text(body.email, "email"), token: text(body.token, "API token") };
  const { url, value: me } = await firstThatWorks(serverCandidates(typed, jiraHosted), (url) =>
    jiraGet<{ displayName: string }>({ url, ...who }, "/rest/api/3/myself").catch((e) =>
      e instanceof IntegrationError && e.code === "404" ? jiraGet<{ displayName: string }>({ url, ...who }, "/rest/api/2/myself") : Promise.reject(e)));
  const c = { url, ...who };
  s.jira = { ...c, user: me.displayName };
  save(s);
  return { user: me.displayName };
}

export function disconnect(p: Provider): void {
  const s = load();
  delete s[p];
  save(s);
}

// ---------- HTTP helpers ----------

async function call<T>(url: string, init: RequestInit, who: string): Promise<T> {
  let res: Response;
  try {
    res = await http(url, { ...init, signal: AbortSignal.timeout(20_000) });
  } catch (e) {
    throw new IntegrationError(`can't reach ${who}: ${(e as Error).message}`, "network");
  }
  if (res.status === 401 || res.status === 403) throw new IntegrationError(`${who} didn't accept the token (it may have expired or lack permissions)`, "auth");
  if (res.status === 404) throw new IntegrationError(`${who} couldn't find that (check the address and that you have access)`, "404");
  if (!res.ok) throw new IntegrationError(`${who} answered ${res.status}: ${(await res.text()).slice(0, 200)}`, String(res.status));
  if (res.status === 204) return undefined as T;
  // a web page instead of JSON means the address points at the website, not its API
  if (/text\/html/i.test(res.headers.get("content-type") ?? "")) throw new IntegrationError(`${who} sent a web page instead of an answer (check the address: just the server, like https://gitlab.example.com)`, "html");
  return (await res.json()) as T;
}

const gitlabGet = <T>(c: { url: string; token: string }, p: string) =>
  call<T>(c.url + "/api/v4" + p, { headers: { "PRIVATE-TOKEN": c.token, Accept: "application/json" } }, "GitLab");

const azureAuth = (token: string) => "Basic " + Buffer.from(":" + token).toString("base64");
const azureGet = <T>(c: { token: string }, url: string) =>
  call<T>(url + (url.includes("?") ? "&" : "?") + "api-version=7.1", { headers: { Authorization: azureAuth(c.token), Accept: "application/json" } }, "Azure DevOps");

/** An authenticated GitLab API call (path after /api/v4), for review comments. Throws "not-connected" without a token. */
export async function gitlabApi<T>(method: "GET" | "POST" | "PUT", p: string, body?: unknown): Promise<T> {
  const c = creds().gitlab;
  if (!c) throw new IntegrationError("connect GitLab first (Connections, on the left)", "not-connected");
  return call<T>(c.url + "/api/v4" + p, {
    method, headers: { "PRIVATE-TOKEN": c.token, Accept: "application/json", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }, "GitLab");
}

/** An authenticated Azure DevOps call (a full https://dev.azure.com/… URL), for review comments. */
export async function azureApi<T>(method: "GET" | "POST" | "PATCH", url: string, body?: unknown): Promise<T> {
  const c = creds().azure;
  if (!c) throw new IntegrationError("connect Azure DevOps first (Connections, on the left)", "not-connected");
  return call<T>(url + (url.includes("?") ? "&" : "?") + "api-version=7.1", {
    method, headers: { Authorization: azureAuth(c.token), Accept: "application/json", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }, "Azure DevOps");
}

/** The connected Azure DevOps organization (to check a repository belongs to it). */
export const azureOrg = (): string => creds().azure?.org ?? "";

const jiraAuth = (c: { email: string; token: string }) => "Basic " + Buffer.from(`${c.email}:${c.token}`).toString("base64");
const jiraGet = <T>(c: { url: string; email: string; token: string }, p: string) =>
  call<T>(c.url + p, { headers: { Authorization: jiraAuth(c), Accept: "application/json" } }, "Jira");
const jiraPost = <T>(c: { url: string; email: string; token: string }, p: string, body: unknown) =>
  call<T>(c.url + p, { method: "POST", headers: { Authorization: jiraAuth(c), Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify(body) }, "Jira");

// ---------- which service a repository lives on ----------

export type Remote =
  | { kind: "github" }
  | { kind: "gitlab"; host: string; project: string }
  | { kind: "azure"; org: string; project: string; repo: string }
  | { kind: "other" };

/** Works out the hosting service from a remote URL (https or ssh). */
export function parseRemote(url: string): Remote {
  const u = url.trim().replace(/\.git$/, "");
  let m = /^(?:https?:\/\/)?(?:[^@/]+@)?dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/?#]+)/i.exec(u)
    ?? /^(?:git@)?ssh\.dev\.azure\.com:v3\/([^/]+)\/([^/]+)\/([^/?#]+)/i.exec(u);
  if (m) return { kind: "azure", org: decodeURIComponent(m[1]!), project: decodeURIComponent(m[2]!), repo: decodeURIComponent(m[3]!) };
  m = /^(?:https?:\/\/)?(?:[^@/]+@)?([\w-]+)\.visualstudio\.com\/(?:DefaultCollection\/)?([^/]+)\/_git\/([^/?#]+)/i.exec(u);
  if (m) return { kind: "azure", org: m[1]!, project: decodeURIComponent(m[2]!), repo: decodeURIComponent(m[3]!) };
  if (/github\.com[/:]/i.test(u)) return { kind: "github" };
  m = /^(?:https?:\/\/)(?:[^@/]+@)?([^/]+)\/(.+)$/i.exec(u) ?? /^(?:ssh:\/\/)?git@([^:/]+)[:/](.+)$/i.exec(u);
  if (m && /gitlab/i.test(m[1]!)) return { kind: "gitlab", host: m[1]!, project: m[2]!.replace(/^\/+/, "") };
  // a self-hosted GitLab doesn't always say "gitlab" in its name: match it against the connected address
  const gl = creds().gitlab;
  if (m && gl && new URL(gl.url).host === m[1]) return { kind: "gitlab", host: m[1]!, project: m[2]!.replace(/^\/+/, "") };
  return { kind: "other" };
}

// ---------- pull / merge requests ----------

/** Open merge requests on GitLab with each one's latest pipeline and approval state. */
export async function gitlabMergeRequests(r: Extract<Remote, { kind: "gitlab" }>): Promise<PullRequest[]> {
  const c = creds().gitlab;
  if (!c) throw new IntegrationError("connect GitLab first (Connections, on the left)", "not-connected");
  const id = encodeURIComponent(r.project);
  const list = await gitlabGet<Record<string, any>[]>(c, `/projects/${id}/merge_requests?state=opened&per_page=30&order_by=updated_at`);
  return Promise.all(list.map(async (m) => {
    const [pipes, approvals] = await Promise.all([
      gitlabGet<Record<string, any>[]>(c, `/projects/${id}/merge_requests/${m.iid}/pipelines?per_page=1`).catch(() => []),
      gitlabGet<Record<string, any>>(c, `/projects/${id}/merge_requests/${m.iid}/approvals`).catch(() => null),
    ]);
    const p = pipes[0];
    const state = !p ? "" : p.status === "success" ? "passed" : ["failed", "canceled"].includes(p.status) ? "failed" : "pending";
    const items = p ? [{ name: `pipeline #${p.id}`, state, url: p.web_url ?? "" }] : [];
    return {
      number: m.iid, title: m.title, branch: m.source_branch, base: m.target_branch, author: m.author?.username ?? "", draft: !!m.draft,
      url: m.web_url, updated: m.updated_at,
      review: approvals ? (approvals.approved ? "APPROVED" : "REVIEW_REQUIRED") : "",
      checks: { passed: state === "passed" ? 1 : 0, failed: state === "failed" ? 1 : 0, pending: state === "pending" ? 1 : 0, items },
    };
  }));
}

/** Active pull requests on Azure Repos with their reviewers' votes and status checks. */
export async function azurePullRequests(r: Extract<Remote, { kind: "azure" }>): Promise<PullRequest[]> {
  const c = creds().azure;
  if (!c) throw new IntegrationError("connect Azure DevOps first (Connections, on the left)", "not-connected");
  if (c.org.toLowerCase() !== r.org.toLowerCase()) throw new IntegrationError(`this repository is in the ${r.org} organization, but Ferry is connected to ${c.org}`, "not-connected");
  const base = `https://dev.azure.com/${encodeURIComponent(r.org)}/${encodeURIComponent(r.project)}/_apis/git/repositories/${encodeURIComponent(r.repo)}`;
  const list = await azureGet<{ value: Record<string, any>[] }>(c, `${base}/pullrequests?searchCriteria.status=active&$top=30`);
  const strip = (ref: string) => String(ref ?? "").replace(/^refs\/heads\//, "");
  return Promise.all(list.value.map(async (p) => {
    const statuses = await azureGet<{ value: Record<string, any>[] }>(c, `${base}/pullrequests/${p.pullRequestId}/statuses`).catch(() => ({ value: [] }));
    // only the newest status per check counts
    const latest = new Map<string, Record<string, any>>();
    for (const st of statuses.value) latest.set(`${st.context?.genre ?? ""}/${st.context?.name ?? ""}`, st);
    const items = [...latest.values()].map((st) => ({
      name: st.description || st.context?.name || "check",
      state: st.state === "succeeded" ? "passed" : ["failed", "error"].includes(st.state) ? "failed" : "pending",
      url: st.targetUrl ?? "",
    }));
    const votes = (p.reviewers ?? []).map((v: { vote: number }) => v.vote);
    const review = votes.some((v: number) => v === -10) ? "CHANGES_REQUESTED" : votes.some((v: number) => v >= 5) ? "APPROVED" : votes.length ? "REVIEW_REQUIRED" : "";
    return {
      number: p.pullRequestId, title: p.title, branch: strip(p.sourceRefName), base: strip(p.targetRefName), author: p.createdBy?.displayName ?? "",
      draft: !!p.isDraft, updated: p.creationDate,
      url: `https://dev.azure.com/${encodeURIComponent(r.org)}/${encodeURIComponent(r.project)}/_git/${encodeURIComponent(r.repo)}/pullrequest/${p.pullRequestId}`,
      review,
      checks: {
        passed: items.filter((i) => i.state === "passed").length, failed: items.filter((i) => i.state === "failed").length,
        pending: items.filter((i) => i.state === "pending").length, items,
      },
    };
  }));
}

// ---------- Jira ----------

export interface Issue {
  key: string;
  summary: string;
  status: string;
  category: string; // "new" | "indeterminate" | "done"
  type: string;
  priority: string;
  updated: string;
  url: string;
}

/** Issues assigned to you that aren't done, newest first. */
export async function jiraMyIssues(): Promise<{ site: string; issues: Issue[] }> {
  const c = creds().jira;
  if (!c) throw new IntegrationError("connect Jira first (Connections, on the left)", "not-connected");
  const jql = encodeURIComponent("assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC");
  const fields = "summary,status,issuetype,priority,updated";
  // Jira Cloud moved search to /search/jql; Jira Server and Data Center still use /search
  const res = await jiraGet<{ issues: Record<string, any>[] }>(c, `/rest/api/3/search/jql?jql=${jql}&fields=${fields}&maxResults=50`)
    .catch((e) => (e instanceof IntegrationError && e.code === "404" ? jiraGet<{ issues: Record<string, any>[] }>(c, `/rest/api/2/search?jql=${jql}&fields=${fields}&maxResults=50`) : Promise.reject(e)));
  return {
    site: c.url,
    issues: (res.issues ?? []).map((i) => ({
      key: i.key, summary: i.fields?.summary ?? "", status: i.fields?.status?.name ?? "", category: i.fields?.status?.statusCategory?.key ?? "",
      type: i.fields?.issuetype?.name ?? "", priority: i.fields?.priority?.name ?? "", updated: i.fields?.updated ?? "", url: `${c.url}/browse/${i.key}`,
    })),
  };
}

const KEY = /^[A-Z][A-Z0-9_]+-\d+$/;

/** Moves an issue into the first "in progress" status it can go to. Returns the new status, or "" if none fits. */
export async function jiraStartProgress(key: unknown): Promise<string> {
  const c = creds().jira;
  if (!c) throw new IntegrationError("connect Jira first", "not-connected");
  if (typeof key !== "string" || !KEY.test(key)) throw new IntegrationError("that isn't a Jira issue key");
  const t = await jiraGet<{ transitions: { id: string; name: string; to?: { name: string; statusCategory?: { key: string } } }[] }>(c, `/rest/api/3/issue/${key}/transitions`);
  const pick = t.transitions.find((x) => x.to?.statusCategory?.key === "indeterminate");
  if (!pick) return "";
  await jiraPost(c, `/rest/api/3/issue/${key}/transitions`, { transition: { id: pick.id } });
  return pick.to?.name ?? pick.name;
}

/** A branch name for an issue: "PROJ-123-fix-the-login-button". */
export function branchForIssue(key: string, summary: string): string {
  const slug = summary.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-").replace(/-+/g, "-").slice(0, 40).replace(/-$/, "");
  return slug ? `${key}-${slug}` : key;
}

/** The Jira site, for turning issue keys in commit messages into links ("" when not connected). */
export function jiraSite(): string {
  return creds().jira?.url ?? "";
}
