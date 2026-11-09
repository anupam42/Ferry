// A Git client for the web app: history, branches, staging (down to single
// lines), commits, stashes, merges and their conflicts, pull requests,
// cherry-pick, revert, tags and worktrees.
//
// Everything runs the git CLI in a local repository. User input (branch
// names, paths, commit ids, URLs) is validated and always passed as separate
// arguments, never through a shell, and values that look like options are
// refused.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { diff as lineDiff, type Line } from "./difftext.ts";
import { moveToTrash } from "./engine/trash.ts";
import { exec, which } from "./proc.ts";

export class GitClientError extends Error {
  constructor(message: string, public code = "") {
    super(message);
  }
}

const env = (extra: Record<string, string> = {}) => ({
  ...process.env, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C", GIT_EDITOR: "true", GIT_SEQUENCE_EDITOR: "true", ...extra,
});

/** Runs git in dir; throws GitClientError with git's own message on failure. */
async function git(dir: string, args: string[], o: { stdin?: string; timeoutMs?: number } = {}): Promise<string> {
  const r = await exec(["git", "-C", dir, ...args], { env: env(), stdin: o.stdin, timeoutMs: o.timeoutMs ?? 120_000 });
  if (r.code !== 0) throw new GitClientError(cleanMessage(r.stderr || r.stdout || r.error || "git failed"));
  return r.stdout;
}

async function gitOk(dir: string, args: string[]): Promise<boolean> {
  return (await exec(["git", "-C", dir, ...args], { env: env() })).code === 0;
}

/** git's messages without "hint:" noise, on one or two lines. */
function cleanMessage(s: string): string {
  return s.split("\n").filter((l) => l.trim() && !l.startsWith("hint:")).slice(0, 3).join(" ").replace(/^(error|fatal): /, "").trim();
}

// ---------- validation ----------

/** Refuses values git could read as an option. */
function plain(v: unknown, what: string): string {
  if (typeof v !== "string" || v.trim() === "") throw new GitClientError(`${what} is required`);
  const s = v.trim();
  if (s.startsWith("-")) throw new GitClientError(`${what} can't start with "-"`);
  if (/[\0\n\r]/.test(s)) throw new GitClientError(`${what} contains invalid characters`);
  return s;
}

async function branchName(dir: string, v: unknown): Promise<string> {
  const s = plain(v, "branch name");
  if (!(await gitOk(dir, ["check-ref-format", "--branch", s]))) throw new GitClientError(`"${s}" isn't a valid branch name`);
  return s;
}

async function tagName(dir: string, v: unknown): Promise<string> {
  const s = plain(v, "tag name");
  if (!(await gitOk(dir, ["check-ref-format", "refs/tags/" + s]))) throw new GitClientError(`"${s}" isn't a valid tag name`);
  return s;
}

function commitId(v: unknown): string {
  const s = plain(v, "commit");
  if (!/^[0-9a-f]{4,64}$/i.test(s)) throw new GitClientError(`"${s}" isn't a commit id`);
  return s;
}

/** A path inside the repository, as git expects it (slashes, no leading "./"). */
function repoPath(root: string, v: unknown): string {
  const s = plain(v, "path").replaceAll("\\", "/").replace(/^\.\/+/, "");
  const abs = path.resolve(root, s);
  if (abs !== root && !abs.startsWith(root + path.sep)) throw new GitClientError("that path is outside the repository");
  return s;
}

function stashRef(v: unknown): string {
  const s = plain(v, "stash");
  if (!/^stash@\{\d+\}$/.test(s)) throw new GitClientError(`"${s}" isn't a stash`);
  return s;
}

// ---------- repositories ----------

/** The top folder of the repository containing dir, or null. */
export async function repoRoot(dir: string): Promise<string | null> {
  const r = await exec(["git", "-C", dir, "rev-parse", "--show-toplevel"], { env: env() });
  return r.code === 0 ? path.resolve(r.stdout.trim()) : null;
}

/** Clones url into dest (which must not exist yet, or be empty). */
export async function clone(url: unknown, dest: unknown): Promise<string> {
  const u = plain(url, "repository URL");
  if (!/^(https?:\/\/|ssh:\/\/|git@|[\w.-]+@[\w.-]+:|file:\/\/|\/)/.test(u)) throw new GitClientError("use an https://, ssh:// or git@host:owner/repo URL");
  const d = path.resolve(expandHome(plain(dest, "destination folder")));
  if (fs.existsSync(d) && fs.readdirSync(d).length > 0) throw new GitClientError(`${d} already exists and isn't empty`);
  fs.mkdirSync(path.dirname(d), { recursive: true });
  const r = await exec(["git", "clone", "--", u, d], { env: env(), timeoutMs: 30 * 60_000 });
  if (r.code !== 0) throw new GitClientError(cleanMessage(r.stderr || r.error || "clone failed"));
  return d;
}

/** Creates a new repository (with a first branch called main) in dir. */
export async function create(dir: unknown): Promise<string> {
  const d = path.resolve(expandHome(plain(dir, "folder")));
  if (await repoRoot(d).catch(() => null) === d) throw new GitClientError(`${d} is already a repository`);
  fs.mkdirSync(d, { recursive: true });
  await git(d, ["init", "-q", "-b", "main"]);
  return d;
}

function expandHome(p: string): string {
  return p === "~" || p.startsWith("~/") ? path.join(os.homedir(), p.slice(1)) : p;
}

// ---------- state ----------

export interface FileChange {
  path: string;
  from?: string; // rename source
  x: string; // index status (porcelain X)
  y: string; // work tree status (porcelain Y)
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  conflicted: boolean;
}

export interface RepoState {
  root: string;
  branch: string; // "" when detached
  head: string; // short commit id, "" before the first commit
  detached: boolean;
  upstream: string;
  ahead: number;
  behind: number;
  operation: "" | "merge" | "rebase" | "cherry-pick" | "revert";
  operationBranch: string; // what is being merged, when known
  files: FileChange[];
  stashes: number;
  remotes: string[];
  lastCommit: { subject: string; hash: string; pushed: boolean } | null;
}

const CONFLICT = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);

