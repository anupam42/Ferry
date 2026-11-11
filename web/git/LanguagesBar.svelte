<script lang="ts">
  import { fade } from "svelte/transition";

  import { api } from "../lib/api.ts";
  import { fileSize } from "../lib/files.ts";
  import { plural } from "../lib/format.ts";
  import { git } from "../lib/git.svelte.ts";
  import { ms } from "../lib/look.svelte.ts";
  import type { LanguageShare } from "../lib/types.ts";

  /**
   * How much of the repository each language makes up, like GitHub's language
   * bar: committed code and markup only (no JSON, YAML or Markdown, nothing
   * vendored or generated). The segments grow in one after another; pointing
   * at a segment or a name (or tabbing to a name) shows its share, size and
   * file count, and fades the rest. Nothing shows when there's no code to count.
   */
  let langs = $state<LanguageShare[] | null>(null);
  $effect(() => {
    void git.bump;
    void git.selected;
    api<LanguageShare[]>("GET", git.url("languages")).then(
      (r) => (langs = r),
      () => (langs = []),
    );
  });

  // grow in once there's something to show: two frames later, so the empty bar is drawn first
  // and the transition has somewhere to start from (one frame isn't enough: it runs before that paint)
  let grown = $state(false);
  $effect(() => {
    if (!langs?.length || grown) return;
    let f = requestAnimationFrame(() => (f = requestAnimationFrame(() => (grown = true))));
    return () => cancelAnimationFrame(f);
  });

  /**
   * Some language colours are nearly black (PowerShell, Crystal, Lua): fine on a
   * light page, invisible on a dark one. Those get lightened in dark mode.
   */
  const dark = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!) < 0.05;
  };
  /** 59.9%, and "<0.1%" for slivers, as GitHub writes them. */
  const pct = (s: number) => (s < 0.001 ? "<0.1%" : (s * 100).toFixed(1) + "%");
  const label = $derived(langs?.map((l) => `${l.name} ${pct(l.share)}`).join(", ") ?? "");

  // the language being pointed at, and where its tooltip goes (the middle of its segment)
  let card = $state<HTMLElement>();
  const segs: HTMLElement[] = $state([]);
  let hot = $state<{ i: number; x: number; y: number; arrow: number } | null>(null);
  function point(i: number) {
    const s = segs[i];
    if (!s || !card) return;
    const c = card.getBoundingClientRect(),
      r = s.getBoundingClientRect();
    const at = r.left - c.left + r.width / 2;
    // the box stays inside the card; its arrow still points at the segment
    const x = Math.max(90, Math.min(c.width - 90, at));
    hot = { i, x, y: r.top - c.top, arrow: at - x };
  }
  const leave = () => (hot = null);
</script>

