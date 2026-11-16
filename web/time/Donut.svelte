<script lang="ts">
  import { colorOf } from "../lib/timecolors.ts";
  import { duration } from "../../src/shared/work.ts";

  /** Where the time went: each project's share, the total in the middle, and a legend with hours. */
  let { projects, label }: { projects: { name: string; minutes: number }[]; label: string } = $props();

  const R = 70,
    STROKE = 26,
    C = 2 * Math.PI * R;
  // five named projects at most; the rest are summed as "Other"
  const shown = $derived.by(() => {
    const top = projects.slice(0, 5);
    const rest = projects.slice(5).reduce((n, p) => n + p.minutes, 0);
    return rest ? [...top, { name: "Other", minutes: rest }] : top;
  });
  const total = $derived(shown.reduce((n, p) => n + p.minutes, 0));
  // each arc as a dash on one circle, with a 2px gap between arcs
  const arcs = $derived.by(() => {
    let at = 0;
    return shown.map((p) => {
      const len = total ? (p.minutes / total) * C : 0;
      const a = { ...p, dash: Math.max(0, len - (shown.length > 1 ? 2 : 0)), offset: -at };
      at += len;
      return a;
    });
  });
  let hover = $state<string | null>(null);
  const focus = $derived(shown.find((p) => p.name === hover) ?? null);
  const color = (n: string) => (n === "Other" ? "var(--series-other)" : colorOf(n));
</script>

<section class="card donut" aria-label="Where the time went">
  <div class="head">
    <h2>Where it went</h2>
    <span class="muted">{label}</span>
  </div>
  {#if !total}
    <p class="empty muted">Nothing counted yet.</p>
  {:else}
    <div class="body">
      <svg viewBox="0 0 180 180" width="160" height="160" role="img" aria-label="Share of time per project">
        <g transform="rotate(-90 90 90)">
          <circle cx="90" cy="90" r={R} class="track" stroke-width={STROKE} fill="none" />
          {#each arcs as a (a.name)}
            <circle
              cx="90"
              cy="90"
              r={R}
              fill="none"
              stroke={color(a.name)}
              stroke-width={hover === a.name ? STROKE + 6 : STROKE}
              stroke-dasharray="{a.dash} {C}"
              stroke-dashoffset={a.offset}
              class:dim={hover !== null && hover !== a.name}
              role="presentation"
              onpointerenter={() => (hover = a.name)}
              onpointerleave={() => (hover = null)}
            />
          {/each}
        </g>
        <text x="90" y="86" text-anchor="middle" class="big">{duration(focus?.minutes ?? total)}</text>
        <text x="90" y="106" text-anchor="middle" class="small"
          >{focus ? `${Math.round((focus.minutes / total) * 100)}% · ${focus.name}` : "in all"}</text
        >
      </svg>
      <ul class="chips">
        {#each shown as p (p.name)}
          <li class:on={hover === p.name} onpointerenter={() => (hover = p.name)} onpointerleave={() => (hover = null)}>
            <span class="bar" style:background={color(p.name)}></span>
            <span class="n">{p.name}</span>
            <span class="v">{duration(p.minutes)}</span>
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</section>

<style lang="scss">
  @use "tokens" as *;
  @use "mixins" as *;

  .donut {
    padding: space(4);
  }
  .head {
    display: flex;
    align-items: baseline;
    gap: space(2);
    margin-bottom: space(3);
    h2 {
      font-size: fs(lg);
      flex: 1;
    }
    span {
      font-size: 12px;
    }
  }
  .empty {
    font-size: 13px;
    margin: 0;
  }
  .body {
    display: flex;
    align-items: center;
    gap: space(4);
    flex-wrap: wrap;
  }
  .track {
    stroke: var(--card2);
  }
  circle {
    @include motion {
      transition:
        stroke-width 0.18s,
        opacity 0.18s;
    }
  }
  circle.dim {
    opacity: 0.35;
  }
  .big {
    font-size: 17px;
    font-weight: $weight-bold;
    fill: var(--text);
  }
  .small {
    font-size: 10.5px;
    fill: var(--muted);
  }
  .chips {
    flex: 1;
    min-width: 140px;
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: space(1) + 2;
    li {
      display: flex;
      align-items: center;
      gap: space(2);
      padding: space(1) + 2 space(2) + 2;
      border-radius: $radius-md + 2;
      background: var(--card2);
      font-size: 12.5px;
      @include motion {
        transition: transform 0.15s;
      }
      &.on {
        transform: translateX(3px);
      }
    }
    .bar {
      width: 4px;
      height: 18px;
      border-radius: 2px;
      flex: none;
    }
    .n {
      flex: 1;
      font-weight: $weight-semibold;
      min-width: 0;
      @include ellipsis;
    }
    .v {
      color: var(--muted);
      font-variant-numeric: tabular-nums;
    }
  }
</style>
