<script lang="ts">
  import type { Snippet } from "svelte";

  /**
   * One floating label for a whole chart: any element inside with data-tip
   * ("Bold first line\nmore\nlines") shows it on hover and on keyboard focus.
   */
  let { children, foot }: { children: Snippet; foot?: Snippet } = $props();
  let wrap: HTMLDivElement;
  let tip = $state<{ x: number; y: number; lines: string[]; side: "" | "l" | "r" } | null>(null);

  function show(t: EventTarget | null) {
    const cell = (t as Element | null)?.closest?.("[data-tip]") as HTMLElement | SVGElement | null;
    if (!cell?.dataset.tip || !wrap.contains(cell)) {
      tip = null;
      return;
    }
    const wr = wrap.getBoundingClientRect(),
      cr = cell.getBoundingClientRect();
    const x = cr.left - wr.left + cr.width / 2;
    tip = {
      x: Math.max(8, Math.min(wr.width - 8, x)),
      y: cr.top - wr.top - 8,
      lines: cell.dataset.tip.split("\n"),
      side: x < 120 ? "l" : x > wr.width - 120 ? "r" : "",
    };
  }
</script>

<div
  class="wrap"
  bind:this={wrap}
  role="presentation"
  onpointerover={(e) => show(e.target)}
  onpointerleave={() => (tip = null)}
  onfocusin={(e) => show(e.target)}
  onfocusout={() => (tip = null)}
>
  {@render children()}
  {#if foot}<div class="foot">{@render foot()}</div>{/if}
  {#if tip}
    <div class="tip {tip.side}" role="tooltip" style:left="{tip.x}px" style:top="{tip.y}px">
      <b>{tip.lines[0]}</b>{#each tip.lines.slice(1) as l, i (i)}<span>{l}</span>{/each}
    </div>
  {/if}
</div>

<style lang="scss">
  @use "tokens" as *;
  .wrap {
    position: relative;
    padding: space(1) + 2 space(4) space(3) + 2;
  }
  .foot {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: space(3);
    flex-wrap: wrap;
    margin-top: space(2) + 2;
    font-size: fs(sm);
    color: var(--muted);
  }
  .tip {
    position: absolute;
    z-index: z(sticky);
    transform: translate(-50%, -100%);
    padding: space(1) + 3 space(3) - 1;
    border-radius: $radius-sm + 2;
    background: var(--text);
    color: var(--card-solid);
    font-size: 12px;
    line-height: 1.4;
    white-space: nowrap;
    pointer-events: none;
    box-shadow: 0 8px 22px rgba(9, 35, 72, 0.25);
    &.l {
      transform: translate(-12px, -100%);
    }
    &.r {
      transform: translate(calc(-100% + 12px), -100%);
    }
    b,
    span {
      display: block;
    }
  }
</style>
