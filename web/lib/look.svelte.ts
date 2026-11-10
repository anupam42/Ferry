// How Ferry looks: theme, accent, background, size, motion and the sidebar.
// Saved in the same places as the current page (ferry-theme, ferry-look), so
// both pages share one set of choices. index.html applies them before the first
// paint; this keeps them applied, and in step with the system theme.

export type ThemeChoice = "light" | "dark" | "system";
export type LookKey = "accent" | "bg" | "size" | "motion" | "rail" | "railpos" | "dock";

const LOOK_KEYS: LookKey[] = ["accent", "bg", "size", "motion", "rail", "railpos", "dock"];
const dark = matchMedia("(prefers-color-scheme: dark)");

function readLook(): Partial<Record<LookKey, string>> {
  try {
    return JSON.parse(localStorage.getItem("ferry-look") || "{}");
  } catch {
    return {};
  }
}

class Look {
  theme = $state<ThemeChoice>((localStorage.getItem("ferry-theme") as ThemeChoice) || "system");
  values = $state<Partial<Record<LookKey, string>>>(readLook());
  /** what's showing now (System resolves to one of these) */
  shown = $state<"light" | "dark">("light");

  constructor() {
    this.apply();
    dark.addEventListener("change", () => this.apply());
    // another tab (or the current page) changed something
    addEventListener("storage", (e) => {
      if (e.key === "ferry-look") this.values = readLook();
      if (e.key === "ferry-theme") this.theme = (e.newValue as ThemeChoice) || "system";
      this.apply();
    });
  }

  setTheme(choice: ThemeChoice): void {
    this.theme = choice;
    localStorage.setItem("ferry-theme", choice);
    this.apply();
  }

  get(k: LookKey): string {
    return this.values[k] ?? "";
  }

  set(k: LookKey, v: string): void {
    const next = { ...readLook(), ...this.values };
    if (v) next[k] = v;
    else delete next[k];
    this.values = next;
    localStorage.setItem("ferry-look", JSON.stringify(next));
    this.apply();
  }

  private apply(): void {
    const root = document.documentElement;
    this.shown = this.theme === "dark" || (this.theme === "system" && dark.matches) ? "dark" : "light";
    root.dataset.theme = this.shown;
    for (const k of LOOK_KEYS) {
      const v = this.values[k];
      if (v) root.dataset[k] = v;
      else delete root.dataset[k];
    }
  }
}

export const look = new Look();

export { ago, plural } from "./format.ts";

/** A transition's duration, or 0 when motion is reduced (by the system, or Settings → Motion). */
export function ms(duration: number): number {
  return document.documentElement.dataset.motion === "reduce" || matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : duration;
}
