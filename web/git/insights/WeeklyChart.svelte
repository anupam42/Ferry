<script lang="ts">
  import { plural } from "../../lib/format.ts";
  import { dayName, niceMax, ticks, weekly, ymd } from "../../lib/insights.ts";
  import type { InsightsResponse } from "../../lib/types.ts";
  import HeatWrap from "./HeatWrap.svelte";

  /** Pace: commits per week, with a 4-week average line. */
  let { d }: { d: InsightsResponse } = $props();
  const W = 1000,
    H = 190,
    L = 34,
    R = 8,
    T = 12,
    B = 24,
    pw = W - L - R,
    ph = H - T - B,
    bw = pw / 53;
  const pace = $derived(weekly(d));
  const most = $derived(Math.max(...pace.weeks.map((w) => w.n), 0));
  const axis = $derived(niceMax(Math.max(most, 1)));
  const x = (i: number) => L + (i / 53) * pw;
  const y = (v: number) => T + ph - (v / axis.max) * ph;
  // a month label at the first week of each month
  const months = $derived(
    pace.weeks.flatMap((wk, i) =>
      i < 51 && (i === 0 || wk.start.getMonth() !== pace.weeks[i - 1]!.start.getMonth())
        ? [{ i, label: wk.start.toLocaleDateString(undefined, { month: "short" }) }]
        : [],
    ),
  );
  const line = $derived(pace.weeks.map((wk, i) => `${(x(i) + bw / 2).toFixed(1)},${y(wk.avg).toFixed(1)}`).join(" "));
</script>

<HeatWrap>
  <svg
    viewBox="0 0 {W} {H}"
    class="chart"
    role="img"
    aria-label="Commits per week for the last year, at most {most} in a week."
  >
    {#each ticks(axis) as v (v)}
      <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} class="grid" class:base={v === 0} />
      <text x={L - 8} y={y(v) + 4} class="axis" text-anchor="end">{v}</text>
    {/each}
    {#each months as m (m.i)}<text x={x(m.i)} y={H - 6} class="axis">{m.label}</text>{/each}
    {#each pace.weeks as wk, i (i)}
      {#if wk.n}<rect
          x={x(i) + 1}
          y={y(wk.n)}
          width={Math.max(1, bw - 2)}
          height={y(0) - y(wk.n)}
          rx={Math.min(4, (bw - 2) / 2)}
          class="bar"
        />{/if}
    {/each}
    <polyline points={line} class="avg" />
    {#each pace.weeks as wk, i (i)}
      <rect
        x={x(i)}
        y={T}
        width={bw}
        height={ph}
        class="hit"
        data-tip="{plural(wk.n, 'commit')}\nWeek of {dayName(ymd(wk.start), {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        })}\n4-week average: {wk.avg.toFixed(1)}"
      />
    {/each}
  </svg>
  {#snippet foot()}
    <span>{pace.trend}</span>
    <span class="key"><i class="swatch bar"></i>commits per week<i class="swatch line"></i>4-week average</span>
  {/snippet}
</HeatWrap>