{#if langs?.length}
  <section class="card langs" class:grown aria-labelledby="langs-title" bind:this={card}>
    <h3 id="langs-title">Languages</h3>
    <div class="bar" class:pointing={!!hot} role="img" aria-label="Languages: {label}" onpointerleave={leave}>
      {#each langs as l, i (l.name)}
        <!-- svelte-ignore a11y_no_static_element_interactions (pointer only; the names below give keyboards the same tooltip) -->
        <span
          bind:this={segs[i]}
          class="seg"
          class:hot={hot?.i === i}
          class:dark={dark(l.color)}
          style:flex-grow={grown ? l.share : 0}
          style:--c={l.color}
          style:--i={i}
          onpointerenter={() => point(i)}
        ></span>
      {/each}
    </div>
    <ul class="legend" class:pointing={!!hot}>
      {#each langs as l, i (l.name)}
        <li style:--i={i} class:hot={hot?.i === i}>
          <button
            type="button"
            onpointerenter={() => point(i)}
            onpointerleave={leave}
            onfocus={() => point(i)}
            onblur={leave}
            aria-label="{l.name}: {pct(l.share)}, {fileSize(l.bytes)}, {plural(l.files, 'file')}"
          >
            <i class:dark={dark(l.color)} style:--c={l.color}></i><b>{l.name}</b><span>{pct(l.share)}</span>
          </button>
        </li>
      {/each}
    </ul>
    {#if hot && langs[hot.i]}
      {@const l = langs[hot.i]!}
      <div
        class="tip"
        role="tooltip"
        style:left="{hot.x}px"
        style:top="{hot.y}px"
        style:--arrow="{hot.arrow}px"
        transition:fade={{ duration: ms(120) }}
      >
        <span class="tip-head"><i class:dark={dark(l.color)} style:--c={l.color}></i><b>{l.name}</b></span>
        <span><b>{pct(l.share)}</b> of the code</span>
        <span class="muted">{fileSize(l.bytes)} · {plural(l.files, "file")}</span>
      </div>
    {/if}
  </section>
{/if}

<style lang="scss">
  @use "tokens" as *;
  @use "mixins" as *;
  .langs {
    position: relative;
    padding: space(4) space(5);
    margin-top: space(4);
  }
  h3 {
    font-size: 15px;
    margin: 0 0 space(3);
  }
  .bar {
    display: flex;
    gap: 2px;
    height: 8px;
    border-radius: $radius-pill;
    overflow: hidden;
    background: var(--heat-0);
  }
  .seg {
    flex-basis: 0;
    min-width: 0;
    cursor: default;
    @include motion {
      transition:
        flex-grow 700ms $ease-out calc(var(--i) * 70ms),
        min-width 700ms $ease-out calc(var(--i) * 70ms),
        opacity $duration-fast;
    }
  }
  .grown .seg {
    min-width: 3px;
  }
  .seg,
  .legend i,
  .tip i {
    background: var(--c);
  }
  :global([data-theme="dark"]) .dark {
    background: color-mix(in srgb, var(--c) 45%, #fff);
  }
  // pointing at one: the others step back
  .pointing .seg:not(.hot),
  .legend.pointing li:not(.hot) {
    opacity: 0.35;
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: space(1) space(3);
    list-style: none;
    margin: space(3) 0 0;
    padding: 0;
    font-size: 13px;
    li {
      @include motion {
        transition: opacity $duration-fast;
        animation: rise 400ms $ease-out calc(200ms + var(--i) * 50ms) backwards;
      }
    }
    button {
      display: inline-flex;
      align-items: center;
      gap: space(2) - 2;
      border: 0;
      background: none;
      padding: 2px space(1);
      border-radius: $radius-sm;
      color: var(--text);
      font: inherit;
      cursor: default;
      &:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 1px;
      }
    }
    i {
      width: 9px;
      height: 9px;
      border-radius: 50%;
      flex: none;
    }
    b {
      font-weight: $weight-semibold;
    }
    span {
      color: var(--muted);
    }
  }
  .tip {
    position: absolute;
    z-index: z(sticky);
    transform: translate(-50%, calc(-100% - 10px));
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: space(2) space(3);
    border-radius: $radius-md;
    background: var(--text);
    color: var(--card-solid);
    font-size: 12.5px;
    line-height: 1.4;
    white-space: nowrap;
    pointer-events: none;
    box-shadow: 0 8px 22px rgba(9, 35, 72, 0.25);
    &::after {
      content: "";
      position: absolute;
      left: calc(50% + var(--arrow, 0px));
      bottom: -5px;
      width: 10px;
      height: 10px;
      margin-left: -5px;
      background: inherit;
      transform: rotate(45deg);
      border-radius: 2px;
    }
    .muted {
      color: color-mix(in srgb, var(--card-solid) 70%, transparent);
    }
    i {
      width: 9px;
      height: 9px;
      border-radius: 50%;
      flex: none;
      box-shadow: 0 0 0 1.5px color-mix(in srgb, var(--card-solid) 60%, transparent);
    }
  }
  .tip i.dark {
    background: color-mix(in srgb, var(--c) 45%, #fff);
  }
  .tip-head {
    display: inline-flex;
    align-items: center;
    gap: space(2) - 2;
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
  }
</style>
