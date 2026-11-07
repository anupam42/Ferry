// Sends files to the OS trash / recycle bin. Callers fall back to a plain
// delete when this fails (ferry's own backup exists either way).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { exec, which } from "../proc.ts";

const pad = (n: number) => String(n).padStart(2, "0");

export async function moveToTrash(p: string): Promise<void> {
  const abs = path.resolve(p);
  const check = (r: { code: number; output: string; error?: string }) => {
    if (r.code !== 0) throw new Error(r.output.trim() || r.error || "trash failed");
  };
  switch (process.platform) {
    case "darwin": {
      const esc = abs.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
      check(await exec(["osascript", "-e", `tell application "Finder" to delete POSIX file "${esc}"`]));
      return;
    }
    case "win32": {
      const ps =
        "Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile('" +
        abs.replaceAll("'", "''") + "', 'OnlyErrorDialogs', 'SendToRecycleBin')";
      check(await exec(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps]));
      return;
    }
    default:
      if (which("gio") && (await exec(["gio", "trash", abs])).code === 0) return;
      freedesktopTrash(abs);
  }
}

/** The XDG trash spec, for the home trash. */
function freedesktopTrash(abs: string): void {
  const dataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
  const trash = path.join(dataHome, "Trash");
  const files = path.join(trash, "files"), info = path.join(trash, "info");
  fs.mkdirSync(files, { recursive: true, mode: 0o700 });
  fs.mkdirSync(info, { recursive: true, mode: 0o700 });
  const base = path.basename(abs);
  let name = base;
  for (let i = 1; fs.existsSync(path.join(files, name)) || fs.existsSync(path.join(info, name + ".trashinfo")); i++) {
    name = `${base}.${i}`;
  }
  const d = new Date();
  const when = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const escaped = abs.split("/").map(encodeURIComponent).join("/");
  const infoPath = path.join(info, name + ".trashinfo");
  fs.writeFileSync(infoPath, `[Trash Info]\nPath=${escaped}\nDeletionDate=${when}\n`, { mode: 0o600 });
  try {
    fs.renameSync(abs, path.join(files, name));
  } catch (e) {
    fs.rmSync(infoPath, { force: true });
    throw e; // e.g. on another filesystem; the caller deletes instead
  }
}
