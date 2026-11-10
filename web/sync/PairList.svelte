<script lang="ts">
  import Icon from "../components/Icon.svelte";
  import { face } from "../lib/api.ts";
  import { app } from "../lib/app.svelte.ts";
  import { ago } from "../lib/format.ts";
  import { sync } from "../lib/sync.svelte.ts";

  const canAdd = $derived(!app.info || app.info.can_add);
  const arrow = (mode: string) => (mode === "two-way" ? "⇄" : "→");
</script>

<aside class="col">
  <div class="card">
    <div class="head"><h2>Folder pairs</h2><span class="count blue">{sync.pairs.length}</span></div>
    {#if canAdd}
      <div class="add"><button class="btn brand" onclick={() => (sync.adding = true)}><Icon name="plus" size={18} />New pair</button></div>
    {/if}
    <div class="list">
      {#each sync.pairs as p (p.name)}
        {@const m = sync.moodOf(p)}
        <button class="pair" class:sel={p.name === sync.selected} aria-current={p.name === sync.selected ? "true" : undefined}
          title="{p.source} {arrow(p.mode)} {p.remote || p.target}" onclick={() => sync.select(p.name)}>
          <img src={face(m.anim ? "focused" : m.face)} alt="" />
          <div><div class="name">{p.name}</div><div class="sub">{m.label} · {ago(p.last_sync)}</div></div>
        </button>
      {:else}
        <div class="none">No folder pairs yet. Add your first one above.</div>
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
  .pair {
    display: grid; grid-template-columns: 44px 1fr; gap: space(2) + 2; align-items: center; padding: space(2); width: 100%;
    border-radius: $radius-lg; border: 2px solid transparent; background: none; text-align: left; cursor: pointer;
    &:hover { background: var(--accent-soft); }
    // the selected one: a border in Relay's gradient (follows Settings → Accent)
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
