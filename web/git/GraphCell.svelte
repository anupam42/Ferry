<script lang="ts">
  import { edgePath, GRAPH, LANE_COLOURS, type GraphRow } from "../lib/graph.ts";

  /**
   * One row of the history graph. delay (ms) draws it in: its lines grow
   * downward and its node pops in (null: already on screen, no entrance).
   * flow adds the light that travels up every lane toward HEAD; its pattern
   * repeats every two rows, so odd rows start a row further along.
   */
  let {
    row,
    width,
    merge,
    head,
    delay = null,
    flow = false,
    index = 0,
  }: {
    row: GraphRow;
    width: number;
    merge: boolean;
    head: boolean;
    delay?: number | null;
    flow?: boolean;
    index?: number;
  } = $props();
  const { row: H, lane: L, pad } = GRAPH;
  const w = $derived(pad * 2 + (width - 1) * L);
  const x = (j: number) => pad + j * L;
  const lines = $derived(row.lines.filter((l) => l.from < GRAPH.max && l.to < GRAPH.max));
  const lane = $derived(LANE_COLOURS[row.c]!);
</script>

<svg
  class="graph"
  width={w}
  height={H}
  viewBox="0 0 {w} {H}"
  aria-hidden="true"
  style:--d={delay != null ? delay + "ms" : null}
>
  {#each lines as l, i (i)}
    <path d={edgePath(l)} stroke={LANE_COLOURS[l.c]} class="edge" class:draw={delay != null} pathLength="1" />
    {#if flow}
      {@const ph = `--ph:${(index % 2) * H + (l.half === "bottom" ? H / 2 : 0)}px;--lane:${LANE_COLOURS[l.c]}`}
      <path d={edgePath(l)} class="flow" style={ph} /><path d={edgePath(l)} class="flow core" style={ph} />
    {/if}
  {/each}
  {#if row.col < GRAPH.max}
    {#if head}<circle cx={x(row.col)} cy={H / 2} r="5" class="halo" style:--lane={lane} />{/if}
    {#if merge}<circle cx={x(row.col)} cy={H / 2} r="7.5" class="ring" style:--lane={lane} />{/if}
    <circle
      cx={x(row.col)}
      cy={H / 2}
      r={merge ? 4 : 5}
      class="node"
      class:merge
      class:head
      class:pop={delay != null}
      style:--lane={lane}
    />
  {/if}
</svg>

<style lang="scss">
  @use "mixins" as *;

  .graph {
    display: block;
    overflow: visible;
  }
  .edge {
    fill: none;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-dasharray: 1;
    @include motion {
      transition: stroke-width 0.15s;
    }
  }
  .node {
    fill: var(--lane);
    stroke: var(--card-solid);
    stroke-width: 2;
    transform-box: fill-box;
    transform-origin: center;
    @include motion {
      transition:
        transform 0.2s cubic-bezier(0.3, 1.6, 0.5, 1),
        filter 0.2s;
    }
    &.merge {
      fill: var(--card-solid);
      stroke: var(--lane);
      stroke-width: 2.5;
    }
    &.head {
      stroke: var(--text);
      stroke-width: 2.5;
    }
  }
  .ring {
    fill: none;
    stroke: var(--lane);
    stroke-width: 1.5;
    stroke-dasharray: 2.5 3.4;
    opacity: 0;
    transform-box: fill-box;
    transform-origin: center;
    pointer-events: none;
  }
  .halo,
  .flow {
    display: none;
  }
  @include motion {
    .edge.draw {
      animation: draw 0.34s cubic-bezier(0.4, 0, 0.2, 1) backwards;
      animation-delay: var(--d, 0ms);
    }
    .node.pop {
      animation: pop 0.42s cubic-bezier(0.3, 1.7, 0.5, 1) backwards;
      animation-delay: calc(var(--d, 0ms) + 120ms);
    }
    // HEAD: a soft halo that keeps rippling out
    .halo {
      display: block;
      fill: var(--lane);
      transform-box: fill-box;
      transform-origin: center;
      pointer-events: none;
      opacity: 0;
      animation: halo 2.4s cubic-bezier(0.2, 0.6, 0.3, 1) infinite;
      animation-delay: calc(var(--d, 0ms) + 500ms);
    }
    // points of light travelling up the lanes toward HEAD
    .flow {
      display: block;
      fill: none;
      stroke: var(--lane);
      stroke-width: 5.5;
      stroke-linecap: round;
      stroke-dasharray: 3 85;
      opacity: 0;
      pointer-events: none;
      animation:
        flow 3.2s linear infinite,
        fade-in 0.6s ease forwards;
      animation-delay: 0s, calc(var(--d, 0ms) + 400ms);
      &.core {
        stroke: #fff;
        stroke-width: 2.4;
        stroke-dasharray: 0.01 87.99;
        animation-name: flow-core, fade-in;
      }
    }
  }
  // hovering (or focusing) a row wakes it up
  :global(.h-row:hover),
  :global(.h-row:focus-visible) {
    .node {
      transform: scale(1.35);
      filter: drop-shadow(0 0 4px var(--lane));
    }
    .edge {
      stroke-width: 3;
    }
    .ring {
      opacity: 0.9;
      @include motion {
        animation: spin 3s linear infinite;
      }
    }
  }
  @keyframes draw {
    from {
      stroke-dashoffset: 1;
    }
  }
  @keyframes pop {
    from {
      transform: scale(0);
    }
  }
  @keyframes halo {
    0% {
      transform: scale(1);
      opacity: 0.45;
    }
    80%,
    100% {
      transform: scale(3.2);
      opacity: 0;
    }
  }
  @keyframes flow {
    from {
      stroke-dashoffset: var(--ph);
    }
    to {
      stroke-dashoffset: calc(var(--ph) + 88px);
    }
  }
  @keyframes flow-core {
    from {
      stroke-dashoffset: calc(var(--ph) - 1.5px);
    }
    to {
      stroke-dashoffset: calc(var(--ph) + 86.5px);
    }
  }
  @keyframes fade-in {
    to {
      opacity: 0.85;
    }
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
