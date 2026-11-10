<script lang="ts">
  import Icon from "../components/Icon.svelte";
  import { api, face } from "../lib/api.ts";
  import { plural } from "../lib/format.ts";
  import { git } from "../lib/git.svelte.ts";
  import { span } from "../lib/shape.ts";
  import type { RepoStateResponse, ShapeTimeline } from "../lib/types.ts";

  /**
   * Above Changes: in a repository a pair syncs into, Ferry recorded the work,
   * so it offers to shape it into commits. Elsewhere, a tip saying where it works.
   */
  let { st, count }: { st: RepoStateResponse; count: number } = $props();
  let t = $state<ShapeTimeline | null>(null);
  let tip = $state(localStorage.getItem("ferry-tip-shape") !== "off");
  const synced = $derived(st.pairs.length > 0);

  $effect(() => {
    void git.bump; void count;
    if (!synced || !count) { t = null; return; }
    api<ShapeTimeline>("GET", git.url("shape")).then((r) => (t = r), () => (t = null));
  });
  const first = $derived(t?.batches[0]?.time ?? "");
  const last = $derived(t?.batches[t.batches.length - 1]?.time ?? "");
</script>

{#if synced && t?.batches.length}
  <div class="card callout-shape">
    <img class="float" src={face("excited")} alt="" />
    <div class="grow">
      <b>I recorded {plural(t.batches.length, "sync")} since your last commit, over {span(first, last)}.</b>
      <small>Instead of one big commit, I can split the work where you paused and make a commit for each part.</small>
    </div>
    <button class="btn brand" onclick={() => (git.shaping = true)}><Icon name="commit" size={16} />Shape my history</button>
  </div>
{:else if !synced && count && tip}
  <div class="tip">
    <Icon name="info" size={16} />
    <span>Shape my history, which turns your work into a few clean commits, works on repositories a folder pair syncs into: Ferry records each sync there.</span>
    <button class="btn small ghost" aria-label="Hide this tip" onclick={() => { localStorage.setItem("ferry-tip-shape", "off"); tip = false; }}>Got it</button>
  </div>
{/if}

<style lang="scss">
  @use "tokens" as *;
  @use "mixins" as *;
  .callout-shape { display: flex; align-items: center; gap: space(4); padding: space(3) + 2 space(4) + 2; margin-bottom: space(3) + 2;
    background: linear-gradient(135deg, var(--accent-soft), color-mix(in srgb, var(--accent-2) 12%, transparent));
    img { width: 76px; height: 56px; flex: none; } .grow { flex: 1; min-width: 0; } b { display: block; font-size: 14.5px; } small { display: block; color: var(--muted); margin-top: 2px; } }
  .tip { display: flex; align-items: center; gap: space(2) + 2; margin: 0 2px space(3); padding: space(2) space(2) space(2) space(3) + 2; border-radius: $radius-md + 2; background: var(--card2); color: var(--muted); font-size: 12.5px;
    :global(svg) { color: var(--accent); flex: none; } span { flex: 1; } }
  @include below(phone) { .callout-shape { flex-wrap: wrap; img { display: none; } } }
</style>
