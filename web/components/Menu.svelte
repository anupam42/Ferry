<script lang="ts" module>
  export interface MenuItem {
    label: string;
    /** a second, quieter line */
    hint?: string;
    icon: string;
    run: () => void;
  }
</script>

<script lang="ts">
  import Icon from "./Icon.svelte";

  /**
   * A ⋯ button with a short menu of less-used actions. Arrow keys move between
   * the items, Escape closes and returns to the button, a click outside closes.
   */
  let { items, label = "More" }: { items: MenuItem[]; label?: string } = $props();

  let open = $state(false);
  let menu = $state<HTMLElement>();
  let button = $state<HTMLButtonElement>();
  function toggle() {
    open = !open;
    if (open) queueMicrotask(() => menu?.querySelector<HTMLElement>("[role=menuitem]")?.focus());
  }
  function close(back = false) {
    open = false;
    if (back) button?.focus();
  }
  function key(e: KeyboardEvent) {
    const all = [...(menu?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
    const i = all.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      all[(i + 1) % all.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      all[(i - 1 + all.length) % all.length]?.focus();
    } else if (e.key === "Tab") close();
  }
  function outside(e: PointerEvent) {
    if (open && !menu?.contains(e.target as Node) && !button?.contains(e.target as Node)) close();
  }
</script>

<svelte:document onpointerdown={outside} />

<div class="wrap">
  <button
    type="button"
    class="trigger"
    bind:this={button}
    aria-label={label}
    title={label}
    aria-haspopup="menu"
    aria-expanded={open}
    onclick={toggle}><Icon name="more" size={18} /></button
  >
  {#if open}
    <div class="menu" role="menu" tabindex="-1" bind:this={menu} onkeydown={key}>
      {#each items as it (it.label)}
        <button
          type="button"
          role="menuitem"
          class="item"
          onclick={() => {
            close();
            it.run();
          }}
        >
          <Icon name={it.icon} size={17} /><span class="text"
            >{it.label}{#if it.hint}<small>{it.hint}</small>{/if}</span
          >
        </button>
      {/each}
    </div>
  {/if}
</div>

<style lang="scss">
  @use "tokens" as *;
  @use "mixins" as *;
  .wrap {
    position: relative;
  }
  .trigger {
    width: 34px;
    height: 34px;
    border: 0;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: none;
    color: var(--muted);
    cursor: pointer;
    &:hover,
    &[aria-expanded="true"] {
      background: var(--card2);
      color: var(--text);
    }
    &:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 1px;
    }
  }
  .menu {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    min-width: 270px;
    padding: space(1) + 2;
    border-radius: $radius-lg;
    background: var(--card-solid);
    border: 1px solid var(--line);
    box-shadow: 0 18px 44px rgba(9, 35, 72, 0.18);
    z-index: z(sticky) + 5;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 11px;
    width: 100%;
    border: 0;
    background: none;
    padding: 9px 11px;
    border-radius: $radius-md;
    cursor: pointer;
    text-align: left;
    color: var(--text);
    :global(svg) {
      color: var(--muted);
      flex: none;
    }
    &:hover,
    &:focus-visible {
      background: var(--accent-soft);
      outline: none;
    }
  }
  .text {
    display: flex;
    flex-direction: column;
    min-width: 0;
    font-size: 13.5px;
    font-weight: $weight-semibold;
    small {
      font-weight: 400;
      color: var(--muted);
      font-size: 12px;
    }
  }
</style>
