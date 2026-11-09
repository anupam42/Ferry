// GitLab, Azure DevOps and Jira connections, with the network replaced by a fake.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

import { ApiServer } from "../src/api.ts";
import * as conn from "../src/integrations.ts";
import { tempDir } from "./helpers.ts";

type Route = (url: URL, init: RequestInit) => unknown;
let routes: [RegExp, Route][] = [];
const seen: { url: string; headers: Record<string, string> }[] = [];

beforeEach(() => {
  process.env.FERRY_HOME = tempDir();
  for (const k of ["GITLAB_TOKEN", "GITLAB_URL", "AZURE_DEVOPS_PAT", "AZURE_DEVOPS_ORG", "JIRA_URL", "JIRA_EMAIL", "JIRA_API_TOKEN"]) delete process.env[k];
  routes = [];
  seen.length = 0;
  conn.setHttp(async (url, init = {}) => {
    const u = new URL(url);
    seen.push({ url, headers: (init.headers ?? {}) as Record<string, string> });
    for (const [re, f] of routes) {
      if (re.test(u.pathname + u.search)) {
        const out = f(u, init);
        if (out instanceof Response) return out;
        return new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json" } });
      }
    }
    return new Response("not found", { status: 404 });
  });
});
afterEach(() => conn.setHttp((url, init) => fetch(url, init)));

describe("remote URLs", () => {
  test("recognises GitHub, GitLab and Azure DevOps in https and ssh forms", () => {
    expect(conn.parseRemote("https://github.com/me/app.git")).toEqual({ kind: "github" });
    expect(conn.parseRemote("git@gitlab.com:group/sub/app.git")).toEqual({ kind: "gitlab", host: "gitlab.com", project: "group/sub/app" });
    expect(conn.parseRemote("https://gitlab.example.com/team/app")).toEqual({ kind: "gitlab", host: "gitlab.example.com", project: "team/app" });
    expect(conn.parseRemote("https://acme@dev.azure.com/acme/Web%20Shop/_git/shop")).toEqual({ kind: "azure", org: "acme", project: "Web Shop", repo: "shop" });
    expect(conn.parseRemote("git@ssh.dev.azure.com:v3/acme/Web/shop")).toEqual({ kind: "azure", org: "acme", project: "Web", repo: "shop" });
    expect(conn.parseRemote("https://acme.visualstudio.com/Web/_git/shop")).toEqual({ kind: "azure", org: "acme", project: "Web", repo: "shop" });
    expect(conn.parseRemote("https://example.com/x/y.git")).toEqual({ kind: "other" });
  });
});

