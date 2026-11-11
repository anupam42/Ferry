<script lang="ts">
  import { splitRows, type Part } from "../lib/diff.ts";
  import type { FileDiff } from "../lib/types.ts";

  /**
   * Before on the left, after on the right, row-aligned. The divider drags (or
   * ←/→ when focused; Enter evens it out); its handle closes one side, and a
   * double-click keeps the left one. starts: the first row of each change, for J/K.
   */
  let { d, at = -1, starts = $bindable([]) }: { d: FileDiff; at?: number; starts?: HTMLElement[] } = $props();
  const rows = $derived(splitRows(d.lines));
  const startIndex = $derived(
    rows.reduce<number[]>((acc, r, i) => (r.kind === "row" && r.start ? [...acc, i] : acc), []),
  );
  let rowEls: HTMLElement[] = $state([]);
  $effect(() => {
    starts = startIndex.map((i) => rowEls[i]!).filter(Boolean);
  });

  let split = $state(Math.min(80, Math.max(20, +(localStorage.getItem("ferry-split") || 50))));
  let keep = $state<"" | "l" | "r">("");
  let preview = $state<"" | "l" | "r">("");
  let dragging = $state(false);
  let inner: HTMLElement;
  let divider: HTMLElement;
  const set = (v: number, save = true) => {
    split = Math.min(80, Math.max(20, Math.round(v)));
    if (save) localStorage.setItem("ferry-split", String(split));
  };

  function key(e: KeyboardEvent) {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      set(split - 5);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      set(split + 5);
    } else if (e.key === "Enter" || e.key === "Home") {
      e.preventDefault();
      set(50);
    }
  }
  function down(e: PointerEvent) {
    if ((e.target as HTMLElement).closest(".half") || e.button !== 0) return;
    e.preventDefault();
    try {
      divider.setPointerCapture(e.pointerId);
    } catch {}
    dragging = true;
    const r = inner.getBoundingClientRect();
    const move = (ev: PointerEvent) => set(((ev.clientX - r.left) / r.width) * 100, false);
    const up = () => {
      dragging = false;
      localStorage.setItem("ferry-split", String(split));
      divider.removeEventListener("pointermove", move);
      divider.removeEventListener("pointerup", up);
      divider.removeEventListener("pointercancel", up);
    };
    divider.addEventListener("pointermove", move);
    divider.addEventListener("pointerup", up);
    divider.addEventListener("pointercancel", up);
  }
  const close = (side: "l" | "r") => {
    keep = side === "l" ? "r" : "l";
    preview = "";
  };
</script>

