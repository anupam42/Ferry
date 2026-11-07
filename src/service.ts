// Installs ferry as a per-user background service: systemd --user on Linux,
// a LaunchAgent on macOS, and a Task Scheduler logon task on Windows. No admin
// rights needed on any platform.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { dataDir, loadFile } from "./config.ts";
import { exec, processAlive, selfCommand } from "./proc.ts";

const UNIT = "ferry";
const LAUNCH_ID = "com.anupam42.ferry";
const TASK = "ferry";

/** Where the service writes its log on every platform. */
export const logPath = () => path.join(dataDir(), "service.log");
/** Used to stop the Windows background process. */
export const pidPath = () => path.join(dataDir(), "service.pid");

async function runCmd(...cmd: string[]): Promise<string> {
  const r = await exec(cmd);
  if (r.code !== 0) throw new Error(`${cmd.join(" ")}: ${r.error}\n${r.output.trim()}`);
  return r.output;
}

function runArgs(cfg: string): string[] {
  return [...selfCommand(), "run", "--config", cfg, "--ui", "plain", "--no-color", "--log", logPath(), "--pidfile", pidPath()];
}

const userConfigDir = () => process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
const unitFile = () => path.join(userConfigDir(), "systemd", "user", UNIT + ".service");
const plistFile = () => path.join(os.homedir(), "Library", "LaunchAgents", LAUNCH_ID + ".plist");
const vbsFile = () => path.join(dataDir(), "ferry-service.vbs");

/** Registers and starts the service for config file cfg. Returns where it was installed. */
export async function install(cfg: string): Promise<string> {
  cfg = path.resolve(cfg);
  try {
    loadFile(cfg);
  } catch (e) {
    throw new Error(`config check failed: ${(e as Error).message}`);
  }
  fs.mkdirSync(dataDir(), { recursive: true });
  const args = runArgs(cfg);
  switch (process.platform) {
    case "linux": {
      const p = unitFile();
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, `[Unit]
Description=ferry - mirror folders into git repos
After=default.target

[Service]
Type=simple
ExecStart=${systemdQuote(args)}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
`);
      await runCmd("systemctl", "--user", "daemon-reload");
      await runCmd("systemctl", "--user", "enable", "--now", UNIT);
      return p;
    }
    case "darwin": {
      const p = plistFile();
      fs.mkdirSync(path.dirname(p), { recursive: true });
      const argXML = args.map((a) => `    <string>${xmlEscape(a)}</string>\n`).join("");
      fs.writeFileSync(p, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LAUNCH_ID}</string>
  <key>ProgramArguments</key>
  <array>
${argXML}  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>StandardOutPath</key><string>${xmlEscape(logPath() + ".stdout")}</string>
  <key>StandardErrorPath</key><string>${xmlEscape(logPath() + ".stderr")}</string>
</dict>
</plist>
`);
      await exec(["launchctl", "unload", p]);
      await runCmd("launchctl", "load", "-w", p);
      return p;
    }
    case "win32": {
      // a tiny VBScript launcher runs ferry without a console window
      const vbs = vbsFile();
      const q = args.map((a) => `""${a}""`).join(" ");
      fs.writeFileSync(vbs, `CreateObject("WScript.Shell").Run "${q}", 0, False\r\n`);
      await runCmd("schtasks", "/Create", "/TN", TASK, "/TR", `wscript.exe "${vbs}"`, "/SC", "ONLOGON", "/RL", "LIMITED", "/F");
      await runCmd("schtasks", "/Run", "/TN", TASK);
      return vbs;
    }
  }
  throw new Error("background service not supported on " + process.platform);
}

/** Stops and removes the service. */
export async function uninstall(): Promise<void> {
  await stop().catch(() => {});
  switch (process.platform) {
    case "linux":
      await exec(["systemctl", "--user", "disable", UNIT]);
      fs.rmSync(unitFile(), { force: true });
      await runCmd("systemctl", "--user", "daemon-reload");
      return;
    case "darwin":
      await exec(["launchctl", "unload", "-w", plistFile()]);
      fs.rmSync(plistFile());
      return;
    case "win32":
      try {
        await runCmd("schtasks", "/Delete", "/TN", TASK, "/F");
      } finally {
        fs.rmSync(vbsFile(), { force: true });
      }
      return;
  }
  throw new Error("unsupported OS");
}

export async function start(): Promise<void> {
  switch (process.platform) {
    case "linux":
      await runCmd("systemctl", "--user", "start", UNIT);
      return;
    case "darwin":
      await runCmd("launchctl", "start", LAUNCH_ID);
      return;
    case "win32":
      await runCmd("schtasks", "/Run", "/TN", TASK);
      return;
  }
  throw new Error("unsupported OS");
}

export async function stop(): Promise<void> {
  switch (process.platform) {
    case "linux":
      await runCmd("systemctl", "--user", "stop", UNIT);
      return;
    case "darwin":
      await runCmd("launchctl", "stop", LAUNCH_ID);
      return;
    case "win32": {
      const pid = readPID();
      if (!pid) throw new Error("service is not running");
      try {
        await runCmd("taskkill", "/PID", String(pid), "/T", "/F");
      } finally {
        fs.rmSync(pidPath(), { force: true });
      }
      return;
    }
  }
  throw new Error("unsupported OS");
}

/** Whether the background service is registered. */
export async function isInstalled(): Promise<boolean> {
  switch (process.platform) {
    case "linux":
      return fs.existsSync(unitFile());
    case "darwin":
      return fs.existsSync(plistFile());
    case "win32":
      return (await exec(["schtasks", "/Query", "/TN", TASK])).code === 0;
  }
  return false;
}

/** A human-readable status. */
export async function status(): Promise<string> {
  switch (process.platform) {
    case "linux":
      return (await exec(["systemctl", "--user", "status", "--no-pager", "--lines=0", UNIT])).output.trim();
    case "darwin": {
      const r = await exec(["launchctl", "list", LAUNCH_ID]);
      return r.code === 0 ? r.output.trim() : "not installed or not running";
    }
    case "win32": {
      const out = (await exec(["schtasks", "/Query", "/TN", TASK, "/FO", "LIST"])).output.trim();
      const pid = readPID();
      const state = pid && processAlive(pid) ? `process: running (pid ${pid})` : "process: not running";
      return out + "\n" + state;
    }
  }
  return "unsupported OS";
}

/** The last n lines of the service log. */
export function logs(n: number): string[] {
  let text: string;
  try {
    text = fs.readFileSync(logPath(), "utf8");
  } catch {
    throw new Error(`no log yet at ${logPath()}`);
  }
  const lines = text.split(/\r?\n/);
  if (lines[lines.length - 1] === "") lines.pop();
  return lines.slice(-n);
}

function readPID(): number {
  try {
    return parseInt(fs.readFileSync(pidPath(), "utf8").trim(), 10) || 0;
  } catch {
    return 0;
  }
}

function systemdQuote(args: string[]): string {
  return args
    .map((a) => (/[ \t"'\\]/.test(a) ? `"${a.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"` : a))
    .join(" ");
}

function xmlEscape(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