describe("GitLab", () => {
  test("connects after checking the token, keeps it private, lists merge requests", async () => {
    routes.push([/^\/api\/v4\/user$/, () => ({ username: "anu", name: "Anupam" })]);
    const r = await conn.connect("gitlab", { url: "https://gitlab.com/", token: "glpat-secret" });
    expect(r.user).toBe("Anupam (@anu)");
    expect(seen[0]!.headers["PRIVATE-TOKEN"]).toBe("glpat-secret");
    const file = path.join(process.env.FERRY_HOME!, "connections.json");
    if (process.platform !== "win32") expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(JSON.stringify(conn.status())).not.toContain("glpat-secret");

    routes.push([/merge_requests\?state=opened/, () => [{ iid: 7, title: "Add search", source_branch: "search", target_branch: "main", author: { username: "sam" }, draft: false, web_url: "https://gitlab.com/g/app/-/merge_requests/7", updated_at: "2026-11-09T10:00:00Z" }]]);
    routes.push([/merge_requests\/7\/pipelines/, () => [{ id: 99, status: "failed", web_url: "https://gitlab.com/p/99" }]]);
    routes.push([/merge_requests\/7\/approvals/, () => ({ approved: true })]);
    const mrs = await conn.gitlabMergeRequests({ kind: "gitlab", host: "gitlab.com", project: "g/app" });
    expect(mrs[0]).toMatchObject({ number: 7, branch: "search", review: "APPROVED", checks: { failed: 1, passed: 0 } });
    expect(seen.some((x) => x.url.includes("/projects/g%2Fapp/merge_requests"))).toBe(true);
  });

  test("a rejected token is reported in plain words, and nothing is saved", async () => {
    routes.push([/\/user$/, () => new Response("{}", { status: 401 })]);
    await expect(conn.connect("gitlab", { token: "bad" })).rejects.toThrow(/didn't accept the token/);
    expect(conn.status().gitlab.connected).toBe(false);
    await expect(conn.connect("gitlab", { url: "http://gitlab.example.com", token: "x" })).rejects.toThrow(/https/);
  });
});

describe("Azure DevOps", () => {
  test("connects with a personal access token and maps pull requests, votes and checks", async () => {
    routes.push([/\/acme\/_apis\/connectionData/, () => ({ authenticatedUser: { providerDisplayName: "Anupam U" } })]);
    expect((await conn.connect("azure", { org: "https://dev.azure.com/acme/", token: "pat123" })).user).toBe("Anupam U");
    expect(seen[0]!.headers.Authorization).toBe("Basic " + Buffer.from(":pat123").toString("base64"));
    expect(seen[0]!.url).toContain("api-version=7.1");

    routes.push([/pullrequests\?searchCriteria/, () => ({ value: [{ pullRequestId: 12, title: "Checkout page", sourceRefName: "refs/heads/checkout", targetRefName: "refs/heads/main", createdBy: { displayName: "Sam" }, isDraft: true, creationDate: "2026-11-09T09:00:00Z", reviewers: [{ vote: 10 }, { vote: 0 }] }] })]);
    routes.push([/pullrequests\/12\/statuses/, () => ({ value: [
      { state: "pending", context: { genre: "ci", name: "build" }, description: "Build" },
      { state: "succeeded", context: { genre: "ci", name: "build" }, description: "Build", targetUrl: "https://dev.azure.com/b/1" }, // newer status for the same check wins
      { state: "failed", context: { genre: "ci", name: "lint" }, description: "Lint" }] })]);
    const prs = await conn.azurePullRequests({ kind: "azure", org: "acme", project: "Web", repo: "shop" });
    expect(prs[0]).toMatchObject({ number: 12, branch: "checkout", base: "main", draft: true, review: "APPROVED", checks: { passed: 1, failed: 1, pending: 0 } });
    expect(prs[0]!.url).toBe("https://dev.azure.com/acme/Web/_git/shop/pullrequest/12");
    await expect(conn.azurePullRequests({ kind: "azure", org: "other", project: "x", repo: "y" })).rejects.toThrow(/organization/);
  });
});

describe("Jira", () => {
  const connectJira = async () => {
    routes.push([/\/rest\/api\/3\/myself/, () => ({ displayName: "Anupam" })]);
    await conn.connect("jira", { url: "https://acme.atlassian.net", email: "me@acme.com", token: "tok" });
  };

  test("lists my open issues and starts work on one", async () => {
    await connectJira();
    expect(seen[0]!.headers.Authorization).toBe("Basic " + Buffer.from("me@acme.com:tok").toString("base64"));
    routes.push([/\/rest\/api\/3\/search\/jql/, (u) => {
      expect(u.searchParams.get("jql")).toContain("assignee = currentUser()");
      return { issues: [{ key: "SHOP-42", fields: { summary: "Fix the login button!", status: { name: "To Do", statusCategory: { key: "new" } }, issuetype: { name: "Bug" }, priority: { name: "High" }, updated: "2026-11-09T08:00:00Z" } }] };
    }]);
    const { issues } = await conn.jiraMyIssues();
    expect(issues[0]).toMatchObject({ key: "SHOP-42", type: "Bug", category: "new", url: "https://acme.atlassian.net/browse/SHOP-42" });
    expect(conn.branchForIssue("SHOP-42", "Fix the login button!")).toBe("SHOP-42-fix-the-login-button");

    let posted: unknown = null;
    routes.push([/\/issue\/SHOP-42\/transitions/, (_u, init) => {
      if (init.method === "POST") { posted = JSON.parse(String(init.body)); return new Response(null, { status: 204 }); }
      return { transitions: [{ id: "11", name: "Close", to: { name: "Done", statusCategory: { key: "done" } } }, { id: "21", name: "Start", to: { name: "In Progress", statusCategory: { key: "indeterminate" } } }] };
    }]);
    expect(await conn.jiraStartProgress("SHOP-42")).toBe("In Progress");
    expect(posted).toEqual({ transition: { id: "21" } });
    await expect(conn.jiraStartProgress("shop 42; drop")).rejects.toThrow(/issue key/);
  });

  test("falls back to the older search API on Jira Server", async () => {
    await connectJira();
    routes.push([/\/rest\/api\/2\/search\?/, () => ({ issues: [{ key: "OPS-1", fields: { summary: "Rotate keys", status: { name: "Open" } } }] })]);
    expect((await conn.jiraMyIssues()).issues[0]!.key).toBe("OPS-1");
  });
});

describe("connections over HTTP", () => {
  test("status never includes tokens; environment variables count as connected", async () => {
    process.env.JIRA_URL = "https://acme.atlassian.net";
    process.env.JIRA_EMAIL = "me@acme.com";
    process.env.JIRA_API_TOKEN = "env-secret";
    const api = new ApiServer([], "", { repos: { list: () => [], add() {}, remove() {} } });
    const res = await api.handle(new Request("http://127.0.0.1/connections"));
    const body = await res.text();
    expect(body).not.toContain("env-secret");
    expect(JSON.parse(body).jira).toMatchObject({ connected: true, fromEnv: true, where: "https://acme.atlassian.net" });
    const bad = await api.handle(new Request("http://127.0.0.1/connections/gitlab", { method: "POST", headers: { "X-Ferry": "1" }, body: JSON.stringify({ token: "" }) }));
    expect(bad.status).toBe(400);
  });
});

describe("addresses copied from the browser", () => {
  test("a gitlab.com profile URL is reduced to the server", async () => {
    routes.push([/^\/api\/v4\/user$/, () => ({ username: "anupam42", name: "Anupam" })]);
    await conn.connect("gitlab", { url: "https://gitlab.com/anupam42", token: "glpat-x" });
    expect(seen.map((x) => x.url)).toEqual(["https://gitlab.com/api/v4/user"]);
    expect(conn.status().gitlab.where).toBe("https://gitlab.com");
  });

  test("a self-hosted path is tried first, then the host", async () => {
    routes.push([/^\/api\/v4\/user$/, () => ({ username: "anu", name: "" })]);
    await conn.connect("gitlab", { url: "https://git.example.com/team/app", token: "t" });
    expect(seen.map((x) => x.url)).toEqual(["https://git.example.com/team/app/api/v4/user", "https://git.example.com/api/v4/user"]);
    expect(conn.status().gitlab.where).toBe("https://git.example.com");

    seen.length = 0;
    routes = [[/^\/gitlab\/api\/v4\/user$/, () => ({ username: "anu", name: "" })]];
    await conn.connect("gitlab", { url: "https://corp.example.com/gitlab", token: "t" });
    expect(conn.status().gitlab.where).toBe("https://corp.example.com/gitlab");
  });

  test("a Jira board URL is reduced to the site; a real token problem is still reported", async () => {
    routes.push([/\/rest\/api\/3\/myself/, () => ({ displayName: "Anupam" })]);
    await conn.connect("jira", { url: "https://acme.atlassian.net/jira/software/projects/SHOP/boards/1", email: "me@acme.com", token: "tok" });
    expect(conn.status().jira.where).toBe("https://acme.atlassian.net");

    routes = [[/\/api\/v4\/user$/, () => new Response("{}", { status: 401 })]];
    await expect(conn.connect("gitlab", { url: "https://git.example.com/team", token: "bad" })).rejects.toThrow(/didn't accept the token/);
  });

  test("a web page instead of JSON says to check the address", async () => {
    routes.push([/\/api\/v4\/user$/, () => new Response("<html>sign in</html>", { headers: { "Content-Type": "text/html; charset=utf-8" } })]);
    await expect(conn.connect("gitlab", { url: "https://git.example.com", token: "t" })).rejects.toThrow(/web page/);
  });
});