export async function state(root: string): Promise<RepoState> {
  const out = await git(root, ["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all"]);
  const st: RepoState = {
    root, branch: "", head: "", detached: false, upstream: "", ahead: 0, behind: 0, operation: "", operationBranch: "",
    files: [], stashes: 0, remotes: [], lastCommit: null,
  };
  const parts = out.split("\0");
  for (let i = 0; i < parts.length; i++) {
    const l = parts[i]!;
    if (l.startsWith("# branch.oid ")) st.head = l.slice(13) === "(initial)" ? "" : l.slice(13, 20);
    else if (l.startsWith("# branch.head ")) {
      const b = l.slice(14);
      st.detached = b === "(detached)";
      st.branch = st.detached ? "" : b;
    } else if (l.startsWith("# branch.upstream ")) st.upstream = l.slice(18);
    else if (l.startsWith("# branch.ab ")) {
      const m = /\+(\d+) -(\d+)/.exec(l);
      if (m) [st.ahead, st.behind] = [+m[1]!, +m[2]!];
    } else if (l.startsWith("1 ") || l.startsWith("u ")) {
      const f = l.split(" ");
      const xy = f[1]!;
      const p = l.split(" ").slice(l.startsWith("1 ") ? 8 : 10).join(" ");
      st.files.push(change(p, xy));
    } else if (l.startsWith("2 ")) {
      const f = l.split(" ");
      const p = f.slice(9).join(" ");
      const c = change(p, f[1]!);
      c.from = parts[++i];
      st.files.push(c);
    } else if (l.startsWith("? ")) {
      st.files.push({ path: l.slice(2), x: "?", y: "?", staged: false, unstaged: true, untracked: true, conflicted: false });
    }
  }
  const [ops, stashes, remotes, last] = await Promise.all([
    operation(root),
    git(root, ["stash", "list", "--format=%gd"]).catch(() => ""),
    git(root, ["remote"]).catch(() => ""),
    st.head ? git(root, ["log", "-1", "--format=%h%x1f%s"]).catch(() => "") : Promise.resolve(""),
  ]);
  st.operation = ops.kind;
  st.operationBranch = ops.branch;
  st.stashes = stashes.split("\n").filter(Boolean).length;
  st.remotes = remotes.split("\n").filter(Boolean);
  if (last) {
    const [hash, subject] = last.trim().split("\x1f");
    // pushed = the commit is on some remote branch, so rewriting it needs a force push
    const pushed = st.upstream ? (await git(root, ["branch", "-r", "--contains", "HEAD"]).catch(() => "")).trim() !== "" : false;
    st.lastCommit = { hash: hash!, subject: subject ?? "", pushed };
  }
  return st;
}

function change(p: string, xy: string): FileChange {
  const x = xy[0]!, y = xy[1]!;
  return { path: p, x, y, staged: x !== "." && !CONFLICT.has(xy), unstaged: y !== ".", untracked: false, conflicted: CONFLICT.has(xy) };
}

async function gitPath(root: string, p: string): Promise<string> {
  const out = (await git(root, ["rev-parse", "--git-path", p])).trim();
  return path.isAbsolute(out) ? out : path.join(root, out);
}

/** Which multi-step operation is in progress, if any. */
async function operation(root: string): Promise<{ kind: RepoState["operation"]; branch: string }> {
  const exists = async (p: string) => fs.existsSync(await gitPath(root, p));
  if (await exists("MERGE_HEAD")) {
    let branch = "";
    try {
      branch = fs.readFileSync(await gitPath(root, "MERGE_MSG"), "utf8").split("\n")[0]!.replace(/^Merge (remote-tracking )?branch '([^']+)'.*$/, "$2");
    } catch {}
    return { kind: "merge", branch };
  }
  if ((await exists("rebase-merge")) || (await exists("rebase-apply"))) return { kind: "rebase", branch: "" };
  if (await exists("CHERRY_PICK_HEAD")) return { kind: "cherry-pick", branch: "" };
  if (await exists("REVERT_HEAD")) return { kind: "revert", branch: "" };
  return { kind: "", branch: "" };
}

// ---------- diffs ----------

/** Unified diff text as lines for the change story (headers dropped, hunks kept). */
export function parseUnified(text: string): Line[] {
  const out: Line[] = [];
  let header = true;
  for (const l of text.split("\n")) {
    if (l.startsWith("diff --git ")) {
      header = true;
      continue;
    }
    if (header) {
      if (l.startsWith("@@")) header = false;
      else {
        if (l.startsWith("Binary files")) out.push({ op: "@", text: "binary file changed" });
        continue;
      }
    }
    if (l.startsWith("@@")) {
      out.push({ op: "@", text: /^@@[^@]*@@/.exec(l)?.[0] ?? l });
      continue;
    }
    if (l.startsWith("\\")) continue; // "\ No newline at end of file"
    const op = l[0];
    if (op === "+" || op === "-" || op === " ") out.push({ op, text: l.slice(1) });
  }
  while (out.length && out[out.length - 1]!.op === " " && out[out.length - 1]!.text === "") out.pop();
  return out;
}

/** Most diff lines sent to the web page; past this the browser would crawl (a 250k-line generated file). */
export const MAX_DIFF_LINES = 3000;

interface FileDiff { lines: Line[]; before: string; after: string; more?: number }

/** Keeps the first MAX_DIFF_LINES lines and says how many were left out. */
function capped(d: FileDiff): FileDiff {
  if (d.lines.length <= MAX_DIFF_LINES) return d;
  return { ...d, lines: d.lines.slice(0, MAX_DIFF_LINES), more: d.lines.length - MAX_DIFF_LINES };
}

/** A working-tree file's changes: not yet staged, or already staged. */
export async function fileDiff(root: string, file: unknown, staged: boolean): Promise<FileDiff> {
  const p = repoPath(root, file);
  let text = "";
  if (!staged && !(await gitOk(root, ["ls-files", "--error-unmatch", "--", p]))) {
    // untracked: everything is new
    let data: Buffer = Buffer.alloc(0);
    try {
      data = fs.readFileSync(path.join(root, p));
    } catch {}
    return capped({ lines: lineDiff(Buffer.alloc(0), data, 3), before: "Not in git yet", after: "In your folder" });
  }
  text = await git(root, staged ? ["diff", "--cached", "--no-color", "-U3", "--", p] : ["diff", "--no-color", "-U3", "--", p]);
  return capped({ lines: parseUnified(text), before: staged ? "Last commit" : "Staged or last commit", after: staged ? "Staged for the next commit" : "In your folder" });
}

