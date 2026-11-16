<script lang="ts">
  import { colorOf } from "../lib/timecolors.ts";
  import { duration } from "../../src/shared/work.ts";

  /**
   * Hours per day, stacked by project. Hovering (or focusing) a day lifts its column and lists
   * where its time went. Identity is never colour alone: the legend names every project, and the
   * tooltip and the timesheet give the numbers.
   */
  let {
    days,
    projects,
    now,
  }: {
    days: { day: string; minutes: Record<string, number> }[];
    projects: { name: string; minutes: number }[];
    now: string;
  } = $props();

  const H = 200,
    TOP = 10,
    BOTTOM = 26,
    LEFT = 34;
  let w = $state(640);
  const plotW = $derived(Math.max(200, w - LEFT - 4));
  const slot = $derived(plotW / Math.max(1, days.length));
  const barW = $derived(Math.max(8, Math.min(30, slot * 0.46)));

  // the stack order is fixed: the legend's order, busiest first
  const order = $derived(projects.map((p) => p.name));
  const totals = $derived(days.map((d) => Object.values(d.minutes).reduce((a, b) => a + b, 0)));
  // a round number of hours at the top, and four steps up to it
  const maxH = $derived.by(() => {
    const top = Math.max(...totals, 1) / 60;
    const step = [0.25, 0.5, 1, 2, 3, 4, 6].find((s) => s * 4 >= top) ?? Math.ceil(top / 4);
    return step * 4;
  });
  const ticks = $derived([0, 1, 2, 3, 4].map((i) => (maxH / 4) * i));
  const y = (minutes: number) => TOP + (H - TOP - BOTTOM) * (1 - minutes / 60 / maxH);
  const hours = (h: number) => (h % 1 ? `${h.toFixed(h < 1 ? 2 : 1).replace(/0+$/, "")}h` : `${h}h`);

  // the segments of one day's bar, bottom up, with a 2px gap between them
  function segments(d: { minutes: Record<string, number> }) {
    let base = 0;
    const out: { name: string; y0: number; y1: number; top: boolean }[] = [];
    for (const name of order) {
      const m = d.minutes[name] ?? 0;
      if (m <= 0) continue;
      out.push({ name, y0: y(base), y1: y(base + m), top: false });
      base += m;
    }
    if (out.length) out[out.length - 1]!.top = true;
    return out;
  }
  // a bar segment; the top one gets 4px rounded corners at its data end
  function rect(x: number, s: { y0: number; y1: number; top: boolean }, gap: boolean) {
    const y0 = s.y0 - (gap ? 1 : 0),
      y1 = s.y1 + (s.top ? 0 : 1);
    const h = Math.max(0, y0 - y1);
    const r = s.top ? Math.min(4, h, barW / 2) : 0;
    return `M${x},${y0}V${y1 + r}Q${x},${y1} ${x + r},${y1}H${x + barW - r}Q${x + barW},${y1} ${x + barW},${y1 + r}V${y0}Z`;
  }

  let hover = $state<number | null>(null);
  const label = (d: string, short = true) =>
    new Date(d + "T12:00:00").toLocaleDateString(
      undefined,
      short ? { weekday: "short" } : { weekday: "long", day: "numeric", month: "short" },
    );
  const many = $derived(days.length > 10);
</script>

