// Flags files that look like they hold credentials before they reach the repo.
import fs from "node:fs";
import path from "node:path";

const SCAN_MAX = 2 << 20; // only the first 2MB of a file are scanned

const secretFileNames: Record<string, string> = {
  id_rsa: "SSH private key", id_dsa: "SSH private key", id_ecdsa: "SSH private key",
  id_ed25519: "SSH private key", ".pgpass": "PostgreSQL password file", ".netrc": "netrc credentials",
  "credentials.json": "credentials file", "service-account.json": "service account key",
  ".htpasswd": "password file", "secrets.yml": "secrets file", "secrets.yaml": "secrets file",
};

const secretExts = [".pem", ".key", ".p12", ".pfx", ".keystore", ".jks", ".ppk", ".kdbx"];

const secretPatterns: [string, RegExp][] = [
  ["private key", /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY(?: BLOCK)?-----/],
  ["AWS access key", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ["GitHub token", /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})/],
  ["GitLab token", /\bglpat-[A-Za-z0-9_\-]{20,}/],
  ["Slack token", /\bxox[abposr]-[A-Za-z0-9-]{10,}/],
  ["Stripe live key", /\b[sr]k_live_[A-Za-z0-9]{20,}/],
  ["Google API key", /\bAIza[0-9A-Za-z_\-]{35}/],
  ["API key (sk-…)", /\bsk-(?:ant-|proj-)?[A-Za-z0-9_\-]{32,}/],
  [
    "password or token assignment",
    /\b(?:api[_-]?key|secret[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|passw(?:or)?d)["']?\s*[:=]\s*["'][^"'\s]{12,}["']/i,
  ],
];

/** Flags file names that usually hold credentials. */
export function secretNameHit(rel: string): string {
  const base = path.posix.basename(rel).toLowerCase();
  if (base === ".env") return "environment file";
  if (base.startsWith(".env.")) {
    for (const ok of [".example", ".sample", ".template", ".dist", ".defaults"]) if (base.endsWith(ok)) return "";
    return "environment file";
  }
  const what = secretFileNames[base];
  if (what) return what;
  for (const ext of secretExts) if (base.endsWith(ext)) return `key or certificate file (${ext})`;
  return "";
}

/** The kinds of credentials found in data. */
export function scanSecretContent(data: Uint8Array): string[] {
  const s = Buffer.from(data.buffer, data.byteOffset, Math.min(data.byteLength, SCAN_MAX)).toString("latin1");
  return secretPatterns.filter(([, re]) => re.test(s)).map(([name]) => name);
}

/** Reads the start of a file and scans it. */
export function scanSecretFile(p: string): string[] {
  let fd: number;
  try {
    fd = fs.openSync(p, "r");
  } catch {
    return [];
  }
  try {
    const buf = Buffer.alloc(SCAN_MAX);
    const n = fs.readSync(fd, buf, 0, SCAN_MAX, 0);
    return scanSecretContent(buf.subarray(0, n));
  } catch {
    return [];
  } finally {
    fs.closeSync(fd);
  }
}
