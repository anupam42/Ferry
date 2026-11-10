// What GET /release, /release/health and /release/latest answer: release
// notes from CHANGELOG.md, this copy of Ferry, its health, and the update
// check. No imports, so the server and the web app share these.

export interface ChangeItem {
  title: string;
  text: string; // markdown, may be ""
  try: string; // a place in the app ("git-undo"…), or ""
}

export type ChangeKind = "new" | "improved" | "fixed" | "breaking" | "other";

/** One release in CHANGELOG.md. */
export interface Release {
  version: string;
  date: string; // YYYY-MM-DD, or "" (unreleased or not known)
  unreleased: boolean;
  planned: string; // "YYYY-MM-DDTHH:MM" (the reader's local time) when a release is scheduled, else ""
  summary: string;
  groups: { kind: ChangeKind; items: ChangeItem[] }[];
}

export type InstallMethod = "source" | "scoop" | "winget" | "homebrew" | "binary";

/** GET /release: this copy of Ferry, and every release, newest first */
export interface ReleaseInfo {
  version: string;
  commit: string;
  built: string;
  dev: boolean;
  install: { method: InstallMethod; update: string; where: string };
  platform: string;
  arch: string;
  bun: string;
  releases: Release[];
}

/** GET /release/health: one tool Ferry relies on */
export interface Health { name: string; ok: boolean; detail: string; needed: boolean }

/** GET /release/latest: the newest release on GitHub, against this one */
export interface LatestRelease { version: string; name: string; url: string; date: string; notes: string; current: string; newer: boolean }
