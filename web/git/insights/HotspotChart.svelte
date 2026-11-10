<script lang="ts">
  import { plural } from "../../lib/format.ts";
  import { hotspots, niceMax, splitPath, ticks } from "../../lib/insights.ts";
  import type { InsightsResponse } from "../../lib/types.ts";
  import HeatWrap from "./HeatWrap.svelte";

  /** How often each file changes against how big it is. Big and busy is where bugs live. */
  let { d }: { d: InsightsResponse } = $props();
  const W = 1000, H = 330, L = 48, R = 16, T = 16, B = 44, pw = W - L - R, ph = H - T - B;
  const hs = $derived(hotspots(d));
  const lx = (v: number) => Math.log10(Math.max(1, v));
  const x0 = $derived(Math.floor(lx(Math.min(...hs.pts.map((p) => p.lines)))));
  const x1 = $derived(Math.max(x0 + 1, Math.ceil(lx(Math.max(...hs.pts.map((p) => p.lines))))));
  const axis = $derived(niceMax(Math.max(1, ...hs.pts.map((p) => p.commits))));
  const x = (lines: number) => L + ((lx(lines) - x0) / (x1 - x0)) * pw;
  const y = (c: number) => T + ph - (c / axis.max) * ph;
  const isTop = $derived(new Set(hs.top.map((p) => p.path)));
  // the top ones drawn last, so they sit on top
  const dots = $derived([...hs.pts].sort((a, b) => Number(isTop.has(a.path)) - Number(isTop.has(b.path))));
  const decades = $derived(Array.from({ length: x1 - x0 + 1 }, (_, i) => x0 + i));
  // direct labels for the top five, skipping any that would sit on another
  const labels = $derived.by(() => {
    const placed: [number, number][] = [];
    return hs.top.flatMap((p) => {
      const px = x(p.lines), py = y(p.commits);
      if (placed.some(([a, b]) => Math.abs(a - px) < 110 && Math.abs(b - py) < 16)) return [];
      placed.push([px, py]);
      const right = px < W - 140;
      return [{ x: px + (right ? 11 : -11), y: py + 4, anchor: right ? "start" : "end", name: splitPath(p.path).name }];
    });
  });
  const lines = (n: number) => (n >= 1000 ? n / 1000 + "k" : n) + " lines";
</script>

{#if hs.pts.length < 3}
  <div class="empty-row">Not enough files have changed yet to find hotspots.</div>
{:else}
  <HeatWrap>
    <svg viewBox="0 0 {W} {H}" class="chart" role="img" aria-label="Files by size and how often they change. Biggest hotspots: {hs.top.map((p) => splitPath(p.path).name).join(', ')}.">
      <rect x={x(hs.medLines)} y={T} width={Math.max(0, W - R - x(hs.medLines))} height={Math.max(0, y(hs.medCommits) - T)} class="zone" />
      <text x={W - R - 8} y={T + 16} class="zone-label" text-anchor="end">Big and changing often: look here first</text>
      {#each ticks(axis) as v (v)}
        <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} class="grid" class:base={v === 0} />
        <text x={L - 8} y={y(v) + 4} class="axis" text-anchor="end">{v}</text>
      {/each}
      {#each decades as e (e)}
        <line x1={x(10 ** e)} x2={x(10 ** e)} y1={T} y2={T + ph} class="grid" />
        <text x={x(10 ** e)} y={T + ph + 16} class="axis" text-anchor={e === x0 ? "start" : e === x1 ? "end" : "middle"}>{lines(10 ** e)}</text>
      {/each}
      <line x1={x(hs.medLines)} x2={x(hs.medLines)} y1={T} y2={T + ph} class="median" />
      <line x1={L} x2={W - R} y1={y(hs.medCommits)} y2={y(hs.medCommits)} class="median" />
      <text x={L + pw / 2} y={H - 4} class="axis title" text-anchor="middle">Size of the file today (lines, log scale) →</text>
      <text x={12} y={T + ph / 2} class="axis title" text-anchor="middle" transform="rotate(-90 12 {T + ph / 2})">Commits this year →</text>
      {#each dots as p (p.path)}
        <!-- svelte-ignore a11y_no_noninteractive_tabindex (focusable so the keyboard can read each file's label) -->
        <circle cx={x(p.lines)} cy={y(p.commits)} r={isTop.has(p.path) ? 7 : 5} class="dot" class:top={isTop.has(p.path)} tabindex="0" role="img" aria-label={p.path}
          data-tip="{p.path}\n{plural(p.commits, 'commit')} · {p.lines.toLocaleString()} lines\n{plural(p.authors, 'person', 'people')} changed it" />
      {/each}
      {#each labels as l (l.name + l.x)}<text x={l.x} y={l.y} class="direct" text-anchor={l.anchor}>{l.name}</text>{/each}
    </svg>
    {#snippet foot()}
      <span>Each dot is a file. Files that are both big and often changed are where bugs tend to hide; they're worth splitting up or covering with tests.</span>
      <span class="key"><i class="swatch dot top"></i>top hotspots<i class="swatch dot"></i>other files</span>
    {/snippet}
  </HeatWrap>
  <div class="rank">
    <div class="rank-head">Look here first</div>
    {#each hs.top as p, i (p.path)}
      {@const f = splitPath(p.path)}
      <div class="rank-row">
        <span class="n">{i + 1}</span>
        <span class="file"><b>{f.name}</b>{#if f.dir}<small>{f.dir}</small>{/if}</span>
        <span class="muted">{plural(p.commits, "commit")} · {p.lines.toLocaleString()} lines · {plural(p.authors, "person", "people")}</span>
      </div>
    {/each}
  </div>
{/if}

<style lang="scss">
  @use "tokens" as *;
  @use "mixins" as *;
  .rank { margin: 0 space(4) space(3) + 2; padding: space(2) space(2) + 2; border-radius: $radius-lg; background: var(--card2); }
  .rank-head { font-weight: $weight-bold; font-size: 13.5px; padding: 2px space(2) space(2); }
  .rank-row { display: grid; grid-template-columns: 24px minmax(0, 1fr) auto; gap: space(3); align-items: center; padding: space(1) + 2 space(2); font-size: 13px;
    .n { width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; background: var(--accent-soft); color: var(--accent); font-weight: $weight-bold; font-size: 12px; } }
  .file { min-width: 0; b { display: block; @include ellipsis; } small { display: block; color: var(--muted); font-size: 11.5px; @include ellipsis; } }
  @include below(tablet) { .rank-row { grid-template-columns: 24px minmax(0, 1fr); .muted { grid-column: 2; } } }
</style>
