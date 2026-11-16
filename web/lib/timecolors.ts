// A colour per project for the Time tab's charts. The colour follows the project, never its rank:
// each project keeps the slot it was first given (remembered in this browser), so a new project or
// another date range never repaints the others. Eight slots, in the validated order (see the
// --series-N variables in Time.svelte); past eight, projects share "Other" grey.

const KEY = "ferry-time-colors";
export const SLOTS = 8;

function load(): Record<string, number> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "{}") as Record<string, number>;
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

let slots = load();

/** The project's slot (1-8), giving it the first free one if it has none; 0 when all are taken. */
export function slotOf(project: string): number {
  if (slots[project]) return slots[project]!;
  const used = new Set(Object.values(slots));
  for (let i = 1; i <= SLOTS; i++)
    if (!used.has(i)) {
      slots = { ...slots, [project]: i };
      localStorage.setItem(KEY, JSON.stringify(slots));
      return i;
    }
  return 0;
}

/** The CSS colour for a project. */
export const colorOf = (project: string) => {
  const s = slotOf(project);
  return s ? `var(--series-${s})` : "var(--series-other)";
};

/** Gives slots to projects in this order (busiest first, say) before any are drawn. */
export function assign(projects: string[]): void {
  for (const p of projects) slotOf(p);
}
