<script lang="ts">
  import { plural } from "../../lib/format.ts";
  import { dayName, niceMax, noon, syncDays, ticks } from "../../lib/insights.ts";
  import type { InsightsResponse } from "../../lib/types.ts";
  import HeatWrap from "./HeatWrap.svelte";

  /** Ferry's own record: files synced each day, and whether a commit followed. Git can't see this work. */
  let { d, open }: { d: InsightsResponse; open: number } = $props();
  const W = 1000, H = 200, L = 34, R = 8, T = 12, B = 46, pw = W - L - R, ph = H - T - B;
  const days = $derived(syncDays(d));
  const synced = $derived(days.filter((x) => x.files));
  const lonely = $derived(synced.filter((x) => !x.commits));
  const axis = $derived(niceMax(Math.max(1, ...days.map((x) => x.files))));
  const bw = $derived(pw / Math.max(1, days.length));
  const x = (i: number) => L + i * bw;
  const y = (v: number) => T + ph - (v / axis.max) * ph;
  const rowY = T + ph + 16;
  const pairs = $derived(d.sync?.pairs ?? []);
</script>

<HeatWrap>
  <div class="tiles three">
    <div class="tile"><div class="v">{open}</div><div class="l">{open === 1 ? "file changed since the last commit" : "files changed since the last commit"}</div></div>
    <div class="tile"><div class="v">{lonely.length} of {synced.length}</div><div class="l">days with syncs had no commit</div></div>
    <div class="tile"><div class="v">{synced.reduce((a, b) => a + b.files, 0).toLocaleString()}</div><div class="l">files synced since {days[0] ? dayName(days[0].day, { day: "numeric", month: "short" }) : "the start"}</div></div>
  </div>
  <svg viewBox="0 0 {W} {H}" class="chart" role="img" aria-label="Files Ferry synced each day. {lonely.length} of {synced.length} days with syncs had no commit.">
    {#each ticks(axis) as v (v)}
      <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} class="grid" class:base={v === 0} />
      <text x={L - 8} y={y(v) + 4} class="axis" text-anchor="end">{v}</text>
    {/each}
    <text x={L - 8} y={rowY + 4} class="axis" text-anchor="end">git</text>
    {#each days as dd, i (dd.day)}
      {#if dd.files}<rect x={x(i) + 2} y={y(dd.files)} width={Math.max(1, bw - 4)} height={y(0) - y(dd.files)} rx={Math.min(4, (bw - 4) / 2)} class="bar" class:open={!dd.commits} />{/if}
      {#if dd.commits}<circle cx={x(i) + bw / 2} cy={rowY} r="4.5" class="commit-dot" />{/if}
      {#if noon(dd.day).getDay() === 1}<text x={x(i)} y={H - 6} class="axis">{dayName(dd.day, { day: "numeric", month: "short" })}</text>{/if}
      <rect x={x(i)} y={T} width={bw} height={ph + 26} class="hit"
        data-tip="{dayName(dd.day, { weekday: 'long', day: 'numeric', month: 'long' })}\n{dd.files ? plural(dd.files, 'file') + ' synced' : 'Nothing synced'}\n{dd.commits ? plural(dd.commits, 'commit') : dd.files ? 'No commit that day' : 'No commits'}" />
    {/each}
  </svg>
  {#snippet foot()}
    <span>From {pairs.length > 1 ? "the pairs" : "the pair"} {pairs.join(", ")}. Only Ferry sees this work: git only knows about what you commit.</span>
    <span class="key"><i class="swatch bar"></i>synced, then committed<i class="swatch bar open"></i>synced, no commit<i class="swatch commit"></i>a commit</span>
  {/snippet}
</HeatWrap>

<style lang="scss">
  @use "tokens" as *;
  @use "mixins" as *;
  .tiles.three { grid-template-columns: repeat(3, minmax(0, 1fr)); padding: 0 0 space(3); .v { font-size: 22px; } }
  @include below(tablet) { .tiles.three { grid-template-columns: minmax(0, 1fr); } }
</style>
