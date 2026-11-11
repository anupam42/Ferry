// What's new and release info for the web app: the changelog (bundled into
// the binary, so it works offline), this build's details, how Ferry was
// installed (and so how to update it), a quick health check of the tools it
// uses, and, only when asked, the latest release on GitHub.
import fs from "node:fs";
import path from "node:path";

import changelogText from "../CHANGELOG.md" with { type: "text" };
import { dataDir } from "./config.ts";
import { exec, which } from "./proc.ts";

import type { Health, InstallMethod, Release } from "./shared/release.ts";
export type { ChangeItem, Health, Release } from "./shared/release.ts";

const KINDS: Record<string, Release["groups"][number]["kind"]> = { new: "new", added: "new", improved: "improved", changed: "improved", fixed: "fixed", breaking: "breaking", removed: "breaking" };

/** Releases from CHANGELOG.md, newest first (see the file's header for the format). */
export function parseChangelog(md: string): Release[] {
  const out: Release[] = [];
  let cur: Release | null = null;
  let group: Release["groups"][number] | null = null;
  for (const raw of md.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    const head = /^##\s+\[?v?(\d+\.\d+\.\d+[\w.-]*)\]?(?:\s*[-–—]\s*(.+))?\s*$/.exec(line);
    if (head) {
      const when = (head[2] ?? "").trim();
      // "Planned 2026-12-05 15:00" (or just a date): a release that's scheduled, with a countdown in the app
      const plan = /planned\s+(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}:\d{2}))?/i.exec(when);
      const planned = plan ? `${plan[1]}T${(plan[2] ?? "09:00").padStart(5, "0")}` : "";
      cur = { version: head[1]!, date: /^\d{4}-\d{2}-\d{2}$/.test(when) ? when : "", unreleased: /unreleased/i.test(when) || !!plan, planned, summary: "", groups: [] };
      out.push(cur);
      group = null;
      continue;
    }
    if (!cur) continue;
    const sec = /^###\s+(.+)$/.exec(line);
    if (sec) {
      group = { kind: KINDS[sec[1]!.trim().toLowerCase()] ?? "other", items: [] };
      cur.groups.push(group);
      continue;
    }
    if (line.startsWith(">") && !group && !cur.summary) { cur.summary = line.replace(/^>\s?/, "").trim(); continue; }
    const item = /^-\s+(.*)$/.exec(line);
    if (item && group) {
      let body = item[1]!;
      let place = "";
      body = body.replace(/\s*\[try:\s*([\w-]+)\]\s*$/, (_, p: string) => { place = p; return ""; });
      const t = /^\*\*(.+?)\*\*[:.]?\s*(.*)$/.exec(body);
      // "**Title**: what it does" reads well in the file; shown on its own, the sentence starts with a capital
      const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
      group.items.push(t ? { title: t[1]!, text: sentence(t[2]!), try: place } : { title: body, text: "", try: place });
      continue;
    }
    // a line that continues the previous item
    if (line.startsWith("  ") && group && group.items.length) {
      const last = group.items[group.items.length - 1]!;
      last.text = (last.text + " " + line.trim()).trim();
    }
  }
  return out.map((r) => ({ ...r, groups: r.groups.filter((g) => g.items.length) }));
}

/** How this copy of Ferry was installed, which decides how to update it. */
export function installMethod(): { method: InstallMethod; update: string; where: string } {
  const main = Bun.main;
  const compiled = main.startsWith("/$bunfs/") || /^[A-Za-z]:[\\/]~BUN[\\/]/.test(main) || main.includes("$bunfs");
  const exe = (() => { try { return fs.realpathSync(process.execPath); } catch { return process.execPath; } })();
  if (!compiled) return { method: "source", update: "git pull && bun install", where: path.dirname(path.dirname(path.resolve(main))) };
  const p = exe.replaceAll("\\", "/").toLowerCase();
  if (p.includes("/scoop/apps/")) return { method: "scoop", update: "scoop update ferry", where: exe };
  if (p.includes("/winget/") || p.includes("/microsoft/winget/")) return { method: "winget", update: "winget upgrade anupam42.ferry", where: exe };
  if (p.includes("/cellar/") || p.includes("/homebrew/") || p.includes("/linuxbrew/")) return { method: "homebrew", update: "brew upgrade ferry", where: exe };
  return { method: "binary", update: "", where: exe };
}

/** The tools Ferry relies on, and whether its data folder can be written. Never fails. */
export async function health(): Promise<Health[]> {
  const version = async (cmd: string[], re: RegExp) => {
    if (!which(cmd[0]!)) return "";
    const r = await exec(cmd, { timeoutMs: 8000 });
    return r.code === 0 ? (re.exec(r.stdout + r.stderr)?.[1] ?? "installed") : "installed";
  };
  const [git, gh, ssh] = await Promise.all([
    version(["git", "--version"], /git version (\S+)/),
    version(["gh", "--version"], /gh version (\S+)/),
    version(["ssh", "-V"], /OpenSSH_([\w.]+)/),
  ]);
  let writable = false;
  try {
    fs.mkdirSync(dataDir(), { recursive: true });
    fs.accessSync(dataDir(), fs.constants.W_OK);
    writable = true;
  } catch {}
  return [
    { name: "git", ok: !!git, detail: git ? git : "not found: Ferry needs git for repositories", needed: true },
    { name: "GitHub CLI (gh)", ok: !!gh, detail: gh ? gh : "not installed: needed for GitHub pull requests", needed: false },
    { name: "ssh", ok: !!ssh, detail: ssh ? ssh : "not found: needed for ssh targets", needed: false },
    { name: "Data folder", ok: writable, detail: writable ? dataDir() : `can't write to ${dataDir()}`, needed: true },
  ];
}

const REPO = "anupam42/Ferry";

/**
 * The newest release on GitHub. Only called when the user asks (the update
 * check is off until they turn it on); sends nothing but the request itself.
 */
export async function latestRelease(): Promise<{ version: string; name: string; url: string; date: string; notes: string }> {
  let res: Response;
  try {
    res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: "application/vnd.github+json", "User-Agent": "ferry-update-check" }, signal: AbortSignal.timeout(10_000) });
  } catch (e) {
    throw new Error(`couldn't reach GitHub: ${(e as Error).message}`, { cause: e });
  }
  if (res.status === 404) throw new Error("no releases are published yet");
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  const j = (await res.json()) as { tag_name?: string; name?: string; html_url?: string; published_at?: string; body?: string };
  return { version: String(j.tag_name ?? "").replace(/^v/, ""), name: j.name ?? "", url: j.html_url ?? `https://github.com/${REPO}/releases`, date: (j.published_at ?? "").slice(0, 10), notes: j.body ?? "" };
}

/** a.b.c compared numerically; pre-release tags sort before the release. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/), pb = b.split(/[.-]/);
  for (let i = 0; i < 3; i++) {
    const d = (+(pa[i] ?? 0) || 0) - (+(pb[i] ?? 0) || 0);
    if (d) return d;
  }
  return (pa.length > 3 ? -1 : 0) - (pb.length > 3 ? -1 : 0);
}

export const releases = (): Release[] => parseChangelog(changelogText as unknown as string);
