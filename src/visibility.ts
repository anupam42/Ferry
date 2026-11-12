// Whether a repository is public or private on its host, for the badge beside its name.
// GitHub through gh when it's signed in, otherwise GitHub's public API (where a private
// repository is simply not found); GitLab and Azure DevOps through their connections, with
// GitLab's public API as a fallback. A repository without a remote is "local".
import * as conn from "./integrations.ts";
import { exec, which } from "./proc.ts";
import type { RepoVisibility } from "./shared/git.ts";

const KNOWN = new Set(["public", "private", "internal"]);
const norm = (v: unknown): RepoVisibility["visibility"] | null => {
  const s = String(v ?? "").toLowerCase();
  return KNOWN.has(s) ? (s as RepoVisibility["visibility"]) : null;
};

async function origin(root: string): Promise<string> {
  const r = await exec(["git", "-C", root, "remote", "get-url", "origin"], { timeoutMs: 10_000 });
  if (r.code === 0) return r.stdout.trim();
  // no origin: any remote at all?
  const all = await exec(["git", "-C", root, "remote"], { timeoutMs: 10_000 });
  const first = all.code === 0 ? all.stdout.split("\n").find(Boolean) : undefined;
  if (!first) return "";
  const u = await exec(["git", "-C", root, "remote", "get-url", first], { timeoutMs: 10_000 });
  return u.code === 0 ? u.stdout.trim() : "";
}

/** A public API call without signing in: the parsed body, or the status when it isn't 200. */
async function open(url: string): Promise<{ status: number; body?: Record<string, unknown> }> {
  try {
    const res = await conn.http(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
    if (res.status !== 200) return { status: res.status };
    return { status: 200, body: (await res.json()) as Record<string, unknown> };
  } catch {
    return { status: 0 };
  }
}

async function github(url: string, useGh: boolean): Promise<RepoVisibility> {
  const m = /github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(url.trim());
  const host = "GitHub";
  if (!m) return { visibility: "unknown", host, sure: false };
  const slug = `${m[1]}/${m[2]}`;
  if (useGh && which("gh")) {
    const r = await exec(["gh", "api", `repos/${slug}`, "--jq", ".visibility"], {
      env: { ...process.env, GH_PROMPT_DISABLED: "1", NO_COLOR: "1" },
      timeoutMs: 15_000,
    });
    const v = r.code === 0 ? norm(r.stdout.trim()) : null;
    if (v) return { visibility: v, host, sure: true };
  }
  const r = await open(`https://api.github.com/repos/${slug}`);
  if (r.status === 200)
    return { visibility: norm(r.body?.visibility) ?? (r.body?.private ? "private" : "public"), host, sure: true };
  if (r.status === 404) return { visibility: "private", host, sure: false };
  return { visibility: "unknown", host, sure: false };
}

async function gitlab(remote: Extract<conn.Remote, { kind: "gitlab" }>): Promise<RepoVisibility> {
  const host = "GitLab";
  const id = encodeURIComponent(remote.project);
  if (conn.status().gitlab.connected) {
    try {
      const p = await conn.gitlabApi<{ visibility?: string }>("GET", `/projects/${id}`);
      const v = norm(p.visibility);
      if (v) return { visibility: v, host, sure: true };
    } catch {
      // fall back to the public API
    }
  }
  const r = await open(`https://${remote.host}/api/v4/projects/${id}`);
  if (r.status === 200) return { visibility: norm(r.body?.visibility) ?? "public", host, sure: true };
  if (r.status === 401 || r.status === 404) return { visibility: "private", host, sure: false };
  return { visibility: "unknown", host, sure: false };
}

async function azure(remote: Extract<conn.Remote, { kind: "azure" }>): Promise<RepoVisibility> {
  const host = "Azure DevOps";
  if (!conn.status().azure.connected) return { visibility: "unknown", host, sure: false };
  try {
    const p = await conn.azureApi<{ visibility?: string }>(
      "GET",
      `https://dev.azure.com/${encodeURIComponent(remote.org)}/_apis/projects/${encodeURIComponent(remote.project)}`,
    );
    return { visibility: norm(p.visibility) ?? "unknown", host, sure: true };
  } catch {
    return { visibility: "unknown", host, sure: false };
  }
}

/** `useGh: false` skips the gh CLI (tests, where only the public API is stubbed). */
export async function repoVisibility(root: string, o: { useGh?: boolean } = {}): Promise<RepoVisibility> {
  const url = await origin(root);
  if (!url) return { visibility: "local", host: "", sure: true };
  const r = conn.parseRemote(url);
  if (r.kind === "github") return github(url, o.useGh ?? true);
  if (r.kind === "gitlab") return gitlab(r);
  if (r.kind === "azure") return azure(r);
  return { visibility: "unknown", host: "", sure: false };
}
