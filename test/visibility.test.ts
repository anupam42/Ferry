// The Public / Private badge: what each host says, and what's guessed without signing in.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

import * as conn from "../src/integrations.ts";
import { repoVisibility } from "../src/visibility.ts";
import { tempDir } from "./helpers.ts";

const realHttp = conn.http;
// a data folder of its own, so no real GitLab or Azure DevOps connection is used
beforeEach(() => (process.env.FERRY_HOME = tempDir()));
afterEach(() => conn.setHttp(realHttp));

function repo(remote?: string): string {
  const d = path.join(tempDir(), "r");
  fs.mkdirSync(d);
  Bun.spawnSync(["git", "-C", d, "init", "-q"]);
  if (remote) Bun.spawnSync(["git", "-C", d, "remote", "add", "origin", remote]);
  return d;
}

/** The public API answers `status` (and `body`) for any address; remembers what it was asked. */
function answer(status: number, body: unknown = {}) {
  const asked: string[] = [];
  conn.setHttp(async (url) => {
    asked.push(url);
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  });
  return asked;
}

describe("repository visibility", () => {
  test("no remote: only on this computer", async () => {
    expect(await repoVisibility(repo(), { useGh: false })).toEqual({ visibility: "local", host: "", sure: true });
  });

  test("GitHub: public from the API; private when it's not found signed out", async () => {
    const asked = answer(200, { visibility: "public", private: false });
    const d = repo("git@github.com:owner/name.git");
    expect(await repoVisibility(d, { useGh: false })).toEqual({ visibility: "public", host: "GitHub", sure: true });
    expect(asked).toEqual(["https://api.github.com/repos/owner/name"]);
    answer(404);
    expect(await repoVisibility(d, { useGh: false })).toEqual({ visibility: "private", host: "GitHub", sure: false });
    answer(500);
    expect((await repoVisibility(d, { useGh: false })).visibility).toBe("unknown");
  });

  test("GitLab: the project's visibility from the public API", async () => {
    const asked = answer(200, { visibility: "internal" });
    const d = repo("https://gitlab.com/group/sub/project.git");
    expect(await repoVisibility(d)).toEqual({ visibility: "internal", host: "GitLab", sure: true });
    expect(asked).toEqual(["https://gitlab.com/api/v4/projects/group%2Fsub%2Fproject"]);
    answer(404);
    expect(await repoVisibility(d)).toEqual({ visibility: "private", host: "GitLab", sure: false });
  });

  test("a host Ferry doesn't know: no badge", async () => {
    answer(200);
    expect((await repoVisibility(repo("https://git.example.org/me/repo.git"))).visibility).toBe("unknown");
  });
});
