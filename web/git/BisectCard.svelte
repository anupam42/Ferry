<script lang="ts">
  import Icon from "../components/Icon.svelte";
  import { git } from "../lib/git.svelte.ts";
  import type { RepoStateResponse } from "../lib/types.ts";

  /** While a bisect runs, HEAD is a commit being tested, not your branch: say so, and lead back to it. */
  let { st }: { st: RepoStateResponse } = $props();
</script>

{#if st.bisecting}
  <div class="card bisect" role="status">
    <span class="ic"><Icon name="search" size={18} /></span>
    <div class="grow">
      <b>Finding the commit that broke it</b>
      <small class="muted">You're on commit {st.head} to test it, not on a branch.</small>
    </div>
    <button class="btn small brand" onclick={() => (git.bisect = {})}>Continue</button>
  </div>
{/if}

<style lang="scss">
  @use "tokens" as *;
  .bisect {
    display: flex;
    align-items: center;
    gap: space(3);
    padding: space(3) space(4);
    margin-bottom: space(3) + 2;
    border: 2px solid var(--violet-soft);
  }
  .ic {
    width: 34px;
    height: 34px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    flex: none;
    background: var(--violet-soft);
    color: var(--violet);
  }
  .grow {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    b {
      font-size: 14px;
    }
    small {
      font-size: 12.5px;
    }
  }
</style>