<section class="card chart" aria-label="Time spent on projects">
  <div class="head">
    <h2>Time on projects</h2>
    {#if projects.length > 1}
      <ul class="legend" aria-label="Projects">
        {#each projects.slice(0, 9) as p (p.name)}
          <li><span class="sw" style:background={colorOf(p.name)}></span>{p.name}</li>
        {/each}
      </ul>
    {/if}
  </div>
  {#if !projects.length}
    <p class="empty muted">No work in these days yet. It shows up here as you save and commit.</p>
  {:else}
    <div class="plot" bind:clientWidth={w}>
      <svg width={w} height={H} role="img" aria-label="Hours per day, by project">
        {#each ticks as t (t)}
          <line class="grid" x1={LEFT} x2={w} y1={y(t * 60)} y2={y(t * 60)} />
          <text class="tick" x={LEFT - 8} y={y(t * 60) + 4} text-anchor="end">{hours(t)}</text>
        {/each}
        {#each days as d, i (d.day)}
          {@const x = LEFT + slot * i + (slot - barW) / 2}
          {#if hover === i}<rect
              class="lift"
              x={LEFT + slot * i + 3}
              y={TOP - 6}
              width={slot - 6}
              height={H - TOP - BOTTOM + 8}
              rx="10"
            />{/if}
          {#each segments(d) as s, si (s.name)}
            <path d={rect(x, s, si > 0)} fill={colorOf(s.name)} class:dim={hover !== null && hover !== i} />
          {/each}
          {#if !many || i % 2 === (days.length - 1) % 2}
            <text class="day" class:today={d.day === now} x={LEFT + slot * (i + 0.5)} y={H - 8} text-anchor="middle"
              >{many ? +d.day.slice(8) : label(d.day)}</text
            >
          {/if}
          <!-- the hit target: the whole column, bigger than the bar -->
          <rect
            class="hit"
            role="button"
            tabindex="0"
            aria-label="{label(d.day, false)}: {duration(totals[i]!)}"
            x={LEFT + slot * i}
            y={0}
            width={slot}
            height={H}
            onpointerenter={() => (hover = i)}
            onpointerleave={() => (hover = null)}
            onfocus={() => (hover = i)}
            onblur={() => (hover = null)}
          />
        {/each}
      </svg>
      {#if hover !== null && totals[hover]}
        {@const d = days[hover]!}
        {@const left = Math.min(Math.max(LEFT + slot * (hover + 0.5), 90), w - 90)}
        <div class="tip" style:left="{left}px" role="status">
          <div class="tt">{label(d.day, false)} · {duration(totals[hover]!)}</div>
          {#each order.filter((n) => d.minutes[n]) as n (n)}
            <div class="row">
              <span class="sw" style:background={colorOf(n)}></span><span class="n">{n}</span>
              <span class="v">{duration(d.minutes[n]!)}</span>
              <span class="pc">{Math.round((d.minutes[n]! / totals[hover]!) * 100)}%</span>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</section>

<style lang="scss">
  @use "tokens" as *;
  @use "mixins" as *;

  .chart {
    padding: space(4) space(4) space(2);
  }
  .head {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: space(2) space(4);
    margin-bottom: space(2);
    h2 {
      font-size: fs(lg);
      flex: 1;
    }
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: space(1) space(3);
    list-style: none;
    margin: 0;
    padding: 0;
    font-size: 12.5px;
    color: var(--muted);
    li {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
  }
  .sw {
    width: 10px;
    height: 10px;
    border-radius: 3px;
    flex: none;
  }
  .empty {
    padding: space(6) 0;
    text-align: center;
    font-size: 13px;
  }
  .plot {
    position: relative;
    svg {
      display: block;
      overflow: visible;
    }
  }
  .grid {
    stroke: var(--line);
    stroke-width: 1;
  }
  .tick,
  .day {
    font-size: 11px;
    fill: var(--faint);
    font-variant-numeric: tabular-nums;
  }
  .day.today {
    fill: var(--text);
    font-weight: $weight-bold;
  }
  .lift {
    fill: var(--accent-soft);
  }
  path {
    @include motion {
      transition: opacity 0.15s;
    }
  }
  path.dim {
    opacity: 0.35;
  }
  .hit {
    fill: transparent;
    cursor: default;
    outline: none;
  }
  .tip {
    position: absolute;
    top: -6px;
    transform: translate(-50%, -100%);
    min-width: 180px;
    padding: space(2) space(3);
    border-radius: $radius-md + 2;
    background: var(--card-solid);
    border: 1px solid var(--line);
    box-shadow: 0 10px 28px rgba(9, 35, 72, 0.16);
    font-size: 12.5px;
    pointer-events: none;
    z-index: 3;
    .tt {
      font-weight: $weight-semibold;
      margin-bottom: 4px;
    }
    .row {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 1px 0;
    }
    .n {
      flex: 1;
      color: var(--muted);
    }
    .v {
      font-variant-numeric: tabular-nums;
    }
    .pc {
      width: 34px;
      text-align: right;
      color: var(--faint);
      font-variant-numeric: tabular-nums;
    }
  }
</style>
