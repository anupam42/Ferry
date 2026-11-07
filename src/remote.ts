// ssh targets, written either as "user@host:path" or
// "ssh://[user@]host[:port]/path". Commands go through the system ssh client,
// so keys, agents and ~/.ssh/config all work as usual.
import { exec, type ExecResult } from "./proc.ts";

const scpLike = /^([A-Za-z0-9._-]+@[A-Za-z0-9._-]+):(.*)$/s;

/** Whether s names an ssh target. Plain "host:path" is not accepted, so Windows drive letters never match. */
export function isSpec(s: string): boolean {
  return s.startsWith("ssh://") || scpLike.test(s);
}

export class Spec {
  constructor(
    public host: string, // may include user@
    public path: string, // absolute, or starting with ~
    public port = "",
  ) {}

  /** The canonical ssh:// form. */
  toString(): string {
    const host = this.port ? `${this.host}:${this.port}` : this.host;
    return "ssh://" + host + "/" + this.path.replace(/^\//, "");
  }

  /** The remote path quoted for a POSIX shell. */
  dir(): string {
    return quotePath(this.path);
  }

  /** The ssh command line that runs shell on the remote host. */
  command(shell: string): string[] {
    const args = ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15"];
    if (this.port) args.push("-p", this.port);
    return [...args, this.host, shell];
  }

  /** Runs shell remotely. */
  run(shell: string, opts: { stdin?: Uint8Array | { file: string }; timeoutMs?: number } = {}): Promise<ExecResult> {
    return exec(this.command(shell), opts);
  }
}

/** Reads "user@host:path" or "ssh://[user@]host[:port]/path". Relative paths are relative to the remote home folder. */
export function parse(s: string): Spec {
  if (s.startsWith("ssh://")) {
    const rest = s.slice(6);
    const slash = rest.indexOf("/");
    const hostPart = slash >= 0 ? rest.slice(0, slash) : rest;
    const p = slash >= 0 ? rest.slice(slash + 1) : "";
    if (slash < 0 || hostPart === "" || p === "") {
      throw new Error(`remote "${s}": expected ssh://[user@]host[:port]/path`);
    }
    let host = hostPart, port = "";
    const at = hostPart.lastIndexOf("@");
    const colon = hostPart.lastIndexOf(":");
    if (colon > at) {
      host = hostPart.slice(0, colon);
      port = hostPart.slice(colon + 1);
    }
    return new Spec(host, p.startsWith("~") ? p : "/" + p, port);
  }
  const m = scpLike.exec(s);
  if (!m) throw new Error(`remote "${s}": expected user@host:path or ssh://user@host/path`);
  let p = m[2]!;
  if (p === "" || p === "~") p = "~";
  else if (!p.startsWith("/") && !p.startsWith("~")) p = "~/" + p;
  return new Spec(m[1]!, p);
}

/** Single-quotes s for a POSIX shell. */
export function quote(s: string): string {
  return "'" + s.replaceAll("'", `'\\''`) + "'";
}

/** Quotes a path but keeps a leading ~ working. */
export function quotePath(p: string): string {
  if (p === "~") return `"$HOME"`;
  if (p.startsWith("~/")) return `"$HOME"/` + quote(p.slice(2));
  return quote(p);
}
