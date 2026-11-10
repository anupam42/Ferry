<script lang="ts">
  import { fly } from "svelte/transition";

  import { face } from "../lib/api.ts";
  import { toasts } from "../lib/app.svelte.ts";
  import { ms } from "../lib/look.svelte.ts";
</script>

<div class="toasts" role="status" aria-live="polite">
  {#each toasts as t (t.id)}
    <div class="toast" class:error={t.error} transition:fly={{ y: 16, duration: ms(180) }}>
      <img src={face(t.mood)} alt="" />
      <span>{t.text}</span>
    </div>
  {/each}
</div>

<style lang="scss">
  @use "tokens" as *;

  .toasts {
    position: fixed; left: 50%; bottom: space(6); transform: translateX(-50%); z-index: z(toast);
    display: flex; flex-direction: column; align-items: center; gap: space(2); pointer-events: none;
  }
  .toast {
    display: flex; align-items: center; gap: space(3);
    padding: space(2) space(5) space(2) space(2); border-radius: $radius-pill;
    background: var(--text); color: var(--card-solid); font-weight: $weight-semibold;
    box-shadow: var(--shadow); max-width: min(640px, 90vw);
    &.error { background: var(--red); color: #fff; }
    img { width: 44px; height: 33px; border-radius: 50%; background: var(--card-solid); padding: 2px; }
  }
</style>
