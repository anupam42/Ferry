// The Todo tab's arithmetic: dates, and what Relay reminds you about (plain TypeScript, so it's unit-testable).
import { splitTodo, type TodoItem } from "../../src/shared/todo.ts";

const DAY = 86_400_000;

/** Today, as YYYY-MM-DD in local time. */
export function today(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** Whole days from `from` to `to` (both YYYY-MM-DD): negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to + "T12:00:00") - Date.parse(from + "T12:00:00")) / DAY);
}

/** "3 days", "2 weeks", "4 months": how long since `ms`. */
export function waited(ms: number, now = Date.now()): string {
  const d = Math.max(0, Math.floor((now - ms) / DAY));
  if (d < 1) return "today";
  if (d < 14) return d === 1 ? "a day" : `${d} days`;
  if (d < 60) return `${Math.round(d / 7)} weeks`;
  if (d < 730) return `${Math.round(d / 30)} months`;
  return `${Math.round(d / 365)} years`;
}

/** When an open item is due, in words, and how urgent that is. */
export function dueLabel(due: string, now = today()): { text: string; tone: "red" | "amber" | "" } {
  const n = daysBetween(now, due);
  if (n < 0) return { text: n === -1 ? "a day late" : `${-n} days late`, tone: "red" };
  if (n === 0) return { text: "due today", tone: "amber" };
  if (n === 1) return { text: "due tomorrow", tone: "amber" };
  if (n < 7) {
    const day = new Date(due + "T12:00:00").toLocaleDateString(undefined, { weekday: "long" });
    return { text: `due ${day}`, tone: "amber" };
  }
  const date = new Date(due + "T12:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return { text: `due ${date}`, tone: "" };
}

/** Open for a long time without a date: Relay nudges about these. */
export const STALE_DAYS = 30;
/** Added this recently: marked as new. */
export const NEW_DAYS = 7;

export const isOverdue = (it: TodoItem, now = today()) => !it.done && !!it.due && daysBetween(now, it.due) < 0;
export const isSoon = (it: TodoItem, now = today()) =>
  !it.done && !!it.due && daysBetween(now, it.due) >= 0 && daysBetween(now, it.due) < 7;
export const isStale = (it: TodoItem, ms = Date.now()) =>
  !it.done && !it.due && it.since !== null && ms - it.since > STALE_DAYS * DAY;
export const isNew = (it: TodoItem, ms = Date.now()) => !it.done && it.since !== null && ms - it.since < NEW_DAYS * DAY;

export interface Reminder {
  face: string;
  say: string;
  hint: string;
}

const title = (it: TodoItem) => splitTodo(it.text).title.replace(/[*`_]/g, "");
const quote = (it: TodoItem) => `“${title(it)}”`;

/** What Relay says about a list: late items first, then ones due soon, then ones waiting a long time. */
export function reminder(items: TodoItem[], nowDay = today(), nowMs = Date.now()): Reminder {
  if (!items.length)
    return {
      face: "thinking",
      say: "No todo list here yet.",
      hint: "Add “- [ ] something” lines to the README (under a “## Todo” heading, say), and I'll keep track of them for you.",
    };
  const open = items.filter((i) => !i.done);
  if (!open.length)
    return {
      face: "party",
      say: "Everything's done!",
      hint: `All ${items.length} items are ticked off. Time for a new list?`,
    };
  const late = open.filter((i) => isOverdue(i, nowDay)).sort((a, b) => a.due!.localeCompare(b.due!));
  if (late.length) {
    const first = late[0]!;
    return {
      face: "worried",
      say:
        late.length === 1
          ? `${quote(first)} is ${dueLabel(first.due!, nowDay).text}.`
          : `${late.length} items are past their date.`,
      hint:
        late.length === 1
          ? "Finish it, or give it a new date if the plan changed."
          : `The oldest is ${quote(first)}, ${dueLabel(first.due!, nowDay).text}. Finish them or move their dates.`,
    };
  }
  const soon = open.filter((i) => isSoon(i, nowDay)).sort((a, b) => a.due!.localeCompare(b.due!));
  if (soon.length) {
    const first = soon[0]!;
    return {
      face: "focused",
      say: `${quote(first)} is ${dueLabel(first.due!, nowDay).text}.`,
      hint:
        soon.length > 1
          ? `${soon.length - 1} more ${soon.length === 2 ? "is" : "are"} due this week too.`
          : `${open.length} open in all.`,
    };
  }
  const stale = open.filter((i) => isStale(i, nowMs)).sort((a, b) => a.since! - b.since!);
  if (stale.length) {
    const first = stale[0]!;
    return {
      face: "sleepy",
      say: `${quote(first)} has been waiting ${waited(first.since!, nowMs)}.`,
      hint:
        stale.length > 1
          ? `${stale.length} items have been open over a month. Give the important ones a date, and I'll remind you.`
          : "Give it a date and I'll remind you, or tick it off if it's done.",
    };
  }
  const fresh = open.filter((i) => isNew(i, nowMs)).length;
  return {
    face: "happy",
    say: `${open.length} open, ${items.length - open.length} done.`,
    hint: fresh
      ? `${fresh} added this week. Nothing's late.`
      : "Nothing's late. Give an item a date and I'll remind you as it gets close.",
  };
}
