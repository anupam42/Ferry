<script lang="ts">
  import { plural } from "../../lib/format.ts";
  import { git } from "../../lib/git.svelte.ts";
  import { heatScale, k, monthLabel, splitPath } from "../../lib/insights.ts";
  import type { InsightsResponse } from "../../lib/types.ts";
  import HeatLegend from "./HeatLegend.svelte";
  import HeatWrap from "./HeatWrap.svelte";

  /** The files changed in the most commits, month by month. */
  let { d }: { d: InsightsResponse } = $props();
  const scale = $derived(heatScale(d.files.flatMap((f) => f.months)));
  const monthLong = (m: string) =>
    new Date(m + "-15T12:00:00").toLocaleDateString(undefined, { month: "long", year: "numeric" });
</script>

<HeatWrap>
  <div class="fh" role="table" aria-label="Commits per file per month">
    <div class="row head" role="row">
      <span role="columnheader">File</span>
      {#each d.months as m, i (m)}<span class="month" role="columnheader">{monthLabel(m, i)}</span>{/each}
      <span class="total" role="columnheader">Commits</span>
    </div>
    {#each d.files as f (f.path)}
      {@const p = splitPath(f.path)}
      <div class="row" role="row">
        <button type="button" class="file" role="rowheader" title="Open {f.path}" onclick={() => (git.file = f.path)}
          ><b>{p.name}</b>{#if p.dir}<small>{p.dir}</small>{/if}</button
        >
        {#each f.months as n, i (i)}<span
            class="heat l{scale.level(n)}"
            role="cell"
            aria-label="{monthLabel(d.months[i]!, 0)}: {n}"
            data-tip="{p.name}\n{n ? plural(n, 'commit') : 'No commits'} in {monthLong(d.months[i]!)}"
          ></span>{/each}
        <span class="total" role="cell"><b>{f.commits}</b><small>+{k(f.added)} −{k(f.removed)}</small></span>
      </div>
    {/each}
  </div>
  {#snippet foot()}<span>The files changed in the most commits this year.</span><HeatLegend {scale} />{/snippet}
</HeatWrap>

<style lang="scss">
  @use "tokens" as *;
  @use "mixins" as *;
  .fh {
    display: flex;
    flex-direction: column;
    gap: 3px;
    overflow-x: auto;
  }
  .row {
    display: grid;
    grid-template-columns: minmax(150px, 2.2fr) repeat(12, minmax(14px, 1fr)) 92px;
    gap: 3px;
    align-items: center;
    min-width: 560px;
    .heat {
      height: 26px;
    }
  }
  .head {
    font-size: 11px;
    color: var(--muted);
    margin-bottom: 2px;
  }
  .file {
    min-width: 0;
    padding: 0 space(2) 0 0;
    overflow: hidden;
    border: 0;
    background: none;
    text-align: left;
    cursor: pointer;
    color: var(--text);
    b {
      display: block;
      font-size: 13px;
      font-weight: $weight-semibold;
      @include ellipsis;
    }
    small {
      display: block;
      color: var(--muted);
      font-size: 11.5px;
      @include ellipsis;
    }
    &:hover b {
      color: var(--accent);
    }
  }
  .month {
    text-align: center;
    white-space: nowrap;
  }
  .total {
    text-align: right;
    font-variant-numeric: tabular-nums;
    b {
      display: block;
      font-size: 13px;
    }
    small {
      color: var(--muted);
      font-size: 11px;
    }
  }
</style>
