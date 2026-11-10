<script lang="ts">
  import ChangeStory, { type StoryNav } from "../components/ChangeStory.svelte";
  import Drawer from "../components/Drawer.svelte";
  import RelayLoading from "../components/RelayLoading.svelte";
  import { api, enc, face } from "../lib/api.ts";
  import { pairURL, resolve, sync } from "../lib/sync.svelte.ts";
  import type { FileDiff } from "../lib/types.ts";

  // what's open: sync.diff (set by Files and Commit)
  const open = sync.diff!;
  const p = $derived(sync.pairs.find((x) => x.name === open.pair));
  const name = open.file.split("/").pop()!;
  const folder = open.file.includes("/") ? open.file.slice(0, open.file.lastIndexOf("/") + 1) : "";
  let d = $state<FileDiff | null>(null);
  let error = $state("");
  let nav = $state<StoryNav>();
  $effect(() => {
    api<FileDiff>("GET", pairURL(open.pair, "diff") + "?format=json&path=" + enc(open.file) + (open.conflict ? "&conflict=1" : ""))
      .then((r) => (d = r), (e) => (error = (e as Error).message));
  });
  const close = () => (sync.diff = null);
  const CHOICES = [["source", "kept your working folder's version", "Keep mine"], ["target", "kept the target's version", "Keep target's"],
    ["both", "kept both versions", "Keep both"], ["merge", "merged", "Merge"]] as const;
</script>

<Drawer title={name} sub={[open.conflict ? "Changed in both folders" : "What changed", folder].filter(Boolean).join(" · ")} wide onclose={close}>
  {#if error}
    <div class="narrator"><img src={face("sad")} alt="" /><div class="bubble"><div class="say">I couldn't compare this file.</div><div class="hint">{error}</div></div></div>
  {:else if !d}
    <RelayLoading say="Comparing the two versions" mood="comparing" card={false} />
  {:else}
    <ChangeStory {d} file={name} bind:nav />
  {/if}
  {#snippet foot()}
    {#if nav && nav.count}
      <span class="left muted">Change {nav.at + 1} of {nav.count}</span>
      <button class="btn small" disabled={nav.at === 0} onclick={() => nav!.go(nav!.at - 1)}>↑ Previous</button>
      <button class="btn small primary" disabled={nav.at === nav.count - 1} onclick={() => nav!.go(nav!.at + 1)}>Next change ↓</button>
    {/if}
    {#if open.conflict && p}
      {#each CHOICES as [choice, label, text] (choice)}
        <button class="btn small" class:brand={choice === "merge"} onclick={() => { void resolve(p, open.file, choice, label); close(); }}>{text}</button>
      {/each}
    {/if}
  {/snippet}
</Drawer>