/**
 * Stages only some lines of a file. selected holds indices into the lines
 * returned by fileDiff(root, file, false): chosen "+" lines are added, chosen
 * "-" lines are removed, everything else stays as it is in the index.
 */
export async function stageLines(root: string, file: unknown, selected: unknown): Promise<number> {
  const p = repoPath(root, file);
  if (!Array.isArray(selected) || selected.some((n) => !Number.isInteger(n))) throw new GitClientError("pick at least one line");
  const want = new Set(selected as number[]);
  if (want.size === 0) throw new GitClientError("pick at least one line");
  const tracked = await gitOk(root, ["ls-files", "--error-unmatch", "--", p]);
  if (!tracked) await git(root, ["add", "--intent-to-add", "--", p]); // lets git diff show a new file line by line
  const raw = await git(root, ["diff", "--no-color", "-U3", "--", p]);
  const patch = buildPatch(raw, want, p);
  if (!patch) throw new GitClientError("none of the picked lines are changes");
  await git(root, ["apply", "--cached", "--recount", "--whitespace=nowarn", "-"], { stdin: patch });
  return want.size;
}

/** The part of a unified diff made of the selected changes, as a patch for `git apply --cached`. */
export function buildPatch(raw: string, want: Set<number>, file: string): string {
  const head: string[] = [];
  const hunks: string[][] = [];
  let header = true, idx = 0, cur: string[] | null = null, picked = false;
  const flush = () => {
    if (cur && picked) hunks.push(cur);
    cur = null;
    picked = false;
  };
  for (const l of raw.split("\n")) {
    if (header) {
      if (l.startsWith("@@")) header = false;
      else {
        if (l.startsWith("new file mode")) continue; // the file is already in the index (intent-to-add)
        head.push(l.startsWith("--- /dev/null") ? `--- a/${file}` : l);
        continue;
      }
    }
    if (l.startsWith("@@")) {
      flush();
      cur = [l];
      idx++; // the hunk header is one of fileDiff's lines too
      continue;
    }
    if (!cur) continue;
    if (l.startsWith("\\")) {
      cur.push(l);
      continue;
    }
    const op = l[0];
    if (op !== "+" && op !== "-" && op !== " ") continue;
    const chosen = want.has(idx);
    idx++;
    if (op === " ") cur.push(l);
    else if (chosen) {
      cur.push(l);
      picked = true;
    } else if (op === "-") cur.push(" " + l.slice(1)); // keep the line: not removed in this patch
    // an unpicked "+" line is simply left out
  }
  flush();
  if (hunks.length === 0) return "";
  return [...head, ...hunks.flat()].join("\n") + "\n";
}

// ---------- staging and committing ----------

export async function stage(root: string, files: unknown): Promise<void> {
  const list = Array.isArray(files) && files.length ? files.map((f) => repoPath(root, f)) : ["."];
  await git(root, ["add", "-A", "--", ...list]);
}

export async function unstage(root: string, files: unknown): Promise<void> {
  const list = Array.isArray(files) && files.length ? files.map((f) => repoPath(root, f)) : ["."];
  if (await gitOk(root, ["rev-parse", "--verify", "-q", "HEAD"])) await git(root, ["reset", "-q", "HEAD", "--", ...list]);
  else await git(root, ["rm", "--cached", "-r", "-q", "--", ...list]);
}

/**
 * Throws away uncommitted changes to files. The current versions are moved
 * to the system Trash first, so a discard can be undone from there.
 */
export async function discard(root: string, files: unknown): Promise<number> {
  const st = await state(root);
  const want = Array.isArray(files) && files.length ? new Set(files.map((f) => repoPath(root, f))) : null;
  const list = st.files.filter((f) => !want || want.has(f.path));
  if (list.length === 0) return 0;
  const keep = fs.mkdtempSync(path.join(os.tmpdir(), "ferry-discarded-"));
  for (const f of list) {
    const abs = path.join(root, f.path);
    if (fs.existsSync(abs)) {
      const copy = path.join(keep, f.path);
      fs.mkdirSync(path.dirname(copy), { recursive: true });
      fs.copyFileSync(abs, copy);
    }
  }
  await moveToTrash(keep).catch(() => {}); // best effort: the copies stay in the temp folder otherwise
  const hasHead = !!st.head;
  for (const f of list) {
    const abs = path.join(root, f.path);
    if (f.untracked) {
      fs.rmSync(abs, { force: true, recursive: true });
    } else if (f.x === "A" || !hasHead) {
      // new in the index: forget it, then remove the file
      await git(root, ["rm", "--cached", "-q", "-f", "--", f.path]).catch(() => {});
      fs.rmSync(abs, { force: true, recursive: true });
    } else if (f.x === "R" && f.from) {
      await git(root, ["reset", "-q", "HEAD", "--", f.path, f.from]);
      await git(root, ["checkout", "-q", "HEAD", "--", f.from]);
      fs.rmSync(abs, { force: true, recursive: true });
    } else {
      // modified or deleted, staged or not: back to the last commit
      await git(root, ["checkout", "-q", "HEAD", "--", f.path]);
    }
  }
  return list.length;
}

export async function commit(root: string, message: unknown, o: { amend?: boolean; coAuthors?: unknown } = {}): Promise<string> {
  let msg = typeof message === "string" ? message.trim() : "";
  if (Array.isArray(o.coAuthors) && o.coAuthors.length) {
    const lines = o.coAuthors.map((a) => plain(a, "co-author")).filter((a) => /^.+<[^>]+@[^>]+>$/.test(a));
    if (lines.length) msg += "\n\n" + lines.map((a) => "Co-authored-by: " + a).join("\n");
  }
  if (!msg && !o.amend) throw new GitClientError("write a commit message");
  const args = ["commit", "-q"];
  if (o.amend) args.push("--amend");
  if (msg) args.push("-m", msg);
  else args.push("--no-edit");
  if (!o.amend && (await gitOk(root, ["diff", "--cached", "--quiet"]))) throw new GitClientError("nothing is staged: pick some changes first");
  await git(root, args);
  return (await git(root, ["rev-parse", "--short", "HEAD"])).trim();
}

