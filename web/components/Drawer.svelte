<script lang="ts">
  import type { Snippet } from "svelte";
  import { fade, fly } from "svelte/transition";

  import { ms } from "../lib/look.svelte.ts";
  import Icon from "./Icon.svelte";

  /**
   * A panel that slides in from the right. Its left edge drags to resize (or
   * ←/→ on it); double-click it, or the maximize button, to fill the window.
   * Wide drawers (diffs) and narrow ones each remember their own width.
   */
  let {
    title,
    sub = "",
    wide = false,
    onclose,
    children,
    foot,
  }: {
    title: string;
    sub?: string;
    wide?: boolean;
    onclose: () => void;
    children: Snippet;
    foot?: Snippet;
  } = $props();

  let panel: HTMLElement;
  const before = document.activeElement as HTMLElement | null;
  // a drawer doesn't change between narrow and wide while it's open: read it once
  const key = (() => "ferry-drawer-w" + (wide ? "-wide" : ""))();
  const MIN = 380;
  const maxW = () => window.innerWidth - 24;
  let width = $state(+(localStorage.getItem(key) || 0));
  let back = 0; // the width to return to after filling the window
  const maxed = $derived(width > 0 && width >= maxW() - 2);

  function setW(w: number, save = true) {
    width = Math.round(Math.min(maxW(), Math.max(MIN, w)));
    if (save) localStorage.setItem(key, String(width));
  }
  function toggleMax() {
    if (maxed) setW(back || (wide ? 900 : 560));
    else {
      back = panel.getBoundingClientRect().width;
      setW(maxW(), false);
    }
  }
  function gripKey(e: KeyboardEvent) {
    const w = panel.getBoundingClientRect().width;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      setW(w + 40);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      setW(w - 40);
    } else if (e.key === "Enter") {
      e.preventDefault();
      toggleMax();
    }
  }
  let resizing = $state(false);
  function gripDown(e: PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    const grip = e.currentTarget as HTMLElement;
    try {
      grip.setPointerCapture(e.pointerId);
    } catch {}
    resizing = true;
    const right = window.innerWidth - panel.getBoundingClientRect().right;
    const move = (ev: PointerEvent) => setW(window.innerWidth - right - ev.clientX, false);
    const up = () => {
      resizing = false;
      localStorage.setItem(key, String(Math.round(panel.getBoundingClientRect().width)));
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", up);
      grip.removeEventListener("pointercancel", up);
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up);
    grip.addEventListener("pointercancel", up);
  }

  $effect(() => {
    // the panel itself, not its first button: that could be Disconnect or Delete
    panel.focus({ preventScroll: true });
    return () => before?.focus?.({ preventScroll: true });
  });

  function keydown(e: KeyboardEvent) {
    // a question from Relay, or the big compare window, handles its own Escape
    if (e.key === "Escape" && !document.querySelector('[role="alertdialog"], .cmp')) {
      e.stopPropagation();
      onclose();
    }
  }
</script>

<svelte:window onkeydown={keydown} />

<div class="scrim" transition:fade={{ duration: ms(160) }} onclick={onclose} aria-hidden="true"></div>
<div
  class="drawer"
  class:wide
  class:resizing
  bind:this={panel}
  role="dialog"
  aria-modal="true"
  aria-label={title}
  tabindex="-1"
  style:width={width ? width + "px" : null}
  transition:fly={{ x: 40, duration: ms(220) }}
>
  <!-- a focusable separator is a resize handle (ARIA "window splitter"): it takes keys and the pointer -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
  <div
    class="grip"
    role="separator"
    tabindex="0"
    aria-orientation="vertical"
    aria-label="Resize the panel: drag, or use the arrow keys. Double-click to fill the window."
    onpointerdown={gripDown}
    onkeydown={gripKey}
    ondblclick={toggleMax}
  ></div>
  <header>
    <div class="titles">
      <h2>{title}</h2>
      {#if sub}<small>{sub}</small>{/if}
    </div>
    <button
      class="round"
      onclick={toggleMax}
      aria-label={maxed ? "Back to the usual size" : "Fill the window"}
      title={maxed ? "Back to the usual size" : "Fill the window"}
    >
      <Icon name={maxed ? "shrink" : "expand"} size={18} />
    </button>
    <button class="round close" onclick={onclose} aria-label="Close"><Icon name="close" /></button>
  </header>
  <div class="body">{@render children()}</div>
  {#if foot}<footer>{@render foot()}</footer>{/if}
</div>

<style lang="scss">
  @use "tokens" as *;
  @use "mixins" as *;

  .scrim {
    position: fixed;
    inset: 0;
    background: var(--overlay);
    z-index: z(drawer);
  }
  .drawer {
    position: fixed;
    top: space(3);
    right: space(3);
    bottom: space(3);
    z-index: z(drawer) + 1;
    width: min(560px, calc(100vw - #{space(6)}));
    max-width: calc(100vw - #{space(6)});
    display: flex;
    flex-direction: column;
    background: var(--card-solid);
    border-radius: $radius-xl + 4;
    box-shadow: var(--shadow);
    &.wide {
      width: min(980px, calc(100vw - #{space(6)}));
    }
    &:focus {
      outline: none;
    }
    &.resizing {
      user-select: none;
      :global(*) {
        cursor: ew-resize !important;
      }
    }
  }
  .grip {
    position: absolute;
    left: -6px;
    top: 28px;
    bottom: 28px;
    width: 12px;
    cursor: ew-resize;
    z-index: 2;
    touch-action: none;
    outline: none;
    &::before {
      content: "";
      position: absolute;
      left: 4px;
      top: 50%;
      height: 48px;
      margin-top: -24px;
      width: 4px;
      border-radius: $radius-pill;
      background: var(--faint);
      opacity: 0;
      @include motion {
        transition:
          opacity 0.15s,
          height 0.2s,
          margin-top 0.2s,
          background 0.15s;
      }
    }
    &:hover::before,
    &:focus-visible::before {
      opacity: 1;
      background: var(--accent);
      height: 100%;
      margin-top: 0;
      top: 0;
    }
  }
  header {
    display: flex;
    align-items: flex-start;
    gap: space(2) + 2;
    padding: space(4) + 2 space(5) + 2;
    border-bottom: 1px solid var(--line);
    h2 {
      font-size: fs(lg) + 2;
    }
    small {
      color: var(--muted);
      font-size: fs(sm) + 1;
    }
  }
  .titles {
    min-width: 0;
    flex: 1;
    h2 {
      @include ellipsis;
    }
  }
  .round {
    width: 40px;
    height: 40px;
    flex: none;
    border-radius: 50%;
    border: 2px solid transparent;
    background: none;
    color: var(--text);
    display: grid;
    place-items: center;
    cursor: pointer;
    &:hover {
      background: var(--card2);
    }
    &.close {
      border-color: var(--accent);
    }
  }
  .body {
    padding: space(4) + 2 space(5) + 2;
    overflow: auto;
    flex: 1;
  }
  footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: space(2) + 2;
    flex-wrap: wrap;
    padding: space(3) + 2 space(5) + 2;
    border-top: 1px solid var(--line);
    :global(.left) {
      margin-right: auto;
    }
  }
</style>
