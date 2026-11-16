<script lang="ts">
  import Icon from "../components/Icon.svelte";
  import { api } from "../lib/api.ts";
  import { ago } from "../lib/format.ts";
  import { dropExperiment, keepExperiment } from "../lib/experiment.ts";
  import { ms } from "../lib/look.svelte.ts";
  import { pairURL, sync } from "../lib/sync.svelte.ts";
  import type { ExperimentState, PairStatus } from "../lib/types.ts";
  import { slide } from "svelte/transition";

  /** While an experiment holds a pair: what it has changed so far, and Keep / Drop. */
  let { p }: { p: PairStatus } = $props();
  let ch = $state<ExperimentState | null>(null);
  let open = $state(false);
  let busy = $state(false);

  async function load() {
    ch = await api<ExperimentState | null>("GET", pairURL(p.name, "experiment")).catch(() => ch);
  }
  // read again as files change (activity events bump the pair) and every few seconds
  $effect(() => {
    void sync.bump;
    void load();
    const t = setInterval(() => void load(), 4000);
    return () => clearInterval(t);
  });

  const total = $derived(ch ? ch.added.length + ch.changed.length + ch.deleted.length : 0);
  const summary = $derived(
    !ch
      ? "Reading…"
      : !total
        ? "Nothing changed yet."
        : [
            ch.changed.length && `${ch.changed.length} changed`,
            ch.added.length && `${ch.added.length} new`,
            ch.deleted.length && `${ch.deleted.length} deleted`,
          ]
            .filter(Boolean)
            .join(" · "),
  );
  const rows = $derived(
    ch
      ? [
          ...ch.changed.map((f) => ({ f, k: "changed", tone: "blue" })),
          ...ch.added.map((f) => ({ f, k: "new", tone: "green" })),
          ...ch.deleted.map((f) => ({ f, k: "deleted", tone: "red" })),
        ].sort((a, b) => a.f.localeCompare(b.f))
      : [],
  );

  async function keep() {
    busy = true;
    await keepExperiment(p);
    busy = false;
  }
  async function drop() {
    busy = true;
    await dropExperiment(p, ch);
    busy = false;
  }
</script>

<div class="card exp" role="region" aria-label="Experiment" transition:slide={{ duration: ms(220) }}>
  <div class="head">
    <span class="ic" aria-hidden="true"><Icon name="rocket" size={20} /></span>
    <div class="what">
      <div class="t">{p.experiment?.name || "Trying something"}</div>
      <div class="s">
        started {p.experiment ? ago(p.experiment.since) : ""} · {summary}
        {#if total}<button type="button" class="link" aria-expanded={open} onclick={() => (open = !open)}
            >{open ? "hide files" : "show files"}</button
          >{/if}
      </div>
    </div>
    <button type="button" class="btn small ghost danger" disabled={busy} onclick={drop}
      ><Icon name="undo" size={14} />Drop it</button
    >
    <button type="button" class="btn small brand" disabled={busy} onclick={keep}
      ><Icon name="check" size={14} />Keep it</button
    >
  </div>
  {#if open && rows.length}
    <ul class="files" transition:slide={{ duration: ms(180) }}>
      {#each rows as r (r.f)}
        <li><span class="pill {r.tone}">{r.k}</span><span class="mono">{r.f}</span></li>
      {/each}
    </ul>
  {/if}
</div>

<style lang="scss">
  @use "tokens" as *;
  @use "mixins" as *;

  .exp {
    padding: space(3) space(4);
    border: 2px dashed color-mix(in srgb, var(--accent) 45%, transparent);
    background: color-mix(in srgb, var(--accent) 6%, var(--card-solid));
  }
  .head {
    display: flex;
    align-items: center;
    gap: space(3);
    flex-wrap: wrap;
  }
  .ic {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: var(--accent-soft);
    color: var(--accent);
  }
  .what {
    flex: 1;
    min-width: 200px;
    .t {
      font-weight: $weight-semibold;
    }
    .s {
      font-size: 12.5px;
      color: var(--muted);
    }
  }
  .link {
    border: 0;
    background: none;
    padding: 0 0 0 space(1);
    color: var(--accent);
    font: inherit;
    cursor: pointer;
    text-decoration: underline;
  }
  .btn :global(svg) {
    margin-right: 4px;
  }
  .files {
    list-style: none;
    margin: space(3) 0 0;
    padding: 0;
    max-height: 220px;
    overflow: auto;
    font-size: 12.5px;
    li {
      display: flex;
      align-items: center;
      gap: space(2);
      padding: 3px 0;
    }
    .pill {
      min-width: 58px;
      justify-content: center;
      font-size: 11px;
    }
  }
</style>