/** Undoes the last commit but keeps its changes, staged. */
export async function undoCommit(root: string): Promise<{ subject: string }> {
  if (!(await gitOk(root, ["rev-parse", "--verify", "-q", "HEAD~1"]))) throw new GitClientError("there's no earlier commit to go back to");
  const subject = (await git(root, ["log", "-1", "--format=%s"])).trim();
  await git(root, ["reset", "-q", "--soft", "HEAD~1"]);
  return { subject };
}

// ---------- stashes ----------

export async function stashes(root: string): Promise<{ ref: string; message: string; when: string; branch: string }[]> {
  const out = await git(root, ["stash", "list", "--format=%gd%x1f%gs%x1f%cI"]);
  return out.split("\n").filter(Boolean).map((l) => {
    const [ref, subject, when] = l.split("\x1f");
    const m = /^(?:WIP on|On) ([^:]+): (.*)$/.exec(subject ?? "");
    return { ref: ref!, message: m ? m[2]! : subject ?? "", branch: m ? m[1]! : "", when: when ?? "" };
  });
}

export async function stash(root: string, message: unknown): Promise<void> {
  const args = ["stash", "push", "--include-untracked"];
  if (typeof message === "string" && message.trim()) args.push("-m", message.trim());
  await git(root, args);
}

export async function stashApply(root: string, ref: unknown, pop: boolean): Promise<void> {
  await git(root, ["stash", pop ? "pop" : "apply", "--index", stashRef(ref)]).catch(async (e) => {
    // --index fails when the staged state can't be restored; try without it
    if (!/index/i.test(e.message)) throw e;
    await git(root, ["stash", pop ? "pop" : "apply", stashRef(ref)]);
  });
}

export async function stashDrop(root: string, ref: unknown): Promise<void> {
  await git(root, ["stash", "drop", stashRef(ref)]);
}

// ---------- history ----------

export interface Commit {
  hash: string;
  short: string;
  parents: string[];
  author: string;
  email: string;
  date: string;
  subject: string;
  refs: string[];
  /** the first line of the message body (a merged pull request's title, say) */
  note?: string;
  /** true for the commit HEAD points at */
  head?: boolean;
}

/**
 * Commits, newest first, in date order: a commit never comes before its
 * children, which is what drawing the branch graph needs. all: every local
 * and remote branch and tag, not just the current branch.
 */
export async function log(root: string, o: { skip?: number; limit?: number; ref?: string; all?: boolean } = {}): Promise<Commit[]> {
  if (!(await gitOk(root, ["rev-parse", "--verify", "-q", "HEAD"]))) return [];
  const limit = Math.min(Math.max(o.limit ?? 50, 1), 1000);
  const args = ["log", "--date-order", `--format=%H%x1f%h%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%D%x1f%b%x1e`, `-n${limit}`, `--skip=${Math.max(0, o.skip ?? 0)}`];
  if (o.all) args.push("--branches", "--remotes", "--tags", "HEAD");
  else if (o.ref) args.push(plain(o.ref, "branch"));
  args.push("--");
  const out = await git(root, args);
  return out.split("\x1e").map((r) => r.replace(/^\n+/, "")).filter((r) => r.trim()).map((r) => {
    const [hash, short, parents, author, email, date, subject, refs, body] = r.split("\x1f");
    const decor = refs ? refs.split(", ") : [];
    const note = (body ?? "").split("\n").map((l) => l.trim()).find((l) => l && !/^(co-authored-by|signed-off-by):/i.test(l)) ?? "";
    return {
      hash: hash!, short: short!, parents: parents ? parents.split(" ").filter(Boolean) : [], author: author!, email: email!, date: date!,
      subject: subject ?? "", refs: decor.map((x) => x.replace(/^HEAD -> /, "")).filter((x) => x && x !== "HEAD"),
      ...(note ? { note: note.slice(0, 200) } : {}), ...(decor.some((x) => x === "HEAD" || x.startsWith("HEAD -> ")) ? { head: true } : {}),
    };
  });
}

export interface CommitDetail extends Commit {
  body: string;
  files: { path: string; from?: string; status: string; added: number; removed: number }[];
}

export async function commitDetail(root: string, hash: unknown): Promise<CommitDetail> {
  const h = commitId(hash);
  const meta = await git(root, ["show", "-s", "--format=%H%x1f%h%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%D%x1f%b", h]);
  const [full, short, parents, author, email, date, subject, refs, body] = meta.split("\x1f");
  const ps = parents ? parents.trim().split(" ").filter(Boolean) : [];
  const range = ps.length ? [ps[0]!, full!.trim()] : ["--root", full!.trim()];
  const diffArgs = ps.length ? ["diff", "-M", ...range] : ["diff-tree", "-r", "-M", "--no-commit-id", ...range];
  const [names, nums] = await Promise.all([git(root, [...diffArgs, "--name-status"]), git(root, [...diffArgs, "--numstat"])]);
  const counts = new Map<string, [number, number]>();
  for (const l of nums.split("\n").filter(Boolean)) {
    const [a, r, ...rest] = l.split("\t");
    const p = rest.join("\t").replace(/^(.*)\{(.*) => (.*)\}(.*)$/, "$1$3$4").replace(/^.* => /, "");
    counts.set(p, [a === "-" ? 0 : +a!, r === "-" ? 0 : +r!]);
  }
  const files = names.split("\n").filter(Boolean).map((l) => {
    const [status, a, b] = l.split("\t");
    const p = b ?? a!;
    const [added, removed] = counts.get(p) ?? [0, 0];
    return { path: p, from: b ? a : undefined, status: status![0]!, added, removed };
  });
  return {
    hash: full!.trim(), short: short!, parents: ps, author: author!, email: email!, date: date!, subject: subject ?? "",
    refs: refs ? refs.split(", ").filter(Boolean) : [], body: (body ?? "").trim(), files,
  };
}

/** One file's change in a commit (against its first parent). */
export async function commitFileDiff(root: string, hash: unknown, file: unknown): Promise<FileDiff> {
  const h = commitId(hash);
  const p = repoPath(root, file);
  const parents = (await git(root, ["show", "-s", "--format=%P", h])).trim().split(" ").filter(Boolean);
  const text = parents.length
    ? await git(root, ["diff", "--no-color", "-M", "-U3", parents[0]!, h, "--", p])
    : await git(root, ["show", "--no-color", "--format=", h, "--", p]);
  return capped({ lines: parseUnified(text), before: parents.length ? "Before this commit" : "Nothing (first commit)", after: "After this commit" });
}

