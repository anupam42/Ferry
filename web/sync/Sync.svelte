<script lang="ts">
  import { face } from "../lib/api.ts";
  import { app } from "../lib/app.svelte.ts";
  import { sync } from "../lib/sync.svelte.ts";
  import RelayLoading from "../components/RelayLoading.svelte";
  import AddPair from "./AddPair.svelte";
  import DiffDrawer from "./DiffDrawer.svelte";
  import PairList from "./PairList.svelte";
  import PairView from "./PairView.svelte";

  const canAdd = $derived(!app.info || app.info.can_add);
</script>

<div class="sync">
  <PairList />
  <div class="main">
    {#if !sync.loaded}
      <RelayLoading say="Looking at your folder pairs" />
    {:else if sync.current}
      {#key sync.current.name}<PairView p={sync.current} />{/key}
    {:else}
      <div class="card empty">
        <img src={face("excited")} alt="Relay" class="float" />
        <h2>Hi, I'm Relay. Let's sync your first folder.</h2>
        <p>Pick the folder you work in and the folder (usually a git repository) it should be copied to. I'll watch for changes and copy them for you, with backups, undo and help with conflicts.</p>
        {#if canAdd}<button class="btn brand" onclick={() => (sync.adding = true)}>New folder pair</button>
        {:else}<p>Start ferry with “ferry ui” to add pairs from here.</p>{/if}
      </div>
    {/if}
  </div>
</div>

{#if sync.diff}<DiffDrawer />{/if}
{#if sync.adding}<AddPair />{/if}

<style lang="scss">
  @use "tokens" as *;
  @use "mixins" as *;

  .sync { display: grid; grid-template-columns: 320px minmax(0, 1fr); gap: space(4) + 2; align-items: start; }
  .main { min-width: 0; }
  @include below(laptop) { .sync { grid-template-columns: minmax(0, 1fr); } }
</style>
