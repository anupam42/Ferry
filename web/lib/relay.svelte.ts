// Relay on the rail reacting for a moment: a quick change of face, and
// sometimes a jump (plus a ring bursting out behind, when you click it).
// Anything can ask: the rail (hover, click) and Ferry's live events.
import type { FerryEvent } from "./events.ts";

class Relay {
  /** the face shown while reacting; "" means the rail's usual one */
  mood = $state("");
  /** bumped to play the jump once */
  jump = $state(0);
  /** bumped to burst the ring once */
  burst = $state(0);
  private timer: ReturnType<typeof setTimeout> | null = null;

  react(mood: string, ms = 1200, o: { jump?: boolean; burst?: boolean } = {}): void {
    this.mood = mood;
    if (o.jump) this.jump++;
    if (o.burst) this.burst++;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.mood = "";
      this.timer = null;
    }, ms);
  }

  /** A live event from Ferry: the ones worth a reaction get one. */
  onEvent(ev: FerryEvent): void {
    switch (ev.kind) {
      case "commit":
        return this.react("party", 1600, { jump: true });
      case "conflict":
        return this.react("worried", 2000, { jump: true });
      case "error":
        return this.react("sad", 2000, { jump: true });
      case "resolved":
        return this.react("happy", 1400, { jump: true });
      // routine: a wink, but never over a stronger reaction still showing
      case "synced":
        if (!this.mood) this.react("wink", 1000);
        return;
    }
  }
}

export const relay = new Relay();
