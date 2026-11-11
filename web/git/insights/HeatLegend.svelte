<script lang="ts">
  import { rangeLabel, type HeatScale } from "../../lib/insights.ts";
  let { scale, unit = "commit" }: { scale: HeatScale; unit?: string } = $props();
</script>

<div class="legend" role="img" aria-label="Colour scale, from fewer {unit}s to more">
  <span>Less</span>{#each scale.ranges as r, i (i)}<i class="heat l{i}" title={rangeLabel(r, unit)}></i>{/each}<span
    >More</span
  >
</div>

<style lang="scss">
  @use "tokens" as *;
  .legend {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    color: var(--muted);
    font-size: 12px;
    span {
      margin: 0 space(1);
    }
    i {
      width: 12px;
      height: 12px;
    }
  }
</style>
