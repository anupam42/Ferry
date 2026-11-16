// The Time tab: syncs, commits, meetings and the timer from the server, turned into blocks and days.
import { api } from "./api.ts";
import { toast } from "./app.svelte.ts";
import { focus } from "./focus.svelte.ts";
import {
  blocks,
  focusState,
  idleSince,
  suggestTimer,
  workDays,
  type Block,
  type TimerState,
  type WorkDay,
  type WorkResponse,
} from "../../src/shared/work.ts";

export type TimerAction =
  | "start"
  | "stop"
  | "edit"
  | "add"
  | "split"
  | "merge"
  | "delete"
  | "billable"
  | "goals"
  | "rate"
  | "calendar"
  | "jira";

class Work {
  /** undefined until read */
  data = $state<WorkResponse | undefined>(undefined);
  error = $state("");
  /** how far back data reaches, in days */
  span = $state(0);
  loading = $state(false);
  /** ticks every second while the Time tab is open, so a running timer counts up */
  now = $state(Date.now());
  busy = $state(false);

  timer = $derived<TimerState | null>(this.data?.timer ?? null);
  meetings = $derived(this.data?.meetings ?? []);
  // recomputed once a minute (not every tick), unless the data changes
  minute = $derived(Math.floor(this.now / 60_000));
  blocks = $derived.by<Block[]>(() =>
    this.data ? blocks(this.data.events, this.data.timer, this.minute * 60_000) : [],
  );
  days = $derived.by<WorkDay[]>(() =>
    this.data ? workDays(this.data.events, this.data.timer, this.minute * 60_000) : [],
  );
  suggestion = $derived(this.data ? suggestTimer(this.data.events, this.data.timer, this.minute * 60_000) : null);
  idle = $derived(this.data ? idleSince(this.data.events, this.data.timer, this.minute * 60_000) : null);
  focus = $derived(focusState(this.data?.timer ?? null, this.now));
  /** every project seen: repositories with work, timer projects, billable and priced ones */
  projects = $derived.by(() => {
    const t = this.data?.timer;
    const names = [
      ...(this.data?.events ?? []).map((e) => e.repo),
      ...(t?.entries ?? []).map((e) => e.project),
      ...Object.keys(t?.billable ?? {}),
      ...Object.keys(t?.rates ?? {}),
      ...(t?.running ? [t.running.project] : []),
    ];
    return [...new Set(names)].sort((a, b) => a.localeCompare(b));
  });

  /** Reads at least `days` days back (it never shrinks what's there). */
  async load(days = 42, force = false): Promise<void> {
    if (!force && this.data && this.span >= days) return;
    this.loading = true;
    try {
      const want = Math.max(days, this.span);
      this.data = await api<WorkResponse>("GET", `/git/work?days=${want}`);
      this.span = want;
      this.error = "";
      this.syncFocus();
    } catch (e) {
      this.error = (e as Error).message;
    } finally {
      this.loading = false;
    }
  }

  /** A timer action; the new timer state replaces the old one. */
  async act(action: TimerAction, body: Record<string, unknown> = {}): Promise<boolean> {
    this.busy = true;
    try {
      const r = await api<{ timer: TimerState }>("POST", `/git/timer/${action}`, body);
      if (this.data) this.data = { ...this.data, timer: r.timer };
      this.now = Date.now();
      this.syncFocus();
      // the calendar's meetings come with the work
      if (action === "calendar") void this.load(this.span || 42, true);
      return true;
    } catch (e) {
      toast((e as Error).message, { error: true });
      return false;
    } finally {
      this.busy = false;
    }
  }

  /** A focus session holds the web app's pop-ups too (see focus.svelte.ts). */
  private syncFocus(): void {
    const r = this.data?.timer.running;
    focus.hold(r?.focus ? r.start + r.focus * 60_000 : 0);
  }
}

export const work = new Work();
