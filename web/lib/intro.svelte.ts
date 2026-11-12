// Relay's introduction: shown once, the first time the web app opens, and again from Settings → About.

const KEY = "ferry-intro";

class Intro {
  /**
   * The first visit: nothing seen yet, not the introduction and not a release (checked when this
   * module loads, before the release check marks one seen). `?intro` in the address shows it too.
   */
  open = $state(
    new URLSearchParams(location.search).has("intro") ||
      (localStorage.getItem(KEY) == null && localStorage.getItem("ferry-seen-release") == null),
  );

  show(): void {
    this.open = true;
  }

  close(): void {
    this.open = false;
    localStorage.setItem(KEY, "seen");
  }
}

export const intro = new Intro();
