// Wraps the git CLI for the few operations ferry needs. A dir may also be an
// ssh target (see remote.ts); git then runs on the remote host over ssh.
import fs from "node:fs";
import path from "node:path";

import { exec, which, type ExecResult } from "./proc.ts";
import * as remote from "./remote.ts";

export class GitError extends Error {}

export function available(): boolean {
  return which("git") !== null;
}

/**
 * The diff a commit would contain, for writing a message: staged changes
 * only, or everything against HEAD (untracked files are listed by status,
 * not diffed). "" if git can't produce one, e.g. before the first commit.
 */
export async function pendingDiff(dir: string, stagedOnly: boolean): Promise<string> {
  const args = stagedOnly ? ["diff", "--cached", "--no-color", "-U2"] : ["diff", "HEAD", "--no-color", "-U2"];
  try {
    return await run(dir, ...args);
  } catch {
    try {
      return await run(dir, "diff", "--cached", "--no-color", "-U2");
    } catch {
      return "";
    }
  }
}

/** "git version x.y.z", or "". */
export async function version(): Promise<string> {
  const r = await exec(["git", "--version"]);
  return r.code === 0 ? r.stdout.trim() : "";
}

const gitEnv = () => ({ ...process.env, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" });

function command(dir: string, args: string[]): string[] {
  if (remote.isSpec(dir)) {
    try {
      const sp = remote.parse(dir);
      return sp.command("GIT_TERMINAL_PROMPT=0 LC_ALL=C git -C " + sp.dir() + " " + args.map(remote.quote).join(" "));
    } catch {}
  }
  return ["git", "-C", dir, ...args];
}

function failure(r: ExecResult): GitError {
  return new GitError(r.stderr.trim() || r.error || "git failed");
}

/** Runs git and returns stdout; throws GitError with stderr on failure. */
export async function run(dir: string, ...args: string[]): Promise<string> {
  const r = await exec(command(dir, args), { env: gitEnv() });
  if (r.code !== 0) throw failure(r);
  return r.stdout;
}

/** Runs git and reports only whether it succeeded. */
async function ok(dir: string, ...args: string[]): Promise<boolean> {
  return (await exec(command(dir, args), { env: gitEnv() })).code === 0;
}

async function tryRun(dir: string, ...args: string[]): Promise<string | null> {
  const r = await exec(command(dir, args), { env: gitEnv() });
  return r.code === 0 ? r.stdout : null;
}

/** Whether dir is inside a git work tree. */
export async function isRepo(dir: string): Promise<boolean> {
  if (!remote.isSpec(dir) && !available()) return false;
  if (!remote.isSpec(dir) && !fs.existsSync(dir)) return false;
  return (await tryRun(dir, "rev-parse", "--is-inside-work-tree"))?.trim() === "true";
}

/** A git config value as seen from dir ("" if unset). */
export async function configGet(dir: string, key: string): Promise<string> {
  return (await tryRun(dir, "config", "--get", key))?.trim() ?? "";
}

/** `git status --porcelain` lines limited to dir. */
export async function status(dir: string): Promise<string[]> {
  const out = await run(dir, "status", "--porcelain=v1", "--untracked-files=all", "--", ".");
  const pre = await prefix(dir);
  return out
    .replace(/\n+$/, "")
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => relativeLine(l, pre));
}

const prefixes = new Map<string, string>();

/**
 * Where dir sits inside its repository ("products/app/"), or "" at the root.
 * git status prints paths from the repository root; ferry works with paths
 * relative to the target, so status lines have this prefix removed.
 */
async function prefix(dir: string): Promise<string> {
  let p = prefixes.get(dir);
  if (p === undefined) {
    p = (await tryRun(dir, "rev-parse", "--show-prefix"))?.trim() ?? "";
    prefixes.set(dir, p);
  }
  return p;
}

/** A porcelain status line with pre removed from its path(s), including quoted paths and renames. */
export function relativeLine(line: string, pre: string): string {
  if (pre === "" || line.length < 4) return line;
  const strip = (p: string) => {
    if (p.startsWith('"') && p.slice(1).startsWith(pre)) return '"' + p.slice(1 + pre.length);
    return p.startsWith(pre) ? p.slice(pre.length) : p;
  };
  return line.slice(0, 3) + line.slice(3).split(" -> ").map(strip).join(" -> ");
}

/** Counts status lines with something in the index. */
export function stagedCount(lines: string[]): number {
  return lines.filter((l) => l.length > 1 && l[0] !== " " && l[0] !== "?").length;
}

/** The checked-out branch ("" if detached). */
export async function currentBranch(dir: string): Promise<string> {
  return (await tryRun(dir, "symbolic-ref", "--quiet", "--short", "HEAD"))?.trim() ?? "";
}

/** Switches to branch, creating it from HEAD if needed. Returns true if it created the branch. */
export async function ensureBranch(dir: string, branch: string): Promise<boolean> {
  if ((await currentBranch(dir)) === branch) return false;
  if (await ok(dir, "rev-parse", "--verify", "--quiet", "refs/heads/" + branch)) {
    await run(dir, "switch", branch);
    return false;
  }
  // a remote branch with the same name?
  if (await ok(dir, "rev-parse", "--verify", "--quiet", "refs/remotes/origin/" + branch)) {
    await run(dir, "switch", "--track", "origin/" + branch);
    return false;
  }
  await run(dir, "switch", "-c", branch);
  return true;
}

const inProgressChecks: [string, string][] = [
  ["rebase-merge", "rebase"],
  ["rebase-apply", "rebase/am"],
  ["MERGE_HEAD", "merge"],
  ["CHERRY_PICK_HEAD", "cherry-pick"],
  ["REVERT_HEAD", "revert"],
  ["BISECT_LOG", "bisect"],
];

/** Describes an unfinished git operation, or "". Not checked for remote targets. */
export async function inProgress(dir: string): Promise<string> {
  if (remote.isSpec(dir)) return "";
  // one rev-parse call answers every --git-path query plus the git dir
  const args = ["rev-parse", "--absolute-git-dir"];
  for (const [p] of inProgressChecks) args.push("--git-path", p);
  const out = await tryRun(dir, ...args);
  if (out === null) return "";
  const lines = out.replace(/\r/g, "").split("\n");
  for (let i = 0; i < inProgressChecks.length; i++) {
    let p = lines[i + 1]?.trim();
    if (!p) continue;
    if (!path.isAbsolute(p)) p = path.join(dir, p);
    if (fs.existsSync(p)) return inProgressChecks[i]![1] + " in progress";
  }
  const gitDir = lines[0]?.trim() || path.join(dir, ".git");
  if (fs.existsSync(path.join(gitDir, "index.lock"))) return "index.lock present (another git command running)";
  return "";
}

/** A quiet fetch of the current upstream's remote. */
export async function fetch(dir: string): Promise<void> {
  await run(dir, "fetch", "--quiet", "--no-tags");
}

/** How many commits HEAD is behind its upstream (0 if none configured). */
export async function behind(dir: string): Promise<number> {
  const out = await tryRun(dir, "rev-list", "--count", "HEAD..@{upstream}");
  return out ? parseInt(out.trim(), 10) || 0 : 0;
}

/** Pulls with --rebase --autostash. A failed rebase is aborted so the work tree is left as it was. */
export async function pullRebase(dir: string): Promise<void> {
  try {
    await run(dir, "pull", "--rebase", "--autostash", "--quiet");
  } catch (e) {
    await tryRun(dir, "rebase", "--abort");
    throw e;
  }
}

export interface CommitOptions {
  author?: string; // "Name <email>"
  sign?: boolean; // -S
}

/** Stages everything under dir and commits. Returns the short hash, or "" when there was nothing to commit. */
export async function commitAll(dir: string, msg: string, o: CommitOptions = {}): Promise<string> {
  await run(dir, "add", "-A", "--", ".");
  return commitStaged(dir, msg, o);
}

/** Commits whatever is already in the index. */
export async function commitStaged(dir: string, msg: string, o: CommitOptions = {}): Promise<string> {
  if (await ok(dir, "diff", "--cached", "--quiet")) return ""; // nothing staged
  const args = ["commit", "-q"];
  if (o.sign) args.push("-S");
  if (o.author) args.push("--author=" + o.author);
  await run(dir, ...args, "-m", msg);
  return (await tryRun(dir, "rev-parse", "--short", "HEAD"))?.trim() ?? "";
}

const slash = (rel: string) => rel.replaceAll("\\", "/");

/** Whether rel has staged changes. */
export async function isStaged(dir: string, rel: string): Promise<boolean> {
  return !(await ok(dir, "diff", "--cached", "--quiet", "--", slash(rel)));
}

/** Adds rel (including a deletion) to the index. */
export async function stage(dir: string, rel: string): Promise<void> {
  await run(dir, "add", "-A", "--", slash(rel));
}

/** Removes rel from the index, keeping the working copy. */
export async function unstage(dir: string, rel: string): Promise<void> {
  try {
    await run(dir, "reset", "-q", "HEAD", "--", slash(rel));
  } catch (e) {
    // no commits yet: there is no HEAD to reset to
    if (!(await ok(dir, "rm", "--cached", "-q", "-r", "--", slash(rel)))) throw e;
  }
}

/** Pushes the current branch, setting its upstream if needed. */
export async function push(dir: string): Promise<void> {
  try {
    await run(dir, "push", "--quiet");
  } catch (e) {
    const b = await currentBranch(dir);
    if (b === "") throw e;
    try {
      await run(dir, "push", "--quiet", "-u", "origin", b);
    } catch (e2) {
      throw new GitError(`${(e as Error).message}; ${(e2 as Error).message}`);
    }
  }
}

export async function lfsAvailable(dir: string): Promise<boolean> {
  return ok(dir, "lfs", "version");
}

/** Adds a pattern to .gitattributes via git lfs track. */
export async function lfsTrack(dir: string, pattern: string): Promise<void> {
  await run(dir, "lfs", "track", pattern);
}

/** Opens a pull request for the current branch with the gh CLI unless one is open. */
export async function ensurePR(dir: string, base: string): Promise<{ url: string; created: boolean }> {
  if (remote.isSpec(dir)) throw new GitError("pull requests need a local target");
  if (!which("gh")) throw new GitError("the gh CLI is not installed (https://cli.github.com)");
  const gh = async (...args: string[]) => {
    const r = await exec(["gh", ...args], { cwd: dir, env: { ...process.env, GH_PROMPT_DISABLED: "1" } });
    return { ok: r.code === 0, out: r.output.trim() };
  };
  const view = await gh("pr", "view", "--json", "url,state", "-q", 'select(.state == "OPEN") | .url');
  if (view.ok && view.out !== "") return { url: view.out, created: false };
  const args = ["pr", "create", "--fill"];
  if (base) args.push("--base", base);
  const r = await gh(...args);
  if (!r.ok) throw new GitError(lastLine(r.out));
  return { url: lastLine(r.out), created: true };
}

function lastLine(s: string): string {
  s = s.trim();
  const i = s.lastIndexOf("\n");
  return i >= 0 ? s.slice(i + 1) : s;
}

/** The committed content of rel (relative to dir) at HEAD, or null if it isn't in HEAD. */
export async function showHead(dir: string, rel: string): Promise<Buffer | null> {
  const cmd = command(dir, ["show", "HEAD:./" + slash(rel)]);
  try {
    const p = Bun.spawn({
      cmd,
      env: gitEnv() as Record<string, string>,
      stdout: "pipe",
      stderr: "ignore",
      stdin: "ignore",
      windowsHide: true,
    });
    const [buf, code] = await Promise.all([new Response(p.stdout).arrayBuffer(), p.exited]);
    return code === 0 ? Buffer.from(buf) : null;
  } catch {
    return null;
  }
}
