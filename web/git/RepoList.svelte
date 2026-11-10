<script lang="ts">
  import Icon from "../components/Icon.svelte";
  import { face } from "../lib/api.ts";
  import { app } from "../lib/app.svelte.ts";
  import { plural } from "../lib/format.ts";
  import { git, repoMood } from "../lib/git.svelte.ts";
  import { short } from "../lib/sync.svelte.ts";

  const canOpen = $derived(!app.info || app.info.can_open_repos);
</script>

<aside class="col">
  <div class="card">
    <div class="head"><h2>Repositories</h2><span class="count blue">{git.repos.length}</span></div>
    {#if canOpen}
      <div class="add"><button class="btn brand" onclick={() => (git.adding = true)}><Icon name="plus" size={18} />Add repository</button></div>
    {/if}
    <div class="list">
      {#each git.repos as r (r.id)}
        {@const sel = r.id === git.selected}
        {@const st = sel ? git.state : null}
        <button class="repo" class:sel aria-current={sel ? "true" : undefined} title={r.path} onclick={() => git.select(r.id)}>
          <img src={face(st ? repoMood(st).face : "happy")} alt="" />
          <div>
            <div class="name">{r.name}</div>
            <div class="sub">{st ? `⎇ ${st.branch || "detached"} · ${st.files.length ? plural(st.files.length, "change") : "clean"}` : short(r.path)}</div>
            {#if r.pairs.length}<div class="sub">synced by {r.pairs.join(", ")}</div>{/if}
          </div>
        </button>
      {:else}
        <div class="none">No repositories yet. Clone one, create one, or open a folder you already have.</div>
      {/each}
    </div>
  </div>
  <div class="conn" class:off={!app.online}>{app.online ? "Ferry is running · updates are live" : "Can't reach Ferry. Is “ferry ui” still running in your terminal?"}</div>
</aside>

<style lang="scss">
  @use "tokens" as *;
  @use "mixins" as *;

  .col { display: flex; flex-direction: column; gap: space(3) + 2; position: sticky; top: space(4) + 2; }
  .head { padding: space(4) + 2 space(4) + 2 space(3); display: flex; align-items: center; gap: space(2) + 2; h2 { font-size: fs(lg); flex: 1; } }
  .add { padding: 0 space(4) + 2 space(3); .btn { width: 100%; justify-content: center; } }
  .list { padding: 0 space(2) + 2 space(3); display: flex; flex-direction: column; gap: space(1); }
  .repo {
    display: grid; grid-template-columns: 44px 1fr; gap: space(2) + 2; align-items: center; padding: space(2); width: 100%;
    border-radius: $radius-lg; border: 2px solid transparent; background: none; text-align: left; cursor: pointer;
    &:hover { background: var(--accent-soft); }
    &.sel { @include gradient-border; box-shadow: 0 6px 18px color-mix(in srgb, var(--accent) 18%, transparent); }
    img { width: 44px; height: 32px; }
    > div { min-width: 0; }
  }
  .name { font-weight: 650; @include ellipsis; }
  .sub { font-size: 12px; color: var(--muted); @include ellipsis; }
  .none { padding: space(1) space(4) + 2 space(4) + 2; color: var(--muted); font-size: 13px; }
  .conn { color: var(--muted); font-size: 12px; padding: 0 space(2) + 2; &.off { color: var(--red); } }
  @include below(laptop) { .col { position: static; } }
</style>
