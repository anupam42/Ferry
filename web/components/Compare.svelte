<script lang="ts">
  import { fade, scale } from "svelte/transition";

  import { parseDiff, story } from "../lib/diff.ts";
  import { ms } from "../lib/look.svelte.ts";
  import type { FileDiff } from "../lib/types.ts";
  import Icon from "./Icon.svelte";
  import SplitView from "./SplitView.svelte";

  /** The two versions side by side, filling the screen, for a careful compare. Esc closes just this window. */
  let { d, file, onclose }: { d: FileDiff; file: string; onclose: () => void } = $props();
  const st = $derived(story(parseDiff(d.lines), file));
  let starts: HTMLElement[] = $state([]);
  let at = $state(0);
  let scroller: HTMLElement;
  let closeBtn: HTMLButtonElement;

  function go(i: number) {
    if (!starts.length) return;
    at = Math.max(0, Math.min(starts.length - 1, i));
    const top =
      starts[at]!.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 56; // under the sticky header
    scroller.scrollTo({ top, behavior: ms(1) ? "smooth" : "auto" });
  }
  // capture phase, so Esc and J/K don't also reach the drawer underneath
  function key(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onclose();
      return;
    }
    if ((e.target as HTMLElement).closest?.("input, textarea, select")) return;
    if (e.key === "j") {
      e.stopPropagation();
      go(at + 1);
    } else if (e.key === "k") {
      e.stopPropagation();
      go(at - 1);
    }
  }
  $effect(() => {
    const before = document.activeElement as HTMLElement | null;
    closeBtn.focus();
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("keydown", key, true);
      before?.focus?.();
    };
  });
</script>

<div
  class="wrap"
  role="dialog"
  aria-modal="true"
  aria-label="Compare {file}"
  transition:fade={{ duration: ms(160) }}
  onclick={(e) => {
    if (e.target === e.currentTarget) onclose();
  }}
  onkeydown={() => {}}
  tabindex="-1"
>
  <div class="cmp" transition:scale={{ start: 0.985, duration: ms(200) }}>
    <div class="head">
      <div class="title"><b>{file}</b><small>{d.before || "before"} → {d.after || "after"}</small></div>
      <div class="chips">
        {#if st.added}<span class="pill green">+ {st.added}</span>{/if}
        {#if st.edited}<span class="pill amber">✎ {st.edited}</span>{/if}
        {#if st.removed}<span class="pill red">− {st.removed}</span>{/if}
      </div>
      <div class="grow"></div>
      {#if starts.length}
        <span class="muted count">Change {at + 1} of {starts.length}</span>
        <button class="btn small" disabled={at === 0} onclick={() => go(at - 1)}>↑ Previous</button>
        <button class="btn small primary" disabled={at === starts.length - 1} onclick={() => go(at + 1)}
          >Next change ↓</button
        >
      {/if}
      <button
        class="btn small ghost"
        bind:this={closeBtn}
        aria-label="Close the big window"
        title="Close (Esc)"
        onclick={onclose}><Icon name="shrink" size={18} /></button
      >
    </div>
    <div class="body" bind:this={scroller}><SplitView {d} {at} bind:starts /></div>
    <div class="foot muted">
      Drag the divider to resize · ←/→ when it's focused · double-click it to keep the left side · J/K jump between
      changes · Esc closes
    </div>
  </div>
</div>

<style lang="scss">
  @use "tokens" as *;
  @use "mixins" as *;

  .wrap {
    position: fixed;
    inset: 0;
    z-index: z(ask) - 5;
    background: var(--overlay);
    display: grid;
    padding: space(3) + 2;
  }
  .cmp {
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--card-solid);
    border-radius: $radius-xl;
    box-shadow: 0 30px 80px rgba(9, 35, 72, 0.35);
    overflow: hidden;
  }
  .head {
    display: flex;
    align-items: center;
    gap: space(3);
    flex-wrap: wrap;
    padding: space(3) + 2 space(4) + 2;
    border-bottom: 1px solid var(--line);
  }
  .title {
    display: flex;
    flex-direction: column;
    min-width: 0;
    b {
      font-size: 16px;
      @include ellipsis;
    }
    small {
      color: var(--faint);
      font-size: fs(sm);
    }
  }
  .chips {
    display: flex;
    gap: space(1) + 2;
    margin: 0;
  }
  .grow {
    flex: 1;
  }
  .count {
    font-size: 13px;
    white-space: nowrap;
  }
  .body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: space(3);
    background: var(--card2);
    :global(.sx) {
      padding: 0;
      background: none;
    }
    :global(.c) {
      font-size: 13px;
    }
  }
  .foot {
    padding: space(2) space(4) + 2;
    font-size: 12px;
    border-top: 1px solid var(--line);
  }
</style>
