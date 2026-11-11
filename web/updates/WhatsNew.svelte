<script lang="ts">
  import { fade, fly } from "svelte/transition";

  import Icon from "../components/Icon.svelte";
  import InlineMd from "../components/InlineMd.svelte";
  import { face } from "../lib/api.ts";
  import { ms } from "../lib/look.svelte.ts";
  import { releases } from "../lib/releases.svelte.ts";
  import { REL_KIND, relWhen, whatsNew, type Item } from "../lib/releases.ts";
  import type { ChangeItem } from "../lib/types.ts";

  /**
   * What's new: everything since the release you last looked at (or the
   * newest), with the headline change up top and a "Try it" for changes you
   * can go and see. Closing it, any way, marks it seen.
   */
  const info = releases.info!;
  const w = whatsNew(info.releases, releases.seen, releases.whatsNew?.only ?? "");
  const before = document.activeElement as HTMLElement | null;
  let gotIt = $state<HTMLButtonElement>();
  $effect(() => {
    gotIt?.focus();
    return () => before?.focus?.();
  });
  const close = () => releases.closeWhatsNew();
  const eyebrow = !w.top
    ? ""
    : w.top.unreleased
      ? "Coming in the next version"
      : w.show.length > 1
        ? `Since you last looked · ${w.show.length} releases`
        : relWhen(w.top) || "New version";
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  }}
/>