// ---------- branches ----------

export interface Branch {
  name: string;
  current: boolean;
  upstream: string;
  ahead: number;
  behind: number;
  gone: boolean;
  date: string;
  subject: string;
}

export async function branches(root: string): Promise<{ local: Branch[]; remote: { name: string; date: string; subject: string }[] }> {
  const fmt = "%(refname:short)%1f%(HEAD)%1f%(upstream:short)%1f%(upstream:track)%1f%(committerdate:iso-strict)%1f%(contents:subject)";
  const [l, r] = await Promise.all([
    git(root, ["for-each-ref", "--sort=-committerdate", "--format=" + fmt, "refs/heads"]),
    git(root, ["for-each-ref", "--sort=-committerdate", "--format=%(refname:short)%1f%(committerdate:iso-strict)%1f%(contents:subject)", "refs/remotes"]),
  ]);
  const local = l.split("\n").filter(Boolean).map((line) => {
    const [name, head, upstream, track, date, subject] = line.split("\x1f");
    return {
      name: name!, current: head === "*", upstream: upstream ?? "", gone: (track ?? "").includes("gone"),
      ahead: +(/ahead (\d+)/.exec(track ?? "")?.[1] ?? 0), behind: +(/behind (\d+)/.exec(track ?? "")?.[1] ?? 0), date: date ?? "", subject: subject ?? "",
    };
  });
  const tracked = new Set(local.map((b) => b.upstream));
  const remote = r.split("\n").filter(Boolean).map((line) => {
    const [name, date, subject] = line.split("\x1f");
    return { name: name!, date: date ?? "", subject: subject ?? "" };
  }).filter((b) => !b.name.endsWith("/HEAD") && b.name.includes("/") && !tracked.has(b.name));
  return { local, remote };
}

export async function createBranch(root: string, name: unknown, from: unknown, checkout: boolean): Promise<string> {
  const n = await branchName(root, name);
  const start = typeof from === "string" && from.trim() ? plain(from, "starting point") : "";
  if (checkout) await git(root, ["switch", "-c", n, ...(start ? [start] : [])]);
  else await git(root, ["branch", n, ...(start ? [start] : [])]);
  return n;
}

/** Switches branches. A remote branch (origin/x) gets a local branch that tracks it. */
export async function switchBranch(root: string, name: unknown): Promise<string> {
  const n = plain(name, "branch");
  if (await gitOk(root, ["show-ref", "--verify", "-q", "refs/heads/" + n])) {
    await git(root, ["switch", n]);
    return n;
  }
  if (await gitOk(root, ["show-ref", "--verify", "-q", "refs/remotes/" + n])) {
    const local = n.slice(n.indexOf("/") + 1);
    await git(root, ["switch", "--track", "-c", local, n]);
    return local;
  }
  throw new GitClientError(`there's no branch called ${n}`);
}

export async function renameBranch(root: string, from: unknown, to: unknown): Promise<void> {
  await git(root, ["branch", "-m", plain(from, "branch"), await branchName(root, to)]);
}

export async function deleteBranch(root: string, name: unknown, force: boolean): Promise<void> {
  try {
    await git(root, ["branch", force ? "-D" : "-d", plain(name, "branch")]);
  } catch (e) {
    if (!force && /not fully merged/.test((e as Error).message)) throw new GitClientError("this branch has commits that aren't merged anywhere", "unmerged");
    throw e;
  }
}

// ---------- remotes ----------

export async function fetchAll(root: string): Promise<void> {
  await git(root, ["fetch", "--all", "--prune", "--quiet"], { timeoutMs: 10 * 60_000 });
}

/**
 * Pulls the current branch. Without a strategy only a fast-forward is
 * allowed; when the branches have diverged this fails with code "diverged"
 * so the user can choose merge or rebase.
 */
export async function pull(root: string, strategy: unknown): Promise<void> {
  const args = ["pull", "--quiet"];
  if (strategy === "rebase") args.push("--rebase", "--autostash");
  else if (strategy === "merge") args.push("--no-rebase", "--no-edit");
  else args.push("--ff-only");
  try {
    await git(root, args, { timeoutMs: 10 * 60_000 });
  } catch (e) {
    const m = (e as Error).message;
    if (/not possible to fast-forward|diverg/i.test(m)) throw new GitClientError("your branch and the remote both have new commits", "diverged");
    if (/conflict/i.test(m)) throw new GitClientError("the pull stopped on conflicts: resolve them below", "conflicts");
    throw e;
  }
}

export async function push(root: string, force: boolean): Promise<string> {
  const st = await state(root);
  if (!st.branch) throw new GitClientError("switch to a branch before pushing");
  const args = ["push", "--quiet"];
  if (force) args.push("--force-with-lease");
  if (!st.upstream) {
    const remote = st.remotes.includes("origin") ? "origin" : st.remotes[0];
    if (!remote) throw new GitClientError("this repository has no remote to push to", "no-remote");
    args.push("--set-upstream", remote, st.branch);
  }
  try {
    await git(root, args, { timeoutMs: 10 * 60_000 });
  } catch (e) {
    if (/rejected|non-fast-forward|fetch first/i.test((e as Error).message)) throw new GitClientError("the remote has commits you don't have yet: pull first", "rejected");
    throw e;
  }
  return st.branch;
}

// ---------- merging, cherry-pick, revert ----------

export async function merge(root: string, branch: unknown): Promise<{ conflicts: string[] }> {
  const b = plain(branch, "branch");
  try {
    await git(root, ["merge", "--no-edit", b], { timeoutMs: 5 * 60_000 });
    return { conflicts: [] };
  } catch (e) {
    const conflicts = await conflicted(root);
    if (conflicts.length) return { conflicts };
    throw e;
  }
}

export async function cherryPick(root: string, hash: unknown): Promise<{ conflicts: string[] }> {
  const h = commitId(hash);
  try {
    await git(root, ["cherry-pick", h]);
    return { conflicts: [] };
  } catch (e) {
    const conflicts = await conflicted(root);
    if (conflicts.length) return { conflicts };
    throw e;
  }
}

