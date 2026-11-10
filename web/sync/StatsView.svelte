<script lang="ts">
  import RelayLoading from "../components/RelayLoading.svelte";
  import Section from "../components/Section.svelte";
  import { api, enc } from "../lib/api.ts";
  import { act } from "../lib/app.svelte.ts";
  import { pairURL } from "../lib/sync.svelte.ts";
  import type { PairStatus, Stats } from "../lib/types.ts";

  let { p }: { p: PairStatus } = $props();
  const SINCE = [["24h", "last 24 hours"], ["7d", "last 7 days"], ["30d", "last 30 days"], ["all", "all history"]] as const;
  let since = $state(localStorage.getItem("ferry-stats-since") || "7d");
  let s = $state<Stats | null>(null);
  $effect(() => {
    const want = since;
    s = null;
    localStorage.setItem("ferry-stats-since", want);
    act(null, () => api<Stats>("GET", pairURL(p.name, "stats") + "?since=" + enc(want))).then((r) => { if (since === want) s = r; });
  });
  const max = $derived(Math.max(1, ...(s?.perDay ?? []).map((d) => d.files)));
</script>

{#snippet picker()}
  <select class="auto" bind:value={since} aria-label="Period">{#each SINCE as [v, l] (v)}<option value={v}>{l}</option>{/each}</select>
{/snippet}

{#if !s}
  <RelayLoading say="Counting what I've synced" mood="thinking" />
{:else if s.batches === 0}
  <Section id="stats" title="Stats" extra={picker}><div class="empty-row">Nothing synced in this period.</div></Section>
{:else}
  <Section id="stats" title="Stats" extra={picker}>
    <div class="tiles">
      <div class="tile"><div class="v">{s.batches}</div><div class="l">syncs</div></div>
      <div class="tile"><div class="v">{s.added}</div><div class="l">files added</div></div>
      <div class="tile"><div class="v">{s.updated}</div><div class="l">files updated</div></div>
      <div class="tile"><div class="v">{s.deleted}</div><div class="l">files deleted</div></div>
      <div class="tile"><div class="v">{s.renamed}</div><div class="l">renamed</div></div>
      {#if s.undone}<div class="tile"><div class="v">{s.undone}</div><div class="l">undone</div></div>{/if}
    </div>
  </Section>
  <Section id="perday" title="File changes per day">
    <div class="bars">
      {#each s.perDay.slice(-30) as d (d.day)}
        <div class="bar"><span class="muted">{d.day.slice(5)}</span><div class="t"><div class="f" style:width="{Math.max(3, (d.files / max) * 100)}%"></div></div><span>{d.files}</span></div>
      {/each}
    </div>
  </Section>
  {#if s.topFiles.length}
    <Section id="top" title="Most changed files" count={s.topFiles.length}>
      <table class="table"><tbody>
        {#each s.topFiles as t (t.path)}<tr><td class="file">{t.path}</td><td class="end"><span class="pill blue">{t.changes}×</span></td></tr>{/each}
      </tbody></table>
    </Section>
  {/if}
{/if}

<style lang="scss">
  .auto { width: auto; }
</style>