{#snippet tryIt(it: ChangeItem | Item)}
  {#if it.try}<button class="btn small try" onclick={() => releases.go(it.try)}
      >Try it<span aria-hidden="true">→</span></button
    >{/if}
{/snippet}

<!-- a click outside the dialog closes it; Escape does too (see the window handler) -->
<div
  class="wrap"
  role="presentation"
  transition:fade={{ duration: ms(200) }}
  onclick={(e) => {
    if (e.target === e.currentTarget) close();
  }}
>
  <div class="wn" role="dialog" aria-modal="true" aria-label="What's new" transition:fly={{ y: 18, duration: ms(350) }}>
    <button class="btn icon ghost x" aria-label="Close" onclick={close}><Icon name="close" size={18} /></button>
    <div class="scroll">
      <div class="hero">
        <img class="face" src={face("party")} alt="" />
        <div class="hero-text">
          <span class="eyebrow">{eyebrow}</span>
          <h2>{w.show.length > 1 || !w.top ? "What's new in Ferry" : `What's new in Ferry ${w.top.version}`}</h2>
          {#if w.top?.summary}<p>{w.top.summary}</p>{/if}
          <div class="chips">
            {#each w.counts as [k, n] (k)}<span class="chip k-{k}"
                ><Icon name={REL_KIND[k][1]} size={13} />{n} {REL_KIND[k][0].toLowerCase()}</span
              >{/each}
          </div>
        </div>
      </div>
      {#if w.star}
        <div class="star">
          <span class="badge"><Icon name="sparkle" size={14} />Headline</span>
          <h3>{w.star.title}</h3>
          {#if w.star.text}<p><InlineMd text={w.star.text} /></p>{/if}
          {@render tryIt(w.star)}
        </div>
      {/if}
      {#each w.show as r (r.version)}
        {#if w.show.length > 1}<div class="ver">
            <b>{r.version}</b><span>{relWhen(r)}</span>{#if r.summary}<small>{r.summary}</small>{/if}
          </div>{/if}
        {#each w.rest(r) as g (g.kind)}
          {@const [name, ic, tone] = REL_KIND[g.kind]}
          <section class="group">
            <h4>
              <span class="ic t-{tone}"><Icon name={ic} size={14} /></span>{name}<span class="n">{g.items.length}</span>
            </h4>
            <ul>
              {#each g.items as it (it.title)}
                <li class="item">
                  <div class="item-text">
                    <b>{it.title}</b>{#if it.text}<span><InlineMd text={it.text} /></span>{/if}
                  </div>
                  {@render tryIt(it)}
                </li>
              {/each}
            </ul>
          </section>
        {/each}
      {/each}
      {#if !w.total}<div class="empty-row">{w.top?.summary || "No notes for this version yet."}</div>{/if}
    </div>
    <div class="foot">
      <button class="btn small ghost" onclick={() => releases.go("settings-updates")}>All releases</button>
      <span class="grow"></span>
      <button class="btn brand" bind:this={gotIt} onclick={close}>Got it</button>
    </div>
  </div>
</div>

<style lang="scss">
  @use "tokens" as *;
  @use "mixins" as *;
  .wrap {
    position: fixed;
    inset: 0;
    z-index: z(drawer) + 6;
    background: var(--overlay);
    display: grid;
    place-items: center;
    padding: space(5);
  }
  .wn {
    position: relative;
    width: min(720px, 100%);
    max-height: min(86vh, 900px);
    display: flex;
    flex-direction: column;
    background: var(--card-solid);
    border-radius: $radius-xl + 6;
    box-shadow: 0 40px 100px rgba(9, 35, 72, 0.35);
    overflow: hidden;
  }
  .x {
    position: absolute;
    top: space(3) + 2;
    right: space(3) + 2;
    z-index: 2;
  }
  .scroll {
    overflow: auto;
    padding: 0 space(7) space(2) + 2;
  }
  .hero {
    display: flex;
    gap: space(4) + 2;
    align-items: center;
    margin: 0 (-(space(7))) space(4) + 2;
    padding: space(7) + 2 space(7) space(6);
    background:
      radial-gradient(120% 140% at 0% 0%, color-mix(in srgb, var(--accent) 22%, transparent), transparent 60%),
      radial-gradient(100% 120% at 100% 0%, color-mix(in srgb, var(--accent-2) 24%, transparent), transparent 55%),
      var(--card2);
    h2 {
      margin: space(1) 0 space(1) + 2;
      font-size: 26px;
      letter-spacing: -0.02em;
      line-height: 1.15;
    }
    p {
      margin: 0 0 space(2) + 2;
      color: var(--muted);
      font-size: 14.5px;
    }
  }
  .face {
    width: 96px;
    height: 74px;
    flex: none;
    @include motion {
      animation: relay-jump 0.8s cubic-bezier(0.3, 1.4, 0.5, 1) 0.2s backwards;
    }
  }
  .hero-text {
    min-width: 0;
  }
  .eyebrow {
    display: inline-block;
    font-size: 11.5px;
    font-weight: $weight-heavy;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--accent);
  }
  .chips {
    display: flex;
    gap: space(1) + 2;
    flex-wrap: wrap;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px space(2) + 2 3px space(2);
    border-radius: $radius-pill;
    font-size: 12px;
    font-weight: $weight-bold;
    background: var(--card-solid);
    box-shadow: 0 1px 3px rgba(9, 35, 72, 0.08);
    &.k-new :global(svg) {
      color: var(--green);
    }
    &.k-improved :global(svg) {
      color: var(--accent);
    }
    &.k-fixed :global(svg) {
      color: var(--violet);
    }
    &.k-breaking :global(svg) {
      color: var(--red);
    }
  }
  .star {
    position: relative;
    margin-bottom: space(4) + 2;
    padding: space(4) + 2 space(5);
    border-radius: $radius-xl - 2;
    color: #fff;
    @include brand-gradient;
    box-shadow: 0 14px 34px color-mix(in srgb, var(--accent) 30%, transparent);
    overflow: hidden;
    &::after {
      content: "";
      position: absolute;
      right: -40px;
      top: -40px;
      width: 160px;
      height: 160px;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.14);
    }
    h3 {
      margin: space(1) + 2 0 space(1);
      font-size: 19px;
    }
    p {
      margin: 0 0 space(3);
      opacity: 0.95;
      font-size: 14px;
      line-height: 1.5;
      max-width: 560px;
      position: relative;
      z-index: 1;
      :global(code) {
        background: rgba(255, 255, 255, 0.22);
        border-radius: 5px;
        padding: 1px 5px;
      }
    }
    .try {
      background: #fff;
      color: var(--accent);
      position: relative;
      z-index: 1;
    }
  }
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 11px;
    font-weight: $weight-heavy;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    opacity: 0.9;
  }
  .ver {
    display: flex;
    align-items: baseline;
    gap: space(2) + 2;
    flex-wrap: wrap;
    margin: space(5) 0 space(2);
    padding-top: space(3) + 2;
    border-top: 1px solid var(--line);
    b {
      font-size: 16px;
    }
    span {
      color: var(--faint);
      font-size: 12.5px;
    }
    small {
      width: 100%;
      color: var(--muted);
    }
  }
  .group {
    margin-bottom: space(4);
    h4 {
      display: flex;
      align-items: center;
      gap: space(2);
      margin: 0 0 space(1) + 2;
      font-size: 13px;
      font-weight: $weight-heavy;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--muted);
    }
    ul {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
  }
  .ic {
    width: 24px;
    height: 24px;
    border-radius: $radius-sm;
    display: grid;
    place-items: center;
    &.t-green {
      background: var(--green-soft);
      color: var(--green);
    }
    &.t-blue {
      background: var(--accent-soft);
      color: var(--accent);
    }
    &.t-violet {
      background: var(--violet-soft);
      color: var(--violet);
    }
    &.t-red {
      background: var(--red-soft);
      color: var(--red);
    }
    &.t-muted {
      background: var(--card2);
      color: var(--faint);
    }
  }
  .n {
    font-size: 11px;
    color: var(--faint);
    background: var(--card2);
    border-radius: $radius-pill;
    padding: 0 7px;
    letter-spacing: 0;
  }
  .item {
    display: flex;
    align-items: center;
    gap: space(3) + 2;
    padding: space(2) + 2 space(3);
    border-radius: $radius-md + 2;
    &:hover {
      background: var(--card2);
    }
  }
  .item-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
    font-size: 13.5px;
    line-height: 1.5;
    b {
      font-size: 14px;
    }
    span {
      color: var(--muted);
    }
    :global(code) {
      background: var(--card2);
      border-radius: 5px;
      padding: 1px 5px;
      font-size: 12.5px;
    }
  }
  .try {
    flex: none;
    gap: space(1) + 2;
    span {
      @include motion {
        transition: transform 0.15s;
      }
    }
    &:hover span {
      transform: translateX(3px);
    }
  }
  .foot {
    display: flex;
    align-items: center;
    gap: space(2) + 2;
    padding: space(3) + 2 space(5) + 2;
    border-top: 1px solid var(--line);
    .grow {
      flex: 1;
    }
  }
</style>
