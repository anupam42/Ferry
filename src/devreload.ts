// Hot reload for working on the web app: "ferry ui --dev" (or "bun run dev").
//
// Two parts:
//   - a supervisor that runs the real "ferry ui" as a child and restarts it
//     when Ferry's TypeScript changes. The browser notices the new server and
//     reloads, keeping your place.
//   - inside that child, src/cli/ui.ts rebuilds the web app when web/ changes
//     and tells open browsers: a style-only change is swapped in without a
//     reload, anything else reloads the page where you were.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Set in the child the supervisor runs, so it doesn't supervise itself. */
export const CHILD_ENV = "FERRY_DEV_CHILD";
/** Where the child writes the port it settled on, so a restart reuses it. */
export const PORT_FILE_ENV = "FERRY_DEV_PORT_FILE";

/** True when Ferry runs from its source tree (web/ is next to src/), not from a compiled binary. */
export function runningFromSource(): boolean {
  return fs.existsSync(path.join(import.meta.dir, "..", "web", "main.ts"));
}

/** What changed in the web app: "css" can be swapped in without a reload. */
export type PageChange = "css" | "page";

/** Changes on every start of the server, so an open page can tell it was restarted (and reload). */
export const newBoot = () => crypto.randomBytes(6).toString("hex");

/**
 * Runs "ferry ui" (these args, minus --dev) as a child and restarts it when a
 * .ts file under src/ changes. Returns when the user presses Ctrl+C.
 */
export async function supervise(args: string[], log: (msg: string) => void): Promise<void> {
  const src = import.meta.dir;
  const portFile = path.join(os.tmpdir(), `ferry-dev-${process.pid}.port`);
  const main = path.join(src, "main.ts");
  let child: ReturnType<typeof Bun.spawn> | null = null;
  let restarts = 0;
  let stopping = false;

  const start = () => {
    const extra: string[] = [];
    if (restarts > 0) {
      // same port as before, and no new browser tab: the open one reconnects
      const port = fs.existsSync(portFile) ? fs.readFileSync(portFile, "utf8").trim() : "";
      if (/^\d+$/.test(port)) extra.push("--port", port);
      extra.push("--no-open");
    }
    const c = Bun.spawn([process.execPath, main, "ui", "--dev", ...args, ...extra], {
      env: { ...process.env, [CHILD_ENV]: "1", [PORT_FILE_ENV]: portFile },
      stdio: ["inherit", "inherit", "inherit"],
    });
    child = c;
    void c.exited.then((code) => {
      if (child === c && !stopping && !restarting)
        log(`ferry ui stopped (exit ${code}); save a file to start it again`);
    });
  };
  let restarting = false;
  const restart = async (why: string) => {
    if (stopping) return;
    restarts++;
    restarting = true;
    log(`${why} changed, restarting…`);
    const c = child;
    c?.kill("SIGTERM");
    await c?.exited;
    restarting = false;
    if (!stopping) start();
  };

  let timer: ReturnType<typeof setTimeout> | null = null;
  // the OS can report one save several times, late: only a new modification time counts,
  // and (macOS replays recent history) nothing saved before we started
  const seen = new Map<string, number>();
  const startedAt = Date.now();
  const watcher = fs.watch(src, { recursive: true }, (_ev, name) => {
    const f = name ? String(name) : "";
    // the page reloads itself without a restart; only server code needs one
    if (!/\.ts$/.test(f) || f.endsWith(".d.ts")) return;
    let mtime = 0;
    try {
      mtime = fs.statSync(path.join(src, f)).mtimeMs;
    } catch {}
    if (seen.get(f) === mtime || mtime < startedAt) return;
    seen.set(f, mtime);
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void restart(f), 150);
  });
  // the changelog is bundled into the server (What's new, Settings → Updates), but lives next to src/
  const changelog = path.join(path.dirname(src), "CHANGELOG.md");
  let changelogTime = 0;
  try {
    changelogTime = fs.statSync(changelog).mtimeMs;
  } catch {}
  const notesWatcher = fs.watch(path.dirname(src), (_ev, name) => {
    if (String(name ?? "") !== "CHANGELOG.md") return;
    let mtime = 0;
    try {
      mtime = fs.statSync(changelog).mtimeMs;
    } catch {}
    if (mtime === changelogTime) return;
    changelogTime = mtime;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void restart("CHANGELOG.md"), 150);
  });

  start();
  await new Promise<void>((resolve) => {
    const stop = async () => {
      if (stopping) return;
      stopping = true;
      watcher.close();
      notesWatcher.close();
      const c = child;
      c?.kill("SIGTERM");
      await c?.exited;
      fs.rmSync(portFile, { force: true });
      resolve();
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  });
}
