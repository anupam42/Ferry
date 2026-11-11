<script lang="ts">
  import { api } from "../lib/api.ts";
  import { fileSize } from "../lib/files.ts";
  import { git } from "../lib/git.svelte.ts";
  import type { LanguageShare } from "../lib/types.ts";

  /**
   * How much of the repository each language makes up, like GitHub's language
   * bar: committed code and markup only (no JSON, YAML or Markdown, nothing
   * vendored or generated). Nothing shows when there's no code to count.
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
</script>

{#if langs?.length}
  <section class="card langs" aria-labelledby="langs-title">
    <h3 id="langs-title">Languages</h3>
    <div class="bar" role="img" aria-label="Languages: {label}">
      {#each langs as l (l.name)}
        <span
          class="seg"
          class:dark={dark(l.color)}
          style:flex-grow={l.share}
          style:--c={l.color}
          title="{l.name}: {pct(l.share)} ({fileSize(l.bytes)})"
        ></span>
      {/each}
    </div>
    <ul class="legend">
      {#each langs as l (l.name)}
        <li title={fileSize(l.bytes)}>
          <i class:dark={dark(l.color)} style:--c={l.color}></i><b>{l.name}</b><span>{pct(l.share)}</span>
        </li>
      {/each}
    </ul>
  </section>
{/if}

<style lang="scss">
  @use "tokens" as *;
  .langs {
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
  }
  .seg {
    min-width: 3px;
    flex-basis: 0;
  }
  .seg,
  .legend i {
    background: var(--c);
  }
  :global([data-theme="dark"]) .dark {
    background: color-mix(in srgb, var(--c) 45%, #fff);
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: space(2) space(5);
    list-style: none;
    margin: space(3) 0 0;
    padding: 0;
    font-size: 13px;
    li {
      display: inline-flex;
      align-items: center;
      gap: space(2) - 2;
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
</style>
