// Files view helpers (plain TypeScript, unit-tested).

export interface Folder {
  dirs: Set<string>;
  files: string[];
}

/** folder → its sub-folders and files, from the flat list of tracked paths. */
export function folderTree(paths: string[]): Map<string, Folder> {
  const tree = new Map<string, Folder>([["", { dirs: new Set(), files: [] }]]);
  for (const p of paths) {
    const parts = p.split("/");
    let cur = "";
    for (let i = 0; i < parts.length - 1; i++) {
      const next = cur ? cur + "/" + parts[i] : parts[i]!;
      tree.get(cur)!.dirs.add(parts[i]!);
      if (!tree.has(next)) tree.set(next, { dirs: new Set(), files: [] });
      cur = next;
    }
    tree.get(cur)!.files.push(parts[parts.length - 1]!);
  }
  return tree;
}

export const fileSize = (n: number | null) =>
  n == null
    ? ""
    : n < 1024
      ? n + " B"
      : n < 1048576
        ? (n / 1024).toFixed(n < 10240 ? 1 : 0) + " KB"
        : (n / 1048576).toFixed(1) + " MB";
export const README = /^readme(\.(md|markdown|mdown|mkd|txt|rst))?$/i;
/** The folder's README, preferring markdown. */
export const readmeOf = (files: string[]) =>
  files.filter((f) => README.test(f)).sort((a, b) => (/\.md$/i.test(b) ? 1 : 0) - (/\.md$/i.test(a) ? 1 : 0))[0];

/** "3 days ago", in the words a file browser uses. */
export function since(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (!t) return "";
  const s = (now - t) / 1000;
  for (const [sec, u] of [
    [31536000, "year"],
    [2592000, "month"],
    [604800, "week"],
    [86400, "day"],
    [3600, "hour"],
    [60, "minute"],
  ] as const) {
    if (s >= sec) {
      const n = Math.floor(s / sec);
      return `${n} ${u}${n > 1 ? "s" : ""} ago`;
    }
  }
  return "just now";
}

/** Files whose path holds every word of the query, shallowest and shortest first. */
export function findFiles(paths: string[], query: string, max = 100): string[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  return paths
    .filter((p) => {
      const l = p.toLowerCase();
      return terms.every((t) => l.includes(t));
    })
    .sort((a, b) => a.split("/").length - b.split("/").length || a.length - b.length)
    .slice(0, max);
}
