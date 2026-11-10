<script lang="ts">
  import Rail from "./components/Rail.svelte";
  import RelayAsk from "./components/RelayAsk.svelte";
  import Toasts from "./components/Toasts.svelte";
  import ConnectionsDrawer from "./settings/ConnectionsDrawer.svelte";
  import Settings from "./settings/Settings.svelte";
  import Git from "./git/Git.svelte";
  import Sync from "./sync/Sync.svelte";
  import { app } from "./lib/app.svelte.ts";
</script>

<div class="app">
  <Rail />
  <main class="content">
    {#if app.mode === "settings"}
      <Settings />
    {:else if app.mode === "sync"}
      <Sync />
    {:else}
      <Git />
    {/if}
  </main>
</div>

{#if app.connectionsOpen}<ConnectionsDrawer />{/if}
<RelayAsk />
<Toasts />

<style lang="scss">
  @use "tokens" as *;
  @use "mixins" as *;

  :global(:root) { --rail-w: 92px; }
  :global([data-rail="thin"]) { --rail-w: 64px; }
  :global([data-rail="wide"]) { --rail-w: 210px; }

  .app {
    display: grid; grid-template-columns: var(--rail-w) minmax(0, 1fr); gap: space(4) + 2; padding: space(4) + 2;
    min-height: calc(100vh / var(--zoom));
    @include motion { transition: grid-template-columns $duration-slow $ease-out; }
  }
  :global(.rail-dragging) .app { transition: none; }
  .content { min-width: 0; }
  :global([data-railpos="top"]) .app { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto 1fr; }
  @include below(phone) {
    .app { grid-template-columns: minmax(0, 1fr); padding: space(2) + 2; gap: space(3); }
  }
</style>
