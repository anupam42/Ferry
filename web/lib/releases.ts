// Release notes and the update notice, the plain part (unit-tested): what a
// release is called, which notice is worth showing, the countdown, and which
// releases "What's new" covers.
import type { ChangeItem, ChangeKind, LatestRelease, Release } from "../../src/shared/release.ts";

/** Each kind of change: its name, icon and tone. */
export const REL_KIND: Record<ChangeKind, [string, string, string]> = {
  new: ["New", "sparkle", "green"],
  improved: ["Improved", "rocket", "blue"],
  fixed: ["Fixed", "check", "violet"],
  breaking: ["Breaking", "warn", "red"],
  other: ["Other", "list", "muted"],
};
export const INSTALL_NAME: Record<string, string> = {
  source: "from source (bun)",
  scoop: "with Scoop",
  winget: "with winget",
  homebrew: "with Homebrew",
  binary: "as a downloaded binary",
};
export const PLATFORM_NAME: Record<string, string> = { win32: "Windows", darwin: "macOS", linux: "Linux" };

export const relCount = (r: Release) => r.groups.reduce((n, g) => n + g.items.length, 0);
/** Which release someone has seen: its version, plus how many changes an unreleased one had (so new ones show up). */
export const relKey = (r: Release) => r.version + (r.unreleased ? "+" + relCount(r) : "");
const date = (d: Date) => d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
export const relWhen = (r: Release) =>
  r.planned
    ? "Planned " + date(new Date(r.planned))
    : r.unreleased
      ? "In development"
      : r.date
        ? date(new Date(r.date + "T12:00:00"))
        : "";

/** Compares versions like 1.2.10 and 1.3.0 (major, minor, patch). */
export function cmpVersion(a: string, b: string): number {
  const pa = String(a).split(/[.-]/),
    pb = String(b).split(/[.-]/);
  for (let i = 0; i < 3; i++) {
    const d = (+pa[i]! || 0) - (+pb[i]! || 0);
    if (d) return d;
  }
  return 0;
}

export type Notice =
  | { kind: "available"; version: string; current: string }
  | { kind: "countdown" | "due"; version: string; at: number; release: Release }
  | { kind: "soon" | "new"; version: string; release: Release };

/**
 * What's worth announcing, most important first: a newer version you can
 * update to, a planned release (counting down), the version being built, or
 * a new version you haven't looked at yet.
 */
export function pickNotice(
  releases: Release[],
  current: string,
  o: { checkOn: boolean; last: LatestRelease | null; seen: string; now: number },
): Notice | null {
  if (o.checkOn && o.last?.newer) return { kind: "available", version: o.last.version, current };
  const top = releases[0];
  if (!top) return null;
  if (top.planned) {
    const at = new Date(top.planned).getTime();
    return { kind: at > o.now ? "countdown" : "due", version: top.version, at, release: top };
  }
  if (top.unreleased) return { kind: "soon", version: top.version, release: top };
  if (o.seen !== relKey(top)) return { kind: "new", version: top.version, release: top };
  return null;
}
export const noticeKey = (n: Notice) => n.kind + ":" + n.version;

/** 2d 04h 12m 08s; shorter for the folded tag (2d 4h, 3h 12m, 12m 30s). */
export function countdown(ms: number, short = false): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400),
    hh = Math.floor((s % 86400) / 3600),
    mm = Math.floor((s % 3600) / 60),
    ss = s % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  if (short) return d ? `${d}d ${hh}h` : hh ? `${hh}h ${mm}m` : `${mm}m ${p(ss)}s`;
  return (d ? `${d}d ` : "") + `${p(hh)}h ${p(mm)}m ${p(ss)}s`;
}

export type Item = ChangeItem & { kind: ChangeKind; version: string };

/**
 * What "What's new" shows: every release since the one you last looked at
 * (or just the newest), or one version when asked. The headline is the first
 * new feature; it isn't repeated in the lists below it.
 */
export function whatsNew(all: Release[], seen: string, only = "") {
  const seenVersion = seen.split("+")[0] ?? "";
  let show = only
    ? all.filter((r) => r.version === only)
    : all.filter((r, i) => i === 0 || (!!seenVersion && cmpVersion(r.version, seenVersion) > 0));
  if (!show.length && all[0]) show = [all[0]];
  const items: Item[] = show.flatMap((r) =>
    r.groups.flatMap((g) => g.items.map((it) => ({ ...it, kind: g.kind, version: r.version }))),
  );
  const star = items.find((it) => it.kind === "new") ?? items[0] ?? null;
  const counts = (["new", "improved", "fixed", "breaking"] as ChangeKind[])
    .map((k) => [k, items.filter((it) => it.kind === k).length] as const)
    .filter(([, n]) => n);
  const rest = (r: Release) =>
    r.groups
      .map((g) => ({
        kind: g.kind,
        items: g.items.filter((it) => !(star && it.title === star.title && r.version === star.version)),
      }))
      .filter((g) => g.items.length);
  return { show, top: show[0] ?? null, star, counts, total: items.length, rest };
}

/** Where a "Try it" place in the changelog goes in the app. */
export type Place = { mode: "git"; view: string } | { mode: "sync" } | { mode: "settings"; section: string } | null;
export function placeFor(place: string): Place {
  const git: Record<string, string> = {
    "git-files": "files",
    "git-changes": "changes",
    "git-history": "history",
    "git-undo": "undo",
    "git-prs": "prs",
    "git-branches": "branches",
    "git-insights": "insights",
  };
  if (git[place]) return { mode: "git", view: git[place]! };
  if (place === "pairs") return { mode: "sync" };
  if (place.startsWith("settings-")) return { mode: "settings", section: place.slice(9) };
  return null;
}
