// Small formatting helpers (plain TypeScript, so they're unit-testable).

/** "5 min ago", or the exact time when Settings → Times says so. */
export function ago(iso: string): string {
  const t = Date.parse(iso);
  if (!t || iso.startsWith("0001")) return "never";
  if (typeof localStorage !== "undefined" && localStorage.getItem("ferry-time") === "exact") return new Date(t).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  const d = (Date.now() - t) / 1000;
  if (d < 45) return "just now";
  if (d < 3600) return Math.round(d / 60) + " min ago";
  if (d < 86400) return Math.round(d / 3600) + " h ago";
  return new Date(t).toLocaleString();
}

export const plural = (n: number, w: string, many?: string) => `${n} ${n === 1 ? w : many || w + "s"}`;
