// Shapes the server sends and the web app reads, with no imports of their own,
// so both sides (Bun and the browser) can use them.

/** Settings → Git: your global git config. */
export interface GitSettings {
  name: string;
  email: string;
  default_branch: string;
  /** "merge" | "rebase" | "" (git's default) */
  pull: string;
  sign: boolean;
}

/** GET /settings */
export interface SettingsResponse {
  git: GitSettings;
  ai: { configured: boolean };
  data_dir: string;
  config_file: string;
}
