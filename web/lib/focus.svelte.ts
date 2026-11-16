// A focus session holds the web app's pop-ups: toasts about pairs and desktop notifications wait
// (they're still listed under Notifications) and are summed up when it ends. The server holds its
// own desktop notifications the same way (see notify.ts).
import { toast } from "./app.svelte.ts";

class Focus {
  /** holding until then (ms); 0 when not */
  until = $state(0);
  /** pop-ups that waited */
  held = $state(0);
  private timer: ReturnType<typeof setTimeout> | null = null;

  get on(): boolean {
    return this.until > Date.now();
  }

  hold(until: number): void {
    if (until === this.until) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.until = until;
    if (until > Date.now()) this.timer = setTimeout(() => this.release(), until - Date.now());
    else this.release();
  }

  /** Counts a pop-up that would have shown; true when it should be held. */
  swallow(): boolean {
    if (!this.on) return false;
    this.held++;
    return true;
  }

  private release(): void {
    this.until = 0;
    if (this.held)
      toast(`${this.held} ${this.held === 1 ? "notification waited" : "notifications waited"} while you focused`, {
        mood: "wink",
      });
    this.held = 0;
  }
}

export const focus = new Focus();
