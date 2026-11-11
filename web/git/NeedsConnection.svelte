<script lang="ts">
  import Icon from "../components/Icon.svelte";
  import { face } from "../lib/api.ts";
  import { app } from "../lib/app.svelte.ts";
  /** Relay when a service couldn't be reached: say why, and offer Connections when that's the fix. */
  let { say, hint, connect = true }: { say: string; hint: string; connect?: boolean } = $props();
</script>

<div class="card hero">
  <img src={face("thinking")} alt="" />
  <div class="bubble">
    <div class="say">{say}</div>
    <div class="hint">{hint}</div>
    {#if connect}<div class="go">
        <button class="btn small brand" onclick={() => (app.connectionsOpen = true)}
          ><Icon name="plug" size={16} />Open Connections</button
        >
      </div>{/if}
  </div>
</div>

<style lang="scss">
  @use "tokens" as *;
  .hero {
    display: flex;
    align-items: center;
    gap: space(4) + 2;
    padding: space(3) + 2 space(5) + 2;
    > img {
      width: 112px;
      height: 82px;
      flex: none;
    }
  }
  .go {
    margin-top: space(2) + 2;
  }
</style>
