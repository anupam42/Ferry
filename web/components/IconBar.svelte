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
   *
   * With more than two actions it rests folded: just the main action and a ⋯.
   * It slides open when its row is pointed at or it has keyboard focus (so Tab
   * walks through every action), and the ⋯ opens it for touch and keeps it open.
   * Folded actions can't be focused or read out, so nothing invisible gets in the way.
   */
  let { actions, label, fold = true }: { actions: BarAction[]; label: string; fold?: boolean } = $props();
  const lead = $derived(actions.find((a) => a.primary) ?? actions[0]);
  const folds = $derived(fold && actions.length > 2);
  const others = $derived(folds ? actions.filter((a) => a !== lead) : actions);
  const safe = $derived(others.filter((a) => !a.danger));
  const risky = $derived(others.filter((a) => a.danger));
  let pinned = $state(false);
</script>

{#snippet button(a: BarAction, extra = false)}
  <button
    type="button"
    class="ib"
    class:extra
    class:primary={a.primary}
    class:danger={a.danger}
    aria-label={a.label}
    onclick={a.run}
  >
    <Icon name={a.icon} size={17} /><span class="tip" aria-hidden="true">{a.label}</span>
  </button>
{/snippet}

<div class="bar" class:folds class:pinned role="group" aria-label={label}>
  {#if folds && lead}{@render button(lead)}{/if}
  {#each safe as a (a.label)}{@render button(a, folds)}{/each}
  {#if risky.length && (safe.length || folds)}<span class="sep" class:extra={folds} aria-hidden="true"></span>{/if}
  {#each risky as a (a.label)}{@render button(a, folds)}{/each}
  {#if folds}
    <button
      type="button"
      class="ib toggle"
      aria-label={pinned ? "Fewer actions" : "More actions"}
      aria-expanded={pinned}
      onclick={() => (pinned = !pinned)}
      ><Icon name="more" size={17} /><span class="tip" aria-hidden="true"
        >{pinned ? "Fewer actions" : "More actions"}</span
      ></button
    >
  {/if}
</div>

<style lang="scss">
  @use "tokens" as *;
  @use "mixins" as *;
  .bar {
    display: inline-flex;
    align-items: center;
    gap: 0;
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
    margin: 0 1px;
    flex: none;
    padding: 0; // the global button padding would keep a folded one 12px wide
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
        transform 0.12s,
        width $duration-base $ease-out,
        margin $duration-base $ease-out,
        opacity $duration-base;
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
  // folded: the extra actions take no room and can't be reached; open, they slide back in
  .folds:not(.pinned):not(:hover):not(:focus-within) .extra {
    width: 0;
    margin: 0;
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    transform: scale(0.6);
  }
  // its row is pointed at: open (the same selector plus the row, so it wins over "folded")
  :global(tr:hover) .folds:not(.pinned):not(:hover):not(:focus-within) .extra {
    width: 32px;
    margin: 0 1px;
    opacity: 1;
    visibility: visible;
    pointer-events: auto;
    transform: none;
  }
  :global(tr:hover) .folds:not(.pinned):not(:hover):not(:focus-within) .sep.extra {
    width: 1px;
    margin: 0 3px;
  }
  .folds .sep {
    @include motion {
      transition:
        width $duration-base $ease-out,
        margin $duration-base $ease-out,
        opacity $duration-base;
    }
  }
  // the ⋯ turns once the bar is open
  .toggle :global(svg) {
    @include motion {
      transition: transform $duration-base $ease-out;
    }
  }
  .folds.pinned .toggle,
  .folds:hover .toggle,
  .folds:focus-within .toggle,
  :global(tr:hover) .folds .toggle {
    color: var(--text);
    :global(svg) {
      transform: rotate(90deg);
    }
  }
  .folds.pinned .toggle {
    background: var(--accent-soft);
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