{#snippet text(t: string, parts: Part[] | undefined, tag: "ins" | "del")}
  {#if parts}{#each parts as p, i (i)}{#if p.op === ""}{p.t}{:else if tag === "ins"}<ins class="w">{p.t}</ins
        >{:else}<del class="w">{p.t}</del>{/if}{/each}{:else}{t || " "}{/if}
{/snippet}

<div
  class="sx"
  class:keep-l={keep === "l"}
  class:keep-r={keep === "r"}
  class:pv-l={preview === "l"}
  class:pv-r={preview === "r"}
  class:dragging
  style:--split="{split}%"
>
  <div class="inner" bind:this={inner}>
    <div class="head">
      <div class="hl"><b>Before</b><small>{d.before || ""}</small></div>
      <div class="hr"><b>After</b><small>{d.after || ""}</small></div>
    </div>
    {#each rows as r, i (i)}
      {#if r.kind === "hunk"}
        <div class="hunk"><span>line {r.line}</span>{r.text}</div>
      {:else}
        <div class="row" class:on={r.start && startIndex.indexOf(i) === at} bind:this={rowEls[i]}>
          <div class="c l {r.left.type}">
            <span class="no">{r.left.no ?? ""}</span><span class="t"
              >{@render text(r.left.text, r.left.parts, "del")}</span
            >
          </div>
          <div class="c r {r.right.type}">
            <span class="no">{r.right.no ?? ""}</span><span class="t"
              >{@render text(r.right.text, r.right.parts, "ins")}</span
            >
          </div>
        </div>
      {/if}
    {/each}
    <!-- a focusable separator is a resize handle (ARIA "window splitter"): it takes keys and the pointer -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
    <div
      class="div"
      bind:this={divider}
      role="separator"
      tabindex="0"
      aria-orientation="vertical"
      aria-valuemin={20}
      aria-valuemax={80}
      aria-valuenow={split}
      aria-label="Resize: drag, or use the arrow keys. Double-click to keep the before panel."
      onkeydown={key}
      onpointerdown={down}
      ondblclick={() => (keep = "l")}
    >
      <div class="handle-track">
        <div class="handle">
          <button
            type="button"
            class="half"
            aria-label="Close the before panel"
            title="Close the before panel"
            onclick={(e) => {
              e.stopPropagation();
              close("l");
            }}
            onmouseenter={() => (preview = "l")}
            onmouseleave={() => (preview = "")}
            onfocus={() => (preview = "l")}
            onblur={() => (preview = "")}><span class="arrow to-l"></span></button
          >
          <span class="grip" aria-hidden="true"></span>
          <button
            type="button"
            class="half"
            aria-label="Close the after panel"
            title="Close the after panel"
            onclick={(e) => {
              e.stopPropagation();
              close("r");
            }}
            onmouseenter={() => (preview = "r")}
            onmouseleave={() => (preview = "")}
            onfocus={() => (preview = "r")}
            onblur={() => (preview = "")}><span class="arrow to-r"></span></button
          >
        </div>
      </div>
    </div>
  </div>
  <button
    type="button"
    class="reopen reopen-l"
    onclick={() => {
      keep = "";
      divider.focus();
    }}>◂ Show before</button
  >
  <button
    type="button"
    class="reopen reopen-r"
    onclick={() => {
      keep = "";
      divider.focus();
    }}>Show after ▸</button
  >
</div>

<style lang="scss">
  @use "tokens" as *;
  @use "mixins" as *;

  .sx {
    position: relative;
    border-radius: $radius-lg;
    background: var(--card2);
    padding: space(2) + 2;
  }
  .inner {
    position: relative;
    border-radius: $radius-md;
    overflow: clip;
    background: var(--card-solid);
    box-shadow: 0 1px 3px rgba(9, 35, 72, 0.06);
  }
  .head,
  .row {
    display: grid;
    grid-template-columns: minmax(0, var(--split)) minmax(0, 1fr);
  }
  .head {
    position: sticky;
    top: 0;
    z-index: 3;
    background: var(--card-solid);
    border-bottom: 1px solid var(--line);
    b {
      font-size: 13.5px;
    }
    small {
      color: var(--faint);
      font-size: 12px;
      @include ellipsis;
    }
  }
  .hl,
  .hr {
    display: flex;
    align-items: baseline;
    gap: space(2);
    padding: space(2) + 2 space(4);
    min-width: 0;
  }
  .hl {
    padding-right: 22px;
    b {
      color: var(--red);
    }
  }
  .hr {
    padding-left: 22px;
    b {
      color: var(--green);
    }
  }
  .c {
    display: flex;
    min-width: 0;
    font-family: $font-mono;
    font-size: fs(sm);
    line-height: 1.6;
    @include motion {
      transition:
        opacity 0.15s,
        filter 0.15s;
    }
  }
  .l {
    padding-right: space(3);
  }
  .r {
    padding-left: space(3);
  }
  .no {
    flex: none;
    width: 46px;
    padding-right: space(2) + 2;
    text-align: right;
    color: var(--faint);
    user-select: none;
  }
  .t {
    flex: 1;
    min-width: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    padding-right: space(2) + 2;
  }
  .c.del {
    background: var(--del);
    .t {
      color: var(--del-text);
    }
  }
  .c.add {
    background: var(--ins);
    .t {
      color: var(--ins-text);
    }
  }
  .c.gap {
    background: repeating-linear-gradient(
      135deg,
      transparent 0 6px,
      color-mix(in srgb, var(--muted) 8%, transparent) 6px 7px
    );
  }
  .c :global(ins.w),
  .c :global(del.w) {
    text-decoration: none;
    border-radius: 3px;
    padding: 0 1px;
    color: inherit;
    font-weight: inherit;
  }
  .c :global(ins.w) {
    background: color-mix(in srgb, var(--green) 30%, transparent);
  }
  .c :global(del.w) {
    background: color-mix(in srgb, var(--red) 28%, transparent);
  }
  .row.on .c:not(.gap) {
    box-shadow: inset 0 1px 0 var(--accent);
  }
  .hunk {
    display: flex;
    gap: space(2) + 2;
    align-items: center;
    padding: 5px space(4);
    font-size: 12px;
    color: var(--muted);
    background: var(--card2);
    border-block: 1px solid var(--line);
    font-family: $font-mono;
    span {
      font-weight: $weight-bold;
      color: var(--accent);
    }
  }
  .div {
    position: absolute;
    top: 0;
    bottom: 0;
    left: var(--split);
    width: 18px;
    margin-left: -9px;
    z-index: 4;
    cursor: col-resize;
    touch-action: none;
    outline: none;
    &::before {
      content: "";
      position: absolute;
      left: 8px;
      top: 0;
      bottom: 0;
      width: 2px;
      background: var(--line);
      @include motion {
        transition:
          background 0.15s,
          width 0.15s,
          left 0.15s;
      }
    }
    &:hover::before,
    &:focus-visible::before {
      left: 7px;
      width: 4px;
      background: var(--accent);
    }
    &:hover .handle,
    &:focus-within .handle {
      width: 64px;
      margin-left: -23px;
    }
    &:hover .half,
    &:focus-within .half {
      opacity: 1;
    }
    &:hover .grip,
    &:focus-within .grip {
      opacity: 0;
    }
  }
  .dragging .div::before {
    left: 7px;
    width: 4px;
    background: var(--accent);
  }
  .handle-track {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .handle {
    position: sticky;
    top: calc(50% - 22px);
    margin-top: 60px;
    margin-left: -12px;
    width: 42px;
    height: 44px;
    display: flex;
    align-items: center;
    pointer-events: auto;
    border-radius: $radius-pill;
    background: var(--card-solid);
    box-shadow: 0 2px 10px rgba(9, 35, 72, 0.18);
    overflow: hidden;
    @include motion {
      transition:
        width 0.15s,
        margin-left 0.15s;
    }
  }
  .half {
    flex: 1;
    height: 100%;
    border: 0;
    background: none;
    cursor: pointer;
    display: grid;
    place-items: center;
    color: var(--muted);
    opacity: 0;
    @include motion {
      transition:
        opacity 0.15s,
        background 0.15s,
        color 0.15s;
    }
    &:hover,
    &:focus-visible {
      background: var(--red-soft);
      color: var(--red);
      outline: none;
    }
  }
  .arrow {
    width: 0;
    height: 0;
    border-block: 5px solid transparent;
    &.to-l {
      border-right: 6px solid currentColor;
    }
    &.to-r {
      border-left: 6px solid currentColor;
    }
  }
  .grip {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    width: 12px;
    height: 14px;
    pointer-events: none;
    background: radial-gradient(circle, var(--faint) 1.2px, transparent 1.4px) 0 0 / 6px 5px;
  }
  .dragging,
  .dragging :global(*) {
    cursor: col-resize !important;
    user-select: none;
  }
  .pv-l .l,
  .pv-r .r {
    opacity: 0.35;
    filter: grayscale(1);
  }
  .pv-l .hl::after,
  .pv-r .hr::after {
    content: "closes";
    margin-left: auto;
    font-size: 11px;
    font-weight: $weight-bold;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--red);
    background: var(--red-soft);
    padding: 2px space(2);
    border-radius: $radius-pill;
  }
  .keep-l,
  .keep-r {
    .head,
    .row {
      grid-template-columns: minmax(0, 1fr);
    }
    .div {
      display: none;
    }
  }
  .keep-l {
    .r,
    .hr {
      display: none;
    }
    .l {
      padding: 0;
    }
    .row:has(> .l.gap) {
      display: none;
    }
    .hl {
      padding-right: 120px;
    }
  }
  .keep-r {
    .l,
    .hl {
      display: none;
    }
    .r {
      padding: 0;
    }
    .row:has(> .r.gap) {
      display: none;
    }
    .hr {
      padding-left: 120px;
    }
  }
  .reopen {
    display: none;
    position: absolute;
    top: 18px;
    z-index: 5;
    border: 1px solid var(--line);
    background: var(--card-solid);
    color: var(--accent);
    font-weight: $weight-bold;
    font-size: fs(sm);
    padding: space(1) + 2 space(3);
    border-radius: $radius-pill;
    cursor: pointer;
    box-shadow: 0 4px 12px rgba(9, 35, 72, 0.1);
    &:hover {
      background: var(--accent-soft);
    }
  }
  .reopen-l {
    left: 18px;
  }
  .reopen-r {
    right: 18px;
  }
  .keep-r .reopen-l,
  .keep-l .reopen-r {
    display: inline-block;
  }
</style>
