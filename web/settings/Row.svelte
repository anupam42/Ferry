<script lang="ts">
  import type { Snippet } from "svelte";

  /** One settings row: what it is on the left, the control on the right. */
  let {
    label,
    hint = "",
    tall = false,
    children,
  }: { label: string; hint?: string; tall?: boolean; children: Snippet } = $props();
</script>

<div class="row" class:tall>
  <div class="label">
    <b>{label}</b>{#if hint}<small>{hint}</small>{/if}
  </div>
  <div class="control">{@render children()}</div>
</div>

<style lang="scss">
  @use "tokens" as *;
  @use "mixins" as *;

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: space(6);
    padding: space(4) space(5) + 2;
    border-bottom: 1px solid var(--line);
    &:last-child {
      border-bottom: 0;
    }
    &.tall {
      align-items: flex-start;
    }
  }
  .label {
    min-width: 0;
    flex: 1;
    b {
      display: block;
      font-size: fs(md);
      font-weight: $weight-semibold;
    }
    small {
      display: block;
      color: var(--muted);
      font-size: fs(sm);
      margin-top: 3px;
      max-width: 460px;
    }
  }
  .control {
    flex: none;
    display: flex;
    justify-content: flex-end;
    :global(input[type="text"]),
    :global(input[type="email"]) {
      width: 300px;
    }
    :global(select) {
      width: 260px;
    }
  }
  @include below(phone) {
    .row {
      flex-direction: column;
      align-items: stretch;
      gap: space(2) + 2;
    }
    .control {
      justify-content: flex-start;
      :global(input),
      :global(select) {
        width: 100%;
      }
    }
  }
</style>
