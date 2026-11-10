<script lang="ts">
  import Icon from "../components/Icon.svelte";
  import { api, enc } from "../lib/api.ts";
  import { app } from "../lib/app.svelte.ts";
  import type { FolderListing } from "../lib/types.ts";

  /** Browse folders on this computer (GET /fs) and pick one. */
  let { start, onpick, onback }: { start: string; onpick: (dir: string) => void; onback: () => void } = $props();
  let r = $state<FolderListing | null>(null);
  let error = $state("");
  let hidden = $state(false);

  async function go(dir: string) {
    try {
      r = await api<FolderListing>("GET", "/fs?path=" + enc(dir) + (hidden ? "&hidden=1" : ""));
      error = "";
    } catch (e) {
      const home = app.info?.home;
      if (home && dir !== home) return go(home);
      error = (e as Error).message;
    }
  }
  $effect(() => { void go(start); });

  const sep = $derived(app.info?.sep || "/");
  const crumbs = $derived.by(() => {
    if (!r) return [];
    const parts = r.path.split(/[\\/]/).filter(Boolean), win = /^[A-Za-z]:/.test(r.path);
    return parts.map((name, i) => ({ name, full: (win ? "" : sep) + parts.slice(0, i + 1).join(sep) + (win && i === 0 ? sep : ""), sep: i > 0 || !win }));
  });
  const join = (n: string) => r!.path.replace(/[\\/]+$/, "") + sep + n;
  const here = $derived(r ? r.path.split(/[\\/]/).filter(Boolean).pop() || r.path : "");
</script>

{#if error}<p class="muted">{error}</p>{/if}
{#if r}
  <div class="crumbpath">
    {#each crumbs as c, i (c.full)}
      {#if c.sep}<span class="sep">{sep}</span>{/if}
      {#if i === crumbs.length - 1}<span class="here">{c.name}</span>
      {:else}<button type="button" onclick={() => go(c.full)}>{c.name}</button>{/if}
    {/each}
  </div>
  <div class="dirs">
    {#if r.parent}<button type="button" class="dir" onclick={() => go(r!.parent)}>↑<span class="muted">Up one level</span></button>{/if}
    {#each r.dirs as n (n)}
      <button type="button" class="dir" onclick={() => go(join(n))}><Icon name="folder" size={18} /><span>{n}</span><span class="chev">›</span></button>
    {:else}
      <div class="dir empty">This folder has no sub-folders.</div>
    {/each}
  </div>
  <div class="inline tools">
    {#if r.is_git}<span class="pill green">this folder is a git repo</span>{/if}
    <button type="button" class="btn small" onclick={() => go(r!.home)}>Home folder</button>
    {#each r.drives ?? [] as dv (dv)}
      <button type="button" class="btn small" class:primary={r.path.toUpperCase().startsWith(dv.toUpperCase())} title="Open drive {dv}" onclick={() => go(dv)}>Drive {dv.replace(/\\$/, "")}</button>
    {/each}
    <label class="check"><input type="checkbox" bind:checked={hidden} onchange={() => go(r!.path)} />show hidden folders</label>
  </div>
  <p class="hint">Click a folder to open it, then press “Choose” below.</p>
  <div class="foot">
    <button class="btn ghost" type="button" onclick={onback}>← Back</button>
    <button class="btn brand" type="button" onclick={() => onpick(r!.path)}>Choose “{here}”</button>
  </div>
{/if}

<style lang="scss">
  @use "tokens" as *;

  .crumbpath { display: flex; gap: 2px; align-items: center; flex-wrap: wrap; margin-bottom: space(3);
    button { border: 0; background: none; color: var(--accent); cursor: pointer; padding: 3px 7px; border-radius: $radius-sm; &:hover { background: var(--accent-soft); } }
    .here { color: var(--text); font-weight: $weight-bold; padding: 3px 7px; }
    .sep { color: var(--faint); } }
  .dirs { border: 1px solid var(--line); border-radius: $radius-lg; overflow: hidden; max-height: 52vh; overflow-y: auto; }
  .dir { display: flex; gap: space(2) + 2; align-items: center; width: 100%; border: 0; background: none; text-align: left; padding: space(3) - 1 space(4); cursor: pointer; border-top: 1px solid var(--line);
    &:first-child { border-top: 0; } &:hover { background: var(--accent-soft); } :global(svg) { color: var(--accent); }
    .chev { margin-left: auto; color: var(--faint); } &.empty { color: var(--muted); cursor: default; &:hover { background: none; } } }
  .tools { margin-top: space(3); gap: space(3) + 2; flex-wrap: wrap; .check { margin: 0; } }
  .foot { display: flex; justify-content: space-between; gap: space(2); margin-top: space(3); padding-top: space(3); border-top: 1px solid var(--line); }
</style>
