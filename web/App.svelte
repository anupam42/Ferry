<script lang="ts">
  import Rail from "./components/Rail.svelte";
  import PullToRefresh from "./components/PullToRefresh.svelte";
  import RelayAsk from "./components/RelayAsk.svelte";
  import Toasts from "./components/Toasts.svelte";
  import ConnectionsDrawer from "./settings/ConnectionsDrawer.svelte";
  import Settings from "./settings/Settings.svelte";
  import Git from "./git/Git.svelte";
  import Sync from "./sync/Sync.svelte";
  import Todo from "./todo/Todo.svelte";
  import { app } from "./lib/app.svelte.ts";
  import { notes } from "./lib/notes.svelte.ts";
  import { releases } from "./lib/releases.svelte.ts";
  import NotificationsDrawer from "./notes/NotificationsDrawer.svelte";
  import ReleaseNotice from "./updates/ReleaseNotice.svelte";
  import WhatsNew from "./updates/WhatsNew.svelte";
  import Intro from "./intro/Intro.svelte";
  import { intro } from "./lib/intro.svelte.ts";
</script>

<div class="app">
  <Rail />
  <main class="content">
    {#if app.mode === "settings"}
      <Settings />
    {:else if app.mode === "sync"}
      <Sync />
    {:else if app.mode === "todo"}
      <Todo />
    {:else}
      <Git />
    {/if}
  </main>
</div>

{#if app.connectionsOpen}<ConnectionsDrawer />{/if}
{#if notes.open}<NotificationsDrawer />{/if}
{#if releases.notice && !intro.open}{#key releases.notice.kind + releases.notice.version}<ReleaseNotice
      n={releases.notice}
    />{/key}{/if}
{#if releases.whatsNew && releases.info && !intro.open}<WhatsNew />{/if}
{#if intro.open}<Intro />{/if}
<RelayAsk />
<Toasts />
<PullToRefresh />

<style lang="scss">
  @use "tokens" as *;
  @use "mixins" as *;

  :global(:root) {
    --rail-w: 92px;
  }
  :global([data-rail="thin"]) {
    --rail-w: 64px;
  }
  :global([data-rail="wide"]) {
    --rail-w: 210px;
  }

  .app {
    display: grid;
    grid-template-columns: var(--rail-w) minmax(0, 1fr);
    gap: space(4) + 2;
    padding: space(4) + 2;
    min-height: calc(100vh / var(--zoom));
    @include motion {
      transition: grid-template-columns $duration-slow $ease-out;
    }
  }
  // resizing the rail: the page slides with a transform; its far edge is clipped rather than widening the document
  :global(.rail-dragging) .app {
    transition: none;
    overflow-x: clip;
  }
  .content {
    min-width: 0;
  }
  :global([data-railpos="top"]) .app {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto 1fr;
  }
  @include below(phone) {
    .app {
      grid-template-columns: minmax(0, 1fr);
      padding: space(2) + 2;
      gap: space(3);
    }
  }
</style>
