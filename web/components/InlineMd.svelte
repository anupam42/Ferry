<script lang="ts">
  import { linkTarget, parseInline, type Inline } from "../lib/markdown.ts";

  /** One line of markdown (code, bold, italic, web links), inline: for release notes and short texts. */
  let { text }: { text: string } = $props();
  const kids = $derived(parseInline(text));
</script>

{#snippet run(list: Inline[])}
  {#each list as k, i (i)}
    {#if k.t === "text"}{k.v}
    {:else if k.t === "code"}<code>{k.v}</code>
    {:else if k.t === "strong"}<strong>{k.v}</strong>
    {:else if k.t === "em"}<em>{k.v}</em>
    {:else if k.t === "img"}{k.alt}
    {:else}
      {@const to = linkTarget(k.href)}
      {#if to && "web" in to}<a href={to.web} target="_blank" rel="noopener noreferrer">{@render run(k.kids)}</a
        >{:else}{@render run(k.kids)}{/if}
    {/if}
  {/each}
{/snippet}

{@render run(kids)}