export async function revert(root: string, hash: unknown): Promise<{ conflicts: string[] }> {
  const h = commitId(hash);
  try {
    await git(root, ["revert", "--no-edit", h]);
    return { conflicts: [] };
  } catch (e) {
    const conflicts = await conflicted(root);
    if (conflicts.length) return { conflicts };
    throw e;
  }
}

export async function conflicted(root: string): Promise<string[]> {
  return (await git(root, ["diff", "--name-only", "--diff-filter=U"]).catch(() => "")).split("\n").filter(Boolean);
}

/** Both sides of a conflicted file, as a diff from "yours" (ours) to "theirs". */
export async function conflictDiff(root: string, file: unknown): Promise<FileDiff> {
  const p = repoPath(root, file);
  const side = async (n: number) => {
    const r = await exec(["git", "-C", root, "show", `:${n}:${p}`], { env: env() });
    return r.code === 0 ? Buffer.from(r.stdout) : Buffer.alloc(0);
  };
  const [ours, theirs] = await Promise.all([side(2), side(3)]);
  return capped({ lines: lineDiff(ours, theirs, 3), before: "Your version (current branch)", after: "Their version (coming in)" });
}

/** Settles one conflicted file: keep yours, keep theirs, keep both (union), or mark your own edit as done. */
export async function resolveConflict(root: string, file: unknown, choice: unknown): Promise<void> {
  const p = repoPath(root, file);
  const abs = path.join(root, p);
  switch (choice) {
    case "ours":
    case "theirs":
      await git(root, ["checkout", `--${choice}`, "--", p]);
      break;
    case "both": {
      // a union merge keeps every line from both sides, without markers
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ferry-merge-"));
      try {
        const write = async (n: number, name: string) => {
          const r = await exec(["git", "-C", root, "show", `:${n}:${p}`], { env: env() });
          fs.writeFileSync(path.join(tmp, name), r.code === 0 ? r.stdout : "");
        };
        await Promise.all([write(1, "base"), write(2, "ours"), write(3, "theirs")]);
        const r = await exec(["git", "merge-file", "-p", "--union", path.join(tmp, "ours"), path.join(tmp, "base"), path.join(tmp, "theirs")], { env: env() });
        fs.writeFileSync(abs, r.stdout);
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
      break;
    }
    case "done": {
      const text = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : "";
      if (/^(<{7}|>{7}) /m.test(text)) throw new GitClientError(`${p} still has conflict markers (<<<<<<<); edit them out first`, "markers");
      break;
    }
    default:
      throw new GitClientError("choice must be ours, theirs, both or done");
  }
  await git(root, ["add", "--", p]);
}

/** Finishes or cancels the merge, rebase, cherry-pick or revert in progress. */
export async function finishOperation(root: string, action: "continue" | "abort"): Promise<void> {
  const op = (await operation(root)).kind;
  if (!op) throw new GitClientError("nothing is in progress");
  if (action === "continue") {
    const left = await conflicted(root);
    if (left.length) throw new GitClientError(`${left.length} file(s) still need a decision`, "conflicts");
    if (op === "merge") await git(root, ["commit", "--no-edit", "-q"]);
    else await git(root, [op, "--continue"]);
  } else {
    await git(root, [op, "--abort"]);
  }
}

// ---------- tags ----------

export async function tags(root: string): Promise<{ name: string; commit: string; date: string; message: string }[]> {
  const out = await git(root, ["tag", "-l", "--sort=-creatordate", "--format=%(refname:short)%1f%(objectname:short)%1f%(creatordate:iso-strict)%1f%(contents:subject)"]);
  return out.split("\n").filter(Boolean).map((l) => {
    const [name, commit, date, message] = l.split("\x1f");
    return { name: name!, commit: commit!, date: date ?? "", message: message ?? "" };
  });
}

export async function createTag(root: string, name: unknown, message: unknown, at: unknown): Promise<string> {
  const n = await tagName(root, name);
  const args = ["tag"];
  if (typeof message === "string" && message.trim()) args.push("-a", "-m", message.trim());
  args.push(n);
  if (typeof at === "string" && at.trim()) args.push(commitId(at));
  await git(root, args);
  return n;
}

export async function deleteTag(root: string, name: unknown): Promise<void> {
  await git(root, ["tag", "-d", plain(name, "tag")]);
}

export async function pushTags(root: string, name: unknown): Promise<void> {
  const st = await state(root);
  const remote = st.remotes.includes("origin") ? "origin" : st.remotes[0];
  if (!remote) throw new GitClientError("this repository has no remote to push to", "no-remote");
  if (typeof name === "string" && name.trim()) await git(root, ["push", "--quiet", remote, "refs/tags/" + plain(name, "tag")], { timeoutMs: 5 * 60_000 });
  else await git(root, ["push", "--quiet", remote, "--tags"], { timeoutMs: 5 * 60_000 });
}

// ---------- worktrees ----------

export async function worktrees(root: string): Promise<{ path: string; branch: string; head: string; main: boolean; locked: boolean; detached: boolean }[]> {
  const out = await git(root, ["worktree", "list", "--porcelain"]);
  const list: { path: string; branch: string; head: string; main: boolean; locked: boolean; detached: boolean }[] = [];
  for (const block of out.split("\n\n").filter((b) => b.trim())) {
    const w = { path: "", branch: "", head: "", main: list.length === 0, locked: false, detached: false };
    for (const l of block.split("\n")) {
      if (l.startsWith("worktree ")) w.path = l.slice(9);
      else if (l.startsWith("HEAD ")) w.head = l.slice(5, 12);
      else if (l.startsWith("branch ")) w.branch = l.slice(7).replace(/^refs\/heads\//, "");
      else if (l === "detached") w.detached = true;
      else if (l.startsWith("locked")) w.locked = true;
    }
    list.push(w);
  }
  return list;
}

export async function addWorktree(root: string, dir: unknown, branch: unknown, create: boolean): Promise<string> {
  const d = path.resolve(expandHome(plain(dir, "folder")));
  if (fs.existsSync(d) && fs.readdirSync(d).length > 0) throw new GitClientError(`${d} already exists and isn't empty`);
  const b = create ? await branchName(root, branch) : plain(branch, "branch");
  await git(root, create ? ["worktree", "add", "-b", b, d] : ["worktree", "add", d, b]);
  return d;
}

export async function removeWorktree(root: string, dir: unknown, force: boolean): Promise<void> {
  const d = plain(dir, "worktree");
  const known = (await worktrees(root)).find((w) => w.path === d);
  if (!known) throw new GitClientError("that isn't one of this repository's worktrees");
  if (known.main) throw new GitClientError("the main worktree can't be removed");
  await git(root, ["worktree", "remove", ...(force ? ["--force"] : []), d]);
}

// ---------- pull requests (GitHub through gh, GitLab through glab) ----------

export interface PullRequest {
  number: number;
  title: string;
  branch: string;
  base: string;
  author: string;
  draft: boolean;
  url: string;
  updated: string;
  review: string; // APPROVED | CHANGES_REQUESTED | REVIEW_REQUIRED | ""
  checks: { passed: number; failed: number; pending: number; items: { name: string; state: string; url: string }[] };
}

async function host(root: string): Promise<"github" | "gitlab" | ""> {
  const url = (await git(root, ["remote", "get-url", "origin"]).catch(() => "")).trim();
  if (/github/i.test(url)) return "github";
  if (/gitlab/i.test(url)) return "gitlab";
  return url ? "github" : "";
}

export async function pullRequests(root: string): Promise<{ provider: string; items: PullRequest[] }> {
  const h = await host(root);
  if (!h) throw new GitClientError("this repository has no remote called origin", "no-remote");
  if (h === "gitlab") {
    if (!which("glab")) throw new GitClientError("install the GitLab CLI (glab) and run `glab auth login` to see merge requests here", "no-cli");
    const r = await exec(["glab", "mr", "list", "--output", "json"], { cwd: root, timeoutMs: 60_000 });
    if (r.code !== 0) throw new GitClientError(cleanMessage(r.stderr || r.error || "glab failed"), "cli-failed");
    const raw = JSON.parse(r.stdout || "[]") as Record<string, any>[];
    return {
      provider: "GitLab", items: raw.map((m) => ({
        number: m.iid, title: m.title, branch: m.source_branch, base: m.target_branch, author: m.author?.username ?? "", draft: !!m.draft,
        url: m.web_url, updated: m.updated_at, review: "", checks: { passed: 0, failed: 0, pending: 0, items: [] },
      })),
    };
  }
  if (!which("gh")) throw new GitClientError("install the GitHub CLI (gh) and run `gh auth login` to see pull requests here", "no-cli");
  const r = await exec(["gh", "pr", "list", "--limit", "50", "--json", "number,title,headRefName,baseRefName,author,isDraft,url,updatedAt,reviewDecision,statusCheckRollup"], { cwd: root, timeoutMs: 60_000 });
  if (r.code !== 0) throw new GitClientError(cleanMessage(r.stderr || r.error || "gh failed"), "cli-failed");
  const raw = JSON.parse(r.stdout || "[]") as Record<string, any>[];
  return {
    provider: "GitHub", items: raw.map((p) => {
      const items = (p.statusCheckRollup ?? []).map((c: Record<string, any>) => {
        const s = String(c.conclusion || c.state || c.status || "").toUpperCase();
        const state = ["SUCCESS", "NEUTRAL", "SKIPPED"].includes(s) ? "passed" : ["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE"].includes(s) ? "failed" : "pending";
        return { name: c.name || c.context || "check", state, url: c.detailsUrl || c.targetUrl || "" };
      });
      return {
        number: p.number, title: p.title, branch: p.headRefName, base: p.baseRefName, author: p.author?.login ?? "", draft: !!p.isDraft,
        url: p.url, updated: p.updatedAt, review: p.reviewDecision ?? "",
        checks: {
          passed: items.filter((c: { state: string }) => c.state === "passed").length,
          failed: items.filter((c: { state: string }) => c.state === "failed").length,
          pending: items.filter((c: { state: string }) => c.state === "pending").length,
          items,
        },
      };
    }),
  };
}

/** Fetches a branch from origin and switches to a local branch that tracks it. */
export async function checkoutRemoteBranch(root: string, branch: unknown): Promise<string> {
  const b = await branchName(root, branch);
  await git(root, ["fetch", "--quiet", "origin", b], { timeoutMs: 5 * 60_000 });
  if (await gitOk(root, ["show-ref", "--verify", "-q", "refs/heads/" + b])) {
    await git(root, ["switch", b]);
    return b;
  }
  await git(root, ["switch", "--track", "-c", b, "origin/" + b]);
  return b;
}

export async function checkoutPullRequest(root: string, number: unknown): Promise<void> {
  const n = Number(number);
  if (!Number.isInteger(n) || n <= 0) throw new GitClientError("not a pull request number");
  const h = await host(root);
  const cmd = h === "gitlab" ? ["glab", "mr", "checkout", String(n)] : ["gh", "pr", "checkout", String(n)];
  if (!which(cmd[0]!)) throw new GitClientError(`install ${cmd[0]} to check out pull requests`, "no-cli");
  const r = await exec(cmd, { cwd: root, timeoutMs: 5 * 60_000, env: env() });
  if (r.code !== 0) throw new GitClientError(cleanMessage(r.stderr || r.error || "checkout failed"));
}

// ---------- insights: heatmaps of commits and files ----------

export interface Insights {
  /** the day the year ends on (today, in this computer's time zone), YYYY-MM-DD */
  today: string;
  /** commits per author-local day, YYYY-MM-DD → count */
  days: Record<string, number>;
  /** a few commits per day, newest first, for "what happened that day" */
  dayCommits: Record<string, { hash: string; short: string; subject: string; author: string }[]>;
  /** commits by weekday (0 = Monday) and hour (0–23, in the author's own time zone) */
  hours: number[][];
  /** the last 12 months, oldest first, YYYY-MM */
  months: string[];
  /** the files changed in the most commits, with commits per month (same order as months) */
  files: { path: string; commits: number; added: number; removed: number; months: number[] }[];
  authors: { name: string; email: string; commits: number }[];
  /** files by how often they change against how big they are now (lines), for the hotspot chart */
  hotspots: { path: string; commits: number; lines: number; authors: number }[];
  /** pairs of files that keep landing in the same commits */
  together: { a: string; b: string; count: number; share: number }[];
  me: string;
  total: number;
  added: number;
  removed: number;
  activeDays: number;
  streak: number;
  longestStreak: number;
  /** true when the year had more commits than were read */
  partial: boolean;
}

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const MAX_INSIGHT_COMMITS = 20_000;

/** A year of commits on the current branch, summed for heatmaps. author "me" keeps only your own (by git's user.email). */
export async function insights(root: string, o: { author?: string } = {}): Promise<Insights> {
  const now = new Date();
  const today = ymd(now);
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 371);
  const months: string[] = [];
  for (let k = 11; k >= 0; k--) {
    const d = new Date(now.getFullYear(), now.getMonth() - k, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  const me = (await exec(["git", "-C", root, "config", "user.email"], { env: env() })).stdout.trim().toLowerCase();
  const out: Insights = {
    today, days: {}, dayCommits: {}, hours: Array.from({ length: 7 }, () => Array(24).fill(0)), months, files: [], authors: [], hotspots: [], together: [], me,
    total: 0, added: 0, removed: 0, activeDays: 0, streak: 0, longestStreak: 0, partial: false,
  };
  if (!(await gitOk(root, ["rev-parse", "--verify", "-q", "HEAD"]))) return out;
  const text = await git(root, ["log", "--no-merges", "--no-renames", `--since=${ymd(start)}`, `-n${MAX_INSIGHT_COMMITS + 1}`,
    "--format=%x1e%H%x1f%h%x1f%aI%x1f%an%x1f%ae%x1f%s", "--numstat", "--"], { timeoutMs: 120_000 });
  const files = new Map<string, { commits: number; added: number; removed: number; months: number[]; people: Set<string> }>();
  const pairs = new Map<string, number>();
  const authors = new Map<string, { name: string; email: string; commits: number }>();
  let read = 0;
  for (const rec of text.split("\x1e")) {
    if (!rec.trim()) continue;
    if (++read > MAX_INSIGHT_COMMITS) { out.partial = true; break; }
    const [head, ...stats] = rec.split("\n");
    const [hash, short, date, name, email, subject] = head!.split("\x1f");
    if (!hash || !date) continue;
    const mail = (email ?? "").toLowerCase();
    const a = authors.get(mail) ?? { name: name ?? "", email: mail, commits: 0 };
    a.commits++;
    authors.set(mail, a);
    if (o.author === "me" && mail !== me) continue;
    // the author's own calendar day and hour, as written in the commit
    const day = date.slice(0, 10), hour = Number(date.slice(11, 13));
    const wd = (new Date(day + "T00:00:00Z").getUTCDay() + 6) % 7;
    out.total++;
    out.days[day] = (out.days[day] ?? 0) + 1;
    const that = (out.dayCommits[day] ??= []);
    if (that.length < 8) that.push({ hash, short: short ?? "", subject: subject ?? "", author: name ?? "" });
    if (hour >= 0 && hour < 24) out.hours[wd]![hour]!++;
    const mi = months.indexOf(day.slice(0, 7));
    const touched: string[] = [];
    for (const line of stats) {
      const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line);
      if (!m) continue;
      const add = m[1] === "-" ? 0 : Number(m[1]), del = m[2] === "-" ? 0 : Number(m[2]);
      out.added += add;
      out.removed += del;
      const f = files.get(m[3]!) ?? { commits: 0, added: 0, removed: 0, months: Array(12).fill(0), people: new Set<string>() };
      f.commits++;
      f.people.add(mail);
      touched.push(m[3]!);
      f.added += add;
      f.removed += del;
      if (mi >= 0) f.months[mi]++;
      files.set(m[3]!, f);
    }
    // big sweeping commits (formatting, renames) say little about which files belong together
    if (touched.length >= 2 && touched.length <= 30) {
      touched.sort();
      for (let i = 0; i < touched.length; i++) for (let j = i + 1; j < touched.length; j++) {
        const key = touched[i] + "\0" + touched[j];
        pairs.set(key, (pairs.get(key) ?? 0) + 1);
      }
    }
  }
  out.files = [...files].map(([path, { people: _, ...f }]) => ({ path, ...f })).sort((a, b) => b.commits - a.commits || b.added + b.removed - (a.added + a.removed)).slice(0, 20);
  out.authors = [...authors.values()].sort((a, b) => b.commits - a.commits).slice(0, 12);
  // hotspots: the most-changed files that still exist, with their size today
  for (const [p, f] of [...files].sort((a, b) => b[1].commits - a[1].commits).slice(0, 80)) {
    const lines = countLines(path.join(root, p));
    if (lines > 0) out.hotspots.push({ path: p, commits: f.commits, lines, authors: f.people.size });
  }
  out.together = [...pairs].filter(([, n]) => n >= 3).map(([key, n]) => {
    const [a, b] = key.split("\0") as [string, string];
    return { a, b, count: n, share: n / Math.min(files.get(a)!.commits, files.get(b)!.commits) };
  }).sort((x, y) => y.count - x.count || y.share - x.share).slice(0, 12);
  // streaks: consecutive days with a commit (today may still be empty without breaking the current one)
  const active = new Set(Object.keys(out.days));
  out.activeDays = active.size;
  let run = 0;
  for (let d = new Date(start); ymd(d) <= today; d.setDate(d.getDate() + 1)) {
    run = active.has(ymd(d)) ? run + 1 : 0;
    out.longestStreak = Math.max(out.longestStreak, run);
  }
  const back = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (active.has(today) ? 0 : 1));
  while (active.has(ymd(back))) { out.streak++; back.setDate(back.getDate() - 1); }
  return out;
}

/** Lines in a text file in the work tree; 0 when it's missing, binary or huge. */
function countLines(abs: string): number {
  try {
    const st = fs.statSync(abs);
    if (!st.isFile() || st.size > 8 * 1024 * 1024) return 0;
    const buf = fs.readFileSync(abs);
    if (buf.subarray(0, 8000).includes(0)) return 0;
    let n = 0;
    for (const c of buf) if (c === 10) n++;
    return buf.length && buf[buf.length - 1] !== 10 ? n + 1 : n;
  } catch {
    return 0;
  }
}
