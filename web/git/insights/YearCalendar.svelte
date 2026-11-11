<script lang="ts">
  import { plural } from "../../lib/format.ts";
  import { git } from "../../lib/git.svelte.ts";
  import {
    busiest,
    commitsIn,
    dayName,
    heatScale,
    monthBuckets,
    weekBuckets,
    yearCalendar,
    type Period,
  } from "../../lib/insights.ts";
  import type { InsightsResponse } from "../../lib/types.ts";
  import HeatLegend from "./HeatLegend.svelte";
  import HeatWrap from "./HeatWrap.svelte";

  /**
   * A year of commits, by day (Monday on top), by week or by month; arrow keys move, Enter (or a
   * click) lists that day's, week's or month's commits below.
   */
  let { d, branch, mine, start }: { d: InsightsResponse; branch: string; mine: boolean; start: string } = $props();
  const scale = $derived(heatScale(Object.values(d.days)));
  const cal = $derived(yearCalendar(d, scale));
  const real = $derived(cal.cells.filter((c) => !c.future));
  const index = $derived(new Map(real.map((c, i) => [c.day, i])));
  let chosen = $state<string | null>(null);
  const picked = $derived(chosen ?? start);
  let at = $state(-1); // the focusable cell, index into real
  const focusAt = $derived(at < 0 ? real.length - 1 : at);
  let grid = $state<HTMLDivElement>();

  function move(e: KeyboardEvent) {
    const step = (
      { ArrowDown: 1, ArrowUp: -1, ArrowRight: 7, ArrowLeft: -7, Home: -9999, End: 9999 } as Record<string, number>
    )[e.key];
    if (step) {
      e.preventDefault();
      at = Math.max(0, Math.min(real.length - 1, focusAt + step));
      (grid?.querySelector(`[data-i="${at}"]`) as HTMLElement | null)?.focus();
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      chosen = real[focusAt]!.day;
    }
  }
  const long = (day: string) => dayName(day, { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  // by week or by month: one row of cells, each with its own colour scale (a week holds more than a day)
  let unit = $state<Period>((localStorage.getItem("ferry-insights-unit") as Period) || "day");
  function setUnit(u: Period) {
    unit = u;
    localStorage.setItem("ferry-insights-unit", u);
    atB = -1;
  }
  const weeks = $derived(weekBuckets(d));
  const months = $derived(monthBuckets(d));
  const buckets = $derived(unit === "week" ? weeks : months);
  const bScale = $derived(heatScale(buckets.map((b) => b.n)));
  const chosenB = $state<Record<"week" | "month", string | null>>({ week: null, month: null });
  const pickedB = $derived(
    unit === "day" ? null : (buckets.find((b) => b.key === chosenB[unit as "week" | "month"]) ?? busiest(buckets)),
  );
  let atB = $state(-1);
  const focusB = $derived(atB < 0 ? buckets.length - 1 : atB);
  let strip = $state<HTMLDivElement>();
  function moveB(e: KeyboardEvent) {
    const step = ({ ArrowRight: 1, ArrowLeft: -1, Home: -9999, End: 9999 } as Record<string, number>)[e.key];
    if (step) {
      e.preventDefault();
      atB = Math.max(0, Math.min(buckets.length - 1, focusB + step));
      (strip?.querySelector(`[data-i="${atB}"]`) as HTMLElement | null)?.focus();
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      chosenB[unit as "week" | "month"] = buckets[focusB]!.key;
    }
  }

  // what the list below shows: the chosen day, week or month
  const shown = $derived(
    unit === "day" || !pickedB
      ? { title: long(picked), ...commitsIn(d, [picked], 8) }
      : { title: pickedB.long, ...commitsIn(d, pickedB.days, 12) },
  );
</script>

<HeatWrap>
  <div class="tools">
    <div class="seg mini" role="radiogroup" aria-label="Show commits per">
      {#each [["day", "Day"], ["week", "Week"], ["month", "Month"]] as const as [u, label] (u)}
        <button role="radio" class:on={unit === u} aria-checked={unit === u} onclick={() => setUnit(u)}>{label}</button>
      {/each}
    </div>
  </div>
  {#if unit !== "day"}
    {@const isWeek = unit === "week"}
    <div
      class="strip"
      class:weeks={isWeek}
      role="grid"
      tabindex="-1"
      bind:this={strip}
      aria-label="Commits per {unit} for the last year. Use the left and right arrow keys to move and Enter to list its commits."
      onkeydown={moveB}
    >
      {#if isWeek}
        <div class="labels" aria-hidden="true" style:--n={buckets.length}>
          {#each buckets as b, i (b.key)}{#if b.label}<span style:grid-column="{i + 1} / span 3">{b.label}</span
              >{/if}{/each}
        </div>
      {/if}
      <div class="cells" role="row" style:--n={buckets.length}>
        {#each buckets as b, i (b.key)}
          {@const level = bScale.level(b.n)}
          <!-- svelte-ignore a11y_click_events_have_key_events (the strip handles the keys: arrows move, Enter picks) -->
          <span
            class="heat l{level}"
            class:dark={level >= 3}
            class:on={b.key === pickedB?.key}
            role="gridcell"
            tabindex={i === focusB ? 0 : -1}
            data-i={i}
            aria-label="{b.long}: {b.n ? plural(b.n, 'commit') : 'no commits'}"
            data-tip="{b.n ? plural(b.n, 'commit') : 'No commits'}\n{b.long}"
            onclick={() => {
              atB = i;
              chosenB[unit as "week" | "month"] = b.key;
            }}
            >{#if !isWeek}<b>{b.label}</b><small>{b.n}</small>{/if}</span
          >
        {/each}
      </div>
    </div>
  {:else}
    <div class="cal">
      <span></span>
      <div class="months" aria-hidden="true">
        {#each cal.months as m (m.week)}<span style:grid-column="{m.week + 1} / span 3">{m.label}</span>{/each}
      </div>
      <div class="days" aria-hidden="true">
        {#each ["Mon", "", "Wed", "", "Fri", "", ""] as t, i (i)}<span>{t}</span>{/each}
      </div>
      <div
        class="grid"
        role="grid"
        tabindex="-1"
        bind:this={grid}
        aria-label="Commits per day for the last year. Use the arrow keys to move between days and Enter to list a day's commits."
        onkeydown={move}
      >
        {#each cal.cells as c (c.day)}
          {#if c.future}<span class="heat future" style:grid-column={c.week + 1} style:grid-row={c.row + 1}></span>
          {:else}
            {@const i = index.get(c.day) ?? -1}
            <!-- svelte-ignore a11y_click_events_have_key_events (the grid handles the keys: arrows move, Enter picks) -->
            <span
              class="heat l{c.level}"
              class:today={c.day === d.today}
              class:on={c.day === picked}
              role="gridcell"
              tabindex={i === focusAt ? 0 : -1}
              data-i={i}
              style:grid-column={c.week + 1}
              style:grid-row={c.row + 1}
              aria-label="{dayName(c.day, { weekday: 'long', day: 'numeric', month: 'long' })}: {c.n
                ? plural(c.n, 'commit')
                : 'no commits'}"
              data-tip="{c.n ? plural(c.n, 'commit') : 'No commits'}\n{long(c.day)}"
              onclick={() => {
                at = i;
                chosen = c.day;
              }}
            ></span>
          {/if}
        {/each}
      </div>
    </div>
  {/if}
  {#snippet foot()}
    <span>On {branch || "this branch"}, merges left out. Click a {unit} to see its commits.</span>
    <HeatLegend scale={unit === "day" ? scale : bScale} />
  {/snippet}
</HeatWrap>
<div class="day-list" aria-live="polite">
  <div class="head">
    <b>{shown.title}</b><span class="muted">{shown.n ? plural(shown.n, "commit") : "no commits"}</span>
  </div>
  {#each shown.list as c (c.hash)}
    <button type="button" class="commit" onclick={() => (git.commit = c.hash)}
      ><span class="mono">{c.short}</span><span class="grow">{c.subject}</span>{#if !mine}<small>{c.author}</small
        >{/if}</button
    >
  {/each}
  {#if shown.n > shown.list.length}<div class="more muted">
      and {shown.n - shown.list.length} more; see History for all of them.
    </div>{/if}
</div>

<style lang="scss">
  @use "tokens" as *;
  .tools {
    display: flex;
    justify-content: flex-end;
    margin-bottom: space(2);
  }
  // by week: one row of 53 cells under month labels; by month: a row of tiles with name and count
  .strip {
    outline: none;
  }
  .labels,
  .cells {
    display: grid;
    grid-template-columns: repeat(var(--n), minmax(0, 1fr));
    gap: 3px;
  }
  .labels {
    // every label on one row, even where two months start close together
    span {
      grid-row: 1;
    }
    font-size: 11px;
    color: var(--muted);
    white-space: nowrap;
    margin-bottom: space(1);
  }
  .cells .heat {
    cursor: pointer;
    height: 64px;
    border-radius: $radius-sm;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    color: var(--text);
    b {
      font-size: 12px;
      font-weight: $weight-semibold;
    }
    small {
      font-size: 12px;
      color: var(--muted);
      font-variant-numeric: tabular-nums;
    }
    &.dark {
      color: #fff;
      small {
        color: rgba(255, 255, 255, 0.85);
      }
    }
    // in dark mode the ramp runs the other way (busier is lighter): dark text on the busiest
    :global([data-theme="dark"]) &.dark {
      color: var(--card-solid);
      small {
        color: color-mix(in srgb, var(--card-solid) 80%, transparent);
      }
    }
    &:hover,
    &:focus-visible {
      outline: 2px solid var(--text);
      outline-offset: 1px;
    }
    &.on {
      outline: 2px solid var(--accent);
      outline-offset: 1px;
    }
  }
  .weeks .cells .heat {
    height: 40px;
    border-radius: 4px;
  }
  .cal {
    display: grid;
    grid-template-columns: 30px minmax(0, 1fr);
    row-gap: space(1);
  }
  .months {
    white-space: nowrap;
    display: grid;
    grid-template-columns: repeat(53, minmax(0, 1fr));
    gap: 3px;
    font-size: 11px;
    color: var(--muted);
  }
  .days {
    display: grid;
    grid-template-rows: repeat(7, 1fr);
    gap: 3px;
    font-size: 10.5px;
    color: var(--muted);
    span {
      display: flex;
      align-items: center;
    }
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(53, minmax(0, 1fr));
    grid-template-rows: repeat(7, auto);
    gap: 3px;
    outline: none;
    .heat {
      aspect-ratio: 1;
      cursor: pointer;
      &:hover,
      &:focus-visible {
        outline: 2px solid var(--text);
        outline-offset: 1px;
      }
      &.on {
        outline: 2px solid var(--accent);
        outline-offset: 1px;
      }
      &.today {
        box-shadow: inset 0 0 0 1.5px var(--accent);
      }
    }
  }
  .day-list {
    margin: space(1) space(4) space(3) + 2;
    padding: space(2) + 2;
    border-radius: $radius-lg;
    background: var(--card2);
  }
  .head {
    display: flex;
    justify-content: space-between;
    gap: space(2) + 2;
    padding: 2px space(2) + 2 space(2);
    font-size: 13.5px;
  }
  .commit {
    display: flex;
    gap: space(3);
    align-items: baseline;
    width: 100%;
    padding: space(1) + 3 space(2) + 2;
    border: 0;
    border-radius: $radius-sm + 2;
    background: none;
    color: var(--text);
    text-align: left;
    cursor: pointer;
    font-size: 13.5px;
    &:hover,
    &:focus-visible {
      background: var(--card-solid);
    }
    .mono {
      color: var(--accent);
      font-size: 12px;
    }
    .grow {
      flex: 1;
    }
    small {
      color: var(--muted);
    }
  }
  .more {
    font-size: 12.5px;
    padding: space(1) + 2 space(2) + 2;
  }
</style>
