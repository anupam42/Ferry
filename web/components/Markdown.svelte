<script lang="ts">
  import { token, enc } from "../lib/api.ts";
  import { imagePath, linkTarget, parseMarkdown, type Block, type ImgRef, type Inline } from "../lib/markdown.ts";
  import Markdown from "./Markdown.svelte";

  /**
   * Markdown, rendered with ordinary elements (see lib/markdown.ts). Images and
   * links inside the repository load through fileURL (when given) and openFile.
   */
  let { text = "", blocks, base = "", fileURL, openFile }: {
    text?: string; blocks?: Block[]; base?: string;
    /** the URL for a repository file's raw bytes (README images); without it, only web images show */
    fileURL?: (path: string) => string;
    openFile?: (path: string) => void;
  } = $props();
  const tree = $derived(blocks ?? parseMarkdown(text));
  const src = (url: string) => {
    const p = imagePath(url, base);
    if (!p) return null;
    if ("web" in p) return p.web;
    return fileURL ? fileURL(p.repo) + (token ? "&token=" + enc(token) : "") : null;
  };
</script>

{#snippet img(i: ImgRef)}
  {@const s = src(i.src)}
  {#if s}<img class="md-img" src={s} alt={i.alt} width={i.width} />{/if}
{/snippet}

{#snippet inline(kids: Inline[])}
  {#each kids as k, n (n)}
    {#if k.t === "text"}{k.v}
    {:else if k.t === "code"}<code>{k.v}</code>
    {:else if k.t === "strong"}<strong>{k.v}</strong>
    {:else if k.t === "em"}<em>{k.v}</em>
    {:else if k.t === "img"}{@const s = src(k.src)}{#if s}<img class="md-img" src={s} alt={k.alt} />{:else}{k.alt}{/if}
    {:else if k.t === "link"}
      {@const to = linkTarget(k.href)}
      {#if to && "web" in to}<a href={to.web} target="_blank" rel="noopener noreferrer">{@render inline(k.kids)}</a>
      {:else if to && "anchor" in to}<a href={to.anchor}>{@render inline(k.kids)}</a>
      {:else if to && "repo" in to && openFile}<a href="#{to.repo}" onclick={(e) => { e.preventDefault(); openFile(to.repo); }}>{@render inline(k.kids)}</a>
      {:else}<span>{@render inline(k.kids)}</span>{/if}
    {/if}
  {/each}
{/snippet}

<div class="md">
  {#each tree as b, n (n)}
    {#if b.t === "p"}<p>{@render inline(b.kids)}</p>
    {:else if b.t === "h"}<svelte:element this={"h" + Math.min(6, b.level)}>{@render inline(b.kids)}</svelte:element>
    {:else if b.t === "pre"}<pre class="mono">{b.v}</pre>
    {:else if b.t === "hr"}<hr />
    {:else if b.t === "quote"}<blockquote><Markdown blocks={b.kids} {base} {fileURL} {openFile} /></blockquote>
    {:else if b.t === "list"}
      <svelte:element this={b.ordered ? "ol" : "ul"}>
        {#each b.items as it, j (j)}
          <li class:task={it.task !== null}>{#if it.task !== null}<input type="checkbox" disabled checked={it.task} />{/if}{@render inline(it.kids)}</li>
        {/each}
      </svelte:element>
    {:else if b.t === "img"}{@render img(b.img)}
    {:else if b.t === "picture"}
      {@const s = src(b.img.src)}
      {#if s}<picture>{#each b.sources as so, j (j)}{@const ss = src(so.srcset)}{#if ss}<source srcset={ss} media={so.media || undefined} />{/if}{/each}<img class="md-img" src={s} alt={b.img.alt} width={b.img.width} /></picture>{/if}
    {/if}
  {/each}
</div>

<style lang="scss">
  @use "tokens" as *;

  .md { line-height: 1.6; overflow-wrap: anywhere;
    :global(h1), :global(h2) { font-size: fs(xl); margin: space(4) 0 space(2); padding-bottom: space(1); border-bottom: 1px solid var(--line); }
    :global(h2) { font-size: fs(lg) + 2; }
    :global(h3), :global(h4), :global(h5), :global(h6) { font-size: fs(md) + 1; margin: space(3) 0 space(1); }
    :global(p) { margin: 0 0 space(3); }
    :global(code) { font-family: $font-mono; font-size: .9em; padding: 1px 5px; border-radius: 5px; background: var(--card2); }
    :global(pre) { margin: 0 0 space(3); padding: space(3); border-radius: $radius-md; background: var(--card2); overflow-x: auto; white-space: pre; font-size: fs(sm); }
    :global(blockquote) { margin: 0 0 space(3); padding: 0 space(3); border-left: 3px solid var(--line); color: var(--muted); }
    :global(ul), :global(ol) { margin: 0 0 space(3); padding-left: space(6); }
    :global(li.task) { list-style: none; margin-left: -18px; }
    :global(li.task input) { margin-right: space(2); }
    :global(hr) { border: 0; border-top: 1px solid var(--line); margin: space(4) 0; }
    :global(.md-img) { max-width: 100%; height: auto; vertical-align: middle; margin: 2px; }
    :global(> :first-child) { margin-top: 0; }
  }
</style>
