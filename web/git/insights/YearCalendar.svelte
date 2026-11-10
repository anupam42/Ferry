<script lang="ts">
  import { plural } from "../../lib/format.ts";
  import { git } from "../../lib/git.svelte.ts";
  import { dayName, heatScale, yearCalendar } from "../../lib/insights.ts";
  import type { InsightsResponse } from "../../lib/types.ts";
  import HeatLegend from "./HeatLegend.svelte";
  import HeatWrap from "./HeatWrap.svelte";

  /** A year of days, Monday on top; arrow keys move, Enter (or a click) lists that day's commits. */
  let { d, branch, mine, start }: { d: InsightsResponse; branch: string; mine: boolean; start: string } = $props();
  const scale = $derived(heatScale(Object.values(d.days)));
  const cal = $derived(yearCalendar(d, scale));
  const real = $derived(cal.cells.filter((c) => !c.future));
  const index = $derived(new Map(real.map((c, i) => [c.day, i])));
  let chosen = $state<string | null>(null);
  const picked = $derived(chosen ?? start);
  let at = $state(-1); // the focusable cell, index into real
  const focusAt = $derived(at < 0 ? real.length - 1 : at);
  let grid: HTMLDivElement;

  function move(e: KeyboardEvent) {
    const step = ({ ArrowDown: 1, ArrowUp: -1, ArrowRight: 7, ArrowLeft: -7, Home: -9999, End: 9999 } as Record<string, number>)[e.key];
    if (step) {
      e.preventDefault();
      at = Math.max(0, Math.min(real.length - 1, focusAt + step));
      (grid.querySelector(`[data-i="${at}"]`) as HTMLElement | null)?.focus();
    }
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); chosen = real[focusAt]!.day; }
  }
  const list = $derived(d.dayCommits[picked] ?? []);
  const n = $derived(d.days[picked] || 0);
  const long = (day: string) => dayName(day, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
</script>

<HeatWrap>
  <div class="cal">
    <span></span>
    <div class="months" aria-hidden="true">{#each cal.months as m (m.week)}<span style:grid-column="{m.week + 1} / span 3">{m.label}</span>{/each}</div>
    <div class="days" aria-hidden="true">{#each ["Mon", "", "Wed", "", "Fri", "", ""] as t, i (i)}<span>{t}</span>{/each}</div>
    <div class="grid" role="grid" tabindex="-1" bind:this={grid} aria-label="Commits per day for the last year. Use the arrow keys to move between days and Enter to list a day's commits." onkeydown={move}>
      {#each cal.cells as c (c.day)}
        {#if c.future}<span class="heat future" style:grid-column={c.week + 1} style:grid-row={c.row + 1}></span>
        {:else}
          {@const i = index.get(c.day) ?? -1}
          <!-- svelte-ignore a11y_click_events_have_key_events (the grid handles the keys: arrows move, Enter picks) -->
          <span class="heat l{c.level}" class:today={c.day === d.today} class:on={c.day === picked} role="gridcell" tabindex={i === focusAt ? 0 : -1} data-i={i}
            style:grid-column={c.week + 1} style:grid-row={c.row + 1}
            aria-label="{dayName(c.day, { weekday: 'long', day: 'numeric', month: 'long' })}: {c.n ? plural(c.n, 'commit') : 'no commits'}"
            data-tip="{c.n ? plural(c.n, 'commit') : 'No commits'}\n{long(c.day)}"
            onclick={() => { at = i; chosen = c.day; }}></span>
        {/if}
      {/each}
    </div>
  </div>
  {#snippet foot()}
    <span>On {branch || "this branch"}, merges left out. Click a day to see its commits.</span>
    <HeatLegend {scale} />
  {/snippet}
</HeatWrap>
<div class="day-list" aria-live="polite">
  <div class="head"><b>{long(picked)}</b><span class="muted">{n ? plural(n, "commit") : "no commits"}</span></div>
  {#each list as c (c.hash)}
    <button type="button" class="commit" onclick={() => (git.commit = c.hash)}><span class="mono">{c.short}</span><span class="grow">{c.subject}</span>{#if !mine}<small>{c.author}</small>{/if}</button>
  {/each}
  {#if n > list.length}<div class="more muted">and {n - list.length} more; see History for all of them.</div>{/if}
</div>

<style lang="scss">
  @use "tokens" as *;
  .cal { display: grid; grid-template-columns: 30px minmax(0, 1fr); row-gap: space(1); }
  .months { white-space: nowrap; display: grid; grid-template-columns: repeat(53, minmax(0, 1fr)); gap: 3px; font-size: 11px; color: var(--muted); }
  .days { display: grid; grid-template-rows: repeat(7, 1fr); gap: 3px; font-size: 10.5px; color: var(--muted); span { display: flex; align-items: center; } }
  .grid { display: grid; grid-template-columns: repeat(53, minmax(0, 1fr)); grid-template-rows: repeat(7, auto); gap: 3px; outline: none;
    .heat { aspect-ratio: 1; cursor: pointer;
      &:hover, &:focus-visible { outline: 2px solid var(--text); outline-offset: 1px; }
      &.on { outline: 2px solid var(--accent); outline-offset: 1px; }
      &.today { box-shadow: inset 0 0 0 1.5px var(--accent); } } }
  .day-list { margin: space(1) space(4) space(3) + 2; padding: space(2) + 2; border-radius: $radius-lg; background: var(--card2); }
  .head { display: flex; justify-content: space-between; gap: space(2) + 2; padding: 2px space(2) + 2 space(2); font-size: 13.5px; }
  .commit { display: flex; gap: space(3); align-items: baseline; width: 100%; padding: space(1) + 3 space(2) + 2; border: 0; border-radius: $radius-sm + 2; background: none; color: var(--text); text-align: left; cursor: pointer; font-size: 13.5px;
    &:hover, &:focus-visible { background: var(--card-solid); } .mono { color: var(--accent); font-size: 12px; } .grow { flex: 1; } small { color: var(--muted); } }
  .more { font-size: 12.5px; padding: space(1) + 2 space(2) + 2; }
</style>
