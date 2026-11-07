// Dashboard colors: auto (follow the terminal), dark, light or mono.
import { setDarkBackground, Style, type Adaptive } from "./term.ts";

export const THEMES = ["auto", "dark", "light", "mono"] as const;

export interface Theme {
  name: string;
  accent: Adaptive | null;
  mutedColor: Adaptive | null;
  green: Adaptive | null;
  yellow: Adaptive | null;
  red: Adaptive | null;
  cyan: Adaptive | null;
  purple: Adaptive | null;
  title: Style;
  muted: Style;
  bold: Style;
  sel: Style;
  flash: Style;
  border: Style;
  borderActive: Style;
}

const ad = (light: string, dark: string): Adaptive => ({ light, dark });

let autoDark = true;
let current: Theme = build("auto");

/** Records what the terminal's background turned out to be (for "auto"). */
export function setAutoDark(d: boolean): void {
  autoDark = d;
  if (current.name === "auto") setDarkBackground(d);
}

function build(name: string): Theme {
  if (!["dark", "light", "mono"].includes(name)) name = "auto";
  const mono = name === "mono";
  const c = (l: string, d: string) => (mono ? null : ad(l, d));
  setDarkBackground(name === "dark" ? true : name === "light" ? false : autoDark);
  const t = {
    name,
    accent: c("#5A4FCF", "#9D8CFF"),
    mutedColor: c("#777777", "#8A8A8A"),
    green: c("#18794E", "#4ADE80"),
    yellow: c("#A15C00", "#FACC15"),
    red: c("#C62828", "#F87171"),
    cyan: c("#00708A", "#67E8F9"),
    purple: c("#8E24AA", "#E879F9"),
  };
  return {
    ...t,
    title: new Style({ bold: true, fg: t.accent }),
    muted: new Style({ fg: t.mutedColor, faint: mono }),
    bold: new Style({ bold: true }),
    sel: new Style({ bold: true, reverse: true }),
    flash: new Style({ fg: t.yellow, bold: true }),
    border: new Style({ fg: t.mutedColor }),
    borderActive: new Style({ fg: t.accent }),
  };
}

export function theme(): Theme {
  return current;
}

export function setTheme(name: string): void {
  current = build(name);
}

export function nextTheme(): string {
  const i = THEMES.indexOf(current.name as (typeof THEMES)[number]);
  return THEMES[(i + 1) % THEMES.length]!;
}
