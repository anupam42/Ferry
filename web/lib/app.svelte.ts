// The app's shared state, plus toasts and Relay's questions.
import { api } from "./api.ts";
import type { Connections, Info, Mode, Settings } from "./types.ts";

const startMode = (): Mode => {
  const pick = localStorage.getItem("ferry-start") || localStorage.getItem("ferry-mode");
  return pick === "git" || pick === "settings" ? pick : "sync";
};

class App {
  info = $state<Info | null>(null);
  /** false when the Ferry process doesn't answer */
  online = $state(true);
  mode = $state<Mode>(startMode());
  settings = $state<Settings | null>(null);
  settingsError = $state("");
  conns = $state<Connections | null>(null);
  section = $state(localStorage.getItem("ferry-settings-sec") || "appearance");
  connectionsOpen = $state(false);

  go(mode: Mode): void {
    this.mode = mode;
    if (mode !== "settings") localStorage.setItem("ferry-mode", mode);
  }

  async loadSettings(): Promise<void> {
    try {
      this.settings = await api<Settings>("GET", "/settings");
      this.settingsError = "";
    } catch (e) {
      this.settingsError = (e as Error).message;
    }
  }

  async loadConnections(): Promise<void> {
    this.conns = await api<Connections>("GET", "/connections").catch(() => this.conns);
  }
}

export const app = new App();

// ---------- toasts ----------

export interface Toast { id: number; text: string; error: boolean; mood: string }
let nextToast = 1;
export const toasts = $state<Toast[]>([]);

export function toast(text: string, o: { error?: boolean; mood?: string } = {}): void {
  const t: Toast = { id: nextToast++, text, error: !!o.error, mood: o.mood || (o.error ? "sad" : "happy") };
  toasts.push(t);
  setTimeout(() => {
    const i = toasts.findIndex((x) => x.id === t.id);
    if (i >= 0) toasts.splice(i, 1);
  }, o.error ? 7000 : 3800);
}

/** Runs an action; on failure shows Relay's toast and returns null. */
export async function act<T>(done: string | null, run: () => Promise<T>, mood = "happy"): Promise<T | null> {
  try {
    const r = await run();
    if (done) toast(done, { mood });
    return r;
  } catch (e) {
    toast((e as Error).message, { error: true });
    return null;
  }
}

// ---------- Relay asks ----------

export interface AskOptions {
  title: string;
  text?: string;
  mood?: string;
  yes?: string;
  no?: string;
  yesMood?: string;
  noMood?: string;
  /** the safe "no" is highlighted unless the ask builds something ("yes") */
  primary?: "yes" | "no";
  /** the risky "yes" has to be pressed and held for a second */
  hold?: boolean;
  /** things found (the push check), listed under the text */
  items?: { label: string; where: string; text: string; level: "block" | "warn" }[];
  /** more items than listed */
  more?: number;
}
export interface AskField { name: string; label: string; value?: string | boolean; placeholder?: string; hint?: string; type?: "text" | "check" }

type Pending = AskOptions & { fields?: AskField[]; resolve: (v: boolean, values?: Record<string, string | boolean>) => void };
export const asking = $state<{ current: Pending | null }>({ current: null });

export function ask(o: AskOptions): Promise<boolean> {
  asking.current?.resolve(false);
  return new Promise((resolve) => {
    asking.current = { ...o, resolve: (v) => { asking.current = null; resolve(v); } };
  });
}

/** Relay asks with a few fields to fill in; resolves to their values, or null for "no". */
export function askFields(o: AskOptions & { fields: AskField[] }): Promise<Record<string, string | boolean> | null> {
  asking.current?.resolve(false);
  return new Promise((resolve) => {
    asking.current = { ...o, resolve: (v, values) => { asking.current = null; resolve(v ? values ?? {} : null); } };
  });
}
