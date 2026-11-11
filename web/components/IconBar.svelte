<script lang="ts" module>
  export interface BarAction {
    icon: string;
    /** what it does: the tooltip and the screen-reader name */
    label: string;
    run: () => void;
    /** the main action: drawn in the accent colour */
    primary?: boolean;
    /** destructive: turns red on hover, after a divider */
    danger?: boolean;
  }
</script>

<script lang="ts">
  import Icon from "./Icon.svelte";

  /**
   * A row's actions as a small floating bar of icon buttons, each named by a
   * tooltip on hover and keyboard focus, like the folder pair command bar. The
   * destructive ones sit after a divider. `label` names the group for screen readers.
   */
  let { actions, label }: { actions: BarAction[]; label: string } = $props();
  const safe = $derived(actions.filter((a) => !a.danger));
  const risky = $derived(actions.filter((a) => a.danger));
</script>

{#snippet button(a: BarAction)}
  <button
    type="button"
    class="ib"
    class:primary={a.primary}
    class:danger={a.danger}
    aria-label={a.label}
    onclick={a.run}
  >
    <Icon name={a.icon} size={17} /><span class="tip" aria-hidden="true">{a.label}</span>
  </button>
{/snippet}

<div class="bar" role="group" aria-label={label}>
  {#each safe as a (a.label)}{@render button(a)}{/each}
  {#if safe.length && risky.length}<span class="sep" aria-hidden="true"></span>{/if}
  {#each risky as a (a.label)}{@render button(a)}{/each}
</div>

<style lang="scss">
  @use "tokens" as *;
  @use "mixins" as *;
  .bar {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 3px;
    border-radius: $radius-pill;
    background: var(--card-solid);
    border: 1px solid var(--line);
    @include motion {
      transition: box-shadow $duration-fast;
    }
  }
  // the row it's in is pointed at: the bar lifts
  :global(tr:hover) .bar,
  .bar:focus-within {
    box-shadow:
      0 8px 24px rgba(9, 35, 72, 0.1),
      0 1px 3px rgba(9, 35, 72, 0.06);
  }
  .sep {
    width: 1px;
    height: 18px;
    background: var(--line);
    margin: 0 3px;
    flex: none;
  }
  .ib {
    position: relative;
    width: 32px;
    height: 32px;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--muted);
    display: grid;
    place-items: center;
    cursor: pointer;
    @include motion {
      transition:
        background 0.15s,
        color 0.15s,
        transform 0.12s;
    }
    &:hover {
      background: var(--accent-soft);
      color: var(--text);
    }
    &:active {
      transform: scale(0.92);
    }
    &:focus-visible {
      outline: none;
      box-shadow: 0 0 0 2.5px var(--accent);
    }
    &.primary {
      color: var(--accent);
    }
    &.danger:hover,
    &.danger:focus-visible {
      background: var(--red-soft);
      color: var(--red);
    }
    &:hover .tip,
    &:focus-visible .tip {
      opacity: 1;
      transform: translate(-50%, 0);
    }
  }
  .tip {
    position: absolute;
    bottom: calc(100% + 8px);
    left: 50%;
    transform: translate(-50%, 4px);
    padding: space(1) + 1 space(2) + 2;
    border-radius: 9px;
    background: var(--text);
    color: var(--card-solid);
    font-size: 12px;
    font-weight: $weight-semibold;
    white-space: nowrap;
    pointer-events: none;
    opacity: 0;
    z-index: z(sticky) + 5;
    @include motion {
      transition:
        opacity 0.12s,
        transform 0.12s;
    }
  }
</style>
