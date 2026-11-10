<script lang="ts">
  import RelayLoading from "../components/RelayLoading.svelte";
  import { face } from "../lib/api.ts";
  import { app } from "../lib/app.svelte.ts";
  import { git } from "../lib/git.svelte.ts";
  import AddRepo from "./AddRepo.svelte";
  import CommitDrawer from "./CommitDrawer.svelte";
  import ConflictDrawer from "./ConflictDrawer.svelte";
  import FileDrawer from "./FileDrawer.svelte";
  import RepoList from "./RepoList.svelte";
  import RepoView from "./RepoView.svelte";
  import ReviewDrawer from "./ReviewDrawer.svelte";

  const canOpen = $derived(!app.info || app.info.can_open_repos);
</script>

<div class="git">
  <RepoList />
  <div class="main">
    {#if !git.loaded}
      <RelayLoading say="Looking at your repositories" />
    {:else if git.current}
      {#key git.current.id}<RepoView r={git.current} />{/key}
    {:else}
      <div class="card empty">
        <img src={face("excited")} alt="Relay" class="float" />
        <h2>Let's open a repository.</h2>
        <p>I can clone one from GitHub or GitLab, create a new one, or open a folder that's already a git repository. Repositories your folder pairs sync into show up here by themselves.</p>
        {#if canOpen}<button class="btn brand" onclick={() => (git.adding = true)}>Add repository</button>
        {:else}<p>Start ferry with “ferry ui” to open repositories here.</p>{/if}
      </div>
    {/if}
  </div>
</div>

{#if git.adding}<AddRepo />{/if}
{#if git.review}<ReviewDrawer />{/if}
{#if git.conflict}<ConflictDrawer />{/if}
{#if git.file}<FileDrawer />{/if}
{#if git.commit}<CommitDrawer />{/if}

<style lang="scss">
  @use "tokens" as *;
  @use "mixins" as *;

  .git { display: grid; grid-template-columns: 320px minmax(0, 1fr); gap: space(4) + 2; align-items: start; }
  .main { min-width: 0; }
  @include below(laptop) { .git { grid-template-columns: minmax(0, 1fr); } }
</style>
