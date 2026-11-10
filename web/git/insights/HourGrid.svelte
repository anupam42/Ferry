<script lang="ts">
  import { plural } from "../../lib/format.ts";
  import { heatScale, hourName, WEEKDAYS } from "../../lib/insights.ts";
  import HeatLegend from "./HeatLegend.svelte";
  import HeatWrap from "./HeatWrap.svelte";

  /** Commits by weekday and hour. */
  let { hours, favDay, favHour }: { hours: number[][]; favDay: number; favHour: number } = $props();
  const scale = $derived(heatScale(hours.flat()));
</script>

<HeatWrap>
  <div class="hours" role="img" aria-label="Commits by weekday and hour. Most on {WEEKDAYS[favDay]}s around {hourName(favHour)}.">
    <span></span>{#each Array.from({ length: 24 }, (_, hr) => hr) as hr (hr)}<span class="hl">{hr % 3 === 0 ? hourName(hr) : ""}</span>{/each}
    {#each hours as row, wd (wd)}
      <span class="rl">{WEEKDAYS[wd]!.slice(0, 3)}</span>
      {#each row as n, hr (hr)}<span class="heat l{scale.level(n)}" data-tip="{n ? plural(n, 'commit') : 'No commits'}\n{WEEKDAYS[wd]}s, {hourName(hr)}–{hourName((hr + 1) % 24)}"></span>{/each}
    {/each}
  </div>
  {#snippet foot()}<span>In each author's own time zone.</span><HeatLegend {scale} />{/snippet}
</HeatWrap>

<style lang="scss">
  .hours { display: grid; grid-template-columns: 34px repeat(24, minmax(0, 1fr)); gap: 3px; .heat { height: 18px; } }
  .hl { font-size: 10.5px; color: var(--muted); white-space: nowrap; overflow: visible; }
  .rl { font-size: 11px; color: var(--muted); display: flex; align-items: center; }
</style>
