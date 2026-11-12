<script lang="ts" module>
  /**
   * Ferry's own wordmark, drawn for it (not a font): even, round-ended strokes; R's leg sweeps out
   * like a boat's wake, Y's arms curve in like a sail, and a wave runs underneath for the sea.
   * Each letter is a group of strokes on a 0–100 tall grid, placed along the line.
   */
  export const LETTERS: { x: number; d: string[] }[] = [
    { x: 0, d: ["M8 100 V18 Q8 4 22 4 H58", "M8 52 H44"] },
    { x: 78, d: ["M58 4 H24 Q10 4 10 18 V86 Q10 100 24 100 H58", "M10 52 H48"] },
    { x: 158, d: ["M10 100 V4 H34 A 24 24 0 0 1 34 52 H10", "M30 52 C 44 56, 50 78, 66 100"] },
    { x: 240, d: ["M10 100 V4 H34 A 24 24 0 0 1 34 52 H10", "M30 52 C 44 56, 50 78, 66 100"] },
    { x: 322, d: ["M4 4 Q 10 40, 34 52", "M64 4 Q 58 40, 34 52 V100"] },
  ];
  const SEA = "M-4 128 C 30 116, 60 140, 98 128 S 166 116, 200 128 S 268 140, 302 128 S 370 116, 396 126";
</script>

<script lang="ts">
  /**
   * `draw`: the letters draw themselves, each at its time in `at` (seconds), and the wave from left
   * to right over `sea` seconds. Otherwise it's simply there. The letters take the text colour.
   */
  let { draw = false, at = [], sea = 2 }: { draw?: boolean; at?: readonly number[]; sea?: number } = $props();
</script>

<svg viewBox="-12 -16 420 160" class="wordmark" class:draw role="img" aria-label="Ferry" style:--sea="{sea}s">
  <defs>
    <linearGradient id="ferry-sea" gradientUnits="userSpaceOnUse" x1="-4" x2="396" y1="0" y2="0">
      <stop offset="0" stop-color="#4C9DF5" /><stop offset="1" stop-color="#2DD4BF" />
    </linearGradient>
  </defs>
  {#each LETTERS as l, i (i)}
    <g transform="translate({l.x} 0)" style:--at="{at[i] ?? 0}s">
      {#each l.d as d, k (k)}<path {d} pathLength="1" style:--k={k} />{/each}
    </g>
  {/each}
  <path class="sea" d={SEA} pathLength="1" />
</svg>

<style lang="scss">
  @use "mixins" as *;
  .wordmark {
    display: block;
    width: 100%;
    height: auto;
    overflow: visible;
    fill: none;
    stroke: currentColor;
    stroke-width: 12;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .sea {
    stroke: url(#ferry-sea);
    stroke-width: 7;
  }
  @include motion {
    // each stroke draws itself, the second one of a letter a moment after the first; until its
    // turn it's hidden (a round line end would otherwise show as a dot)
    .draw g path {
      opacity: 0;
      stroke-dasharray: 1;
      stroke-dashoffset: 1;
      animation: draw 0.55s cubic-bezier(0.4, 0, 0.2, 1) calc(var(--at) + var(--k) * 0.12s) forwards;
    }
    .draw .sea {
      opacity: 0;
      stroke-dasharray: 1;
      stroke-dashoffset: 1;
      animation: draw var(--sea) cubic-bezier(0.45, 0.05, 0.4, 1) 0.15s forwards;
    }
  }
  @keyframes draw {
    from {
      opacity: 1;
      stroke-dashoffset: 1;
    }
    to {
      opacity: 1;
      stroke-dashoffset: 0;
    }
  }
</style>
