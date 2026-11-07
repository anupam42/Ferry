// Running other programs: git, ssh, gh, notifiers, hooks.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const isWindows = process.platform === "win32";
export const isMac = process.platform === "darwin";

export interface ExecOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  /** Data or a file to feed to stdin. */
  stdin?: Uint8Array | string | { file: string };
  timeoutMs?: number;
}

export interface ExecResult {
  code: number; // -1 if the program could not be started
  stdout: string;
  stderr: string;
  /** stdout and stderr together, like Go's CombinedOutput. */
  output: string;
  /** Why the program failed, for error messages. */
  error?: string;
}

/** Runs a program to completion. It never throws; check result.code. */
export async function exec(cmd: string[], o: ExecOptions = {}): Promise<ExecResult> {
  let stdin: "ignore" | Blob | Uint8Array = "ignore";
  if (typeof o.stdin === "string") stdin = new TextEncoder().encode(o.stdin);
  else if (o.stdin instanceof Uint8Array) stdin = o.stdin;
  else if (o.stdin) stdin = Bun.file(o.stdin.file);
  let proc: Bun.Subprocess<any, "pipe", "pipe">;
  try {
    proc = Bun.spawn({
      cmd,
      cwd: o.cwd,
      env: (o.env ?? process.env) as Record<string, string>,
      stdin,
      stdout: "pipe",
      stderr: "pipe",
      windowsHide: true,
      timeout: o.timeoutMs,
      killSignal: "SIGKILL",
    });
  } catch (e) {
    const msg = `exec: "${cmd[0]}": ${e instanceof Error && (e as any).code === "ENOENT" ? "executable file not found" : String(e)}`;
    return { code: -1, stdout: "", stderr: msg, output: msg, error: msg };
  }
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  const res: ExecResult = { code, stdout, stderr, output: stdout + stderr };
  if (code !== 0) {
    res.error = proc.signalCode ? `signal: ${proc.signalCode}` : `exit status ${code}`;
    if (o.timeoutMs && proc.signalCode) res.error = "timed out";
  }
  return res;
}

/** Starts a program and doesn't wait for it. */
export function startDetached(cmd: string[]): boolean {
  try {
    const p = Bun.spawn({ cmd, stdin: "ignore", stdout: "ignore", stderr: "ignore", windowsHide: true });
    p.unref();
    return true;
  } catch {
    return false;
  }
}

/** Runs a program attached to this terminal (for $EDITOR). */
export async function execInteractive(cmd: string[]): Promise<number> {
  const p = Bun.spawn({ cmd, stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  return p.exited;
}

export function which(name: string): string | null {
  return Bun.which(name);
}

/** Whether a process with this id is running. */
export function processAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    return e?.code === "EPERM";
  }
}

/**
 * The command that starts this program again: the compiled binary, or bun
 * plus the entry script when running from source.
 */
export function selfCommand(): string[] {
  const main = Bun.main;
  const compiled = main.startsWith("/$bunfs/") || /^[A-Za-z]:[\\/]~BUN[\\/]/.test(main) || main.includes("$bunfs");
  const exe = fs.realpathSync(process.execPath);
  return compiled ? [exe] : [exe, path.resolve(main)];
}

export function homeDir(): string {
  return os.homedir();
}
