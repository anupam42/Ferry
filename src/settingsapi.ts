// Settings the web app's Settings page reads and changes on this computer:
//
//   GET  /settings      your git identity and defaults, AI and where Ferry keeps its files
//   POST /settings/git  {"name", "email", "default_branch", "pull", "sign"}: git config --global
//
// Everything else on the page (theme, accent, notifications…) lives in the browser.
import { dataDir } from "./config.ts";
import { exec } from "./proc.ts";
import type { GitSettings, SettingsResponse } from "./shared/settings.ts";

const env = () => ({ ...process.env, LC_ALL: "C", GIT_TERMINAL_PROMPT: "0" });

async function getGlobal(key: string): Promise<string> {
  const r = await exec(["git", "config", "--global", "--get", key], { env: env() });
  return r.code === 0 ? r.stdout.trim() : "";
}

async function setGlobal(key: string, value: string | null): Promise<void> {
  const r =
    value === null
      ? await exec(["git", "config", "--global", "--unset", key], { env: env() })
      : await exec(["git", "config", "--global", key, value], { env: env() });
  // exit 5 from --unset means it wasn't set: that's fine
  if (r.code !== 0 && !(value === null && r.code === 5))
    throw new SettingsError(`couldn't save ${key}: ${(r.stderr || r.error || "").trim()}`);
}

export class SettingsError extends Error {}

export type { GitSettings } from "./shared/settings.ts";

export async function readSettings(configFile: string): Promise<SettingsResponse> {
  const [name, email, branch, rebase, sign] = await Promise.all(
    ["user.name", "user.email", "init.defaultBranch", "pull.rebase", "commit.gpgsign"].map(getGlobal),
  );
  return {
    git: {
      name: name!,
      email: email!,
      default_branch: branch!,
      pull: rebase === "true" ? "rebase" : rebase === "false" ? "merge" : "",
      sign: sign === "true",
    },
    ai: { configured: !!process.env.ANTHROPIC_API_KEY },
    data_dir: dataDir(),
    config_file: configFile,
  };
}

const oneLine = (v: unknown, what: string, max = 200): string => {
  if (typeof v !== "string") throw new SettingsError(`${what} must be text`);
  const s = v.trim();
  if (/[\r\n\0]/.test(s) || s.length > max) throw new SettingsError(`${what} must be one short line`);
  return s;
};

/** Saves the fields present in body; leaves the rest alone. */
export async function saveGit(body: Record<string, unknown>): Promise<GitSettings> {
  if ("name" in body) {
    const name = oneLine(body.name, "your name");
    if (!name) throw new SettingsError("your name can't be empty: git puts it on every commit");
    await setGlobal("user.name", name);
  }
  if ("email" in body) {
    const email = oneLine(body.email, "your email");
    if (!/^[^\s@]+@[^\s@]+$/.test(email)) throw new SettingsError("that doesn't look like an email address");
    await setGlobal("user.email", email);
  }
  if ("default_branch" in body) {
    const b = oneLine(body.default_branch, "the default branch", 100);
    if (b) {
      const ok = await exec(["git", "check-ref-format", "--branch", b], { env: env() });
      if (ok.code !== 0 || b.startsWith("-")) throw new SettingsError(`"${b}" can't be a branch name`);
    }
    await setGlobal("init.defaultBranch", b || null);
  }
  if ("pull" in body) {
    if (!["merge", "rebase", ""].includes(String(body.pull))) throw new SettingsError("pull must be merge or rebase");
    await setGlobal("pull.rebase", body.pull === "rebase" ? "true" : body.pull === "merge" ? "false" : null);
  }
  if ("sign" in body) await setGlobal("commit.gpgsign", body.sign === true ? "true" : null);
  return (await readSettings("")).git;
}
