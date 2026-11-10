<script lang="ts">
  import ChangeStory, { type StoryNav } from "../components/ChangeStory.svelte";
  import Drawer from "../components/Drawer.svelte";
  import RelayLoading from "../components/RelayLoading.svelte";
  import { api } from "../lib/api.ts";
  import { fileURL, git, resolveFile } from "../lib/git.svelte.ts";
  import type { FileDiff } from "../lib/types.ts";

  /** Your version and theirs, as a change story, with the choices to settle it. */
  const path = git.conflict!;
  const name = path.split("/").pop()!;
  // edits put back after a pull (no merge running): "theirs" is your edits, "ours" what came in
  const clash = !git.state?.operation;
  let d = $state<FileDiff | null>(null);
  let error = $state("");
  let nav = $state<StoryNav>();
  $effect(() => { api<FileDiff>("GET", fileURL("conflict", path)).then((r) => (d = r), (e) => (error = (e as Error).message)); });
  const close = () => (git.conflict = null);
  const pick = (choice: "ours" | "theirs" | "both", text: string) => { void resolveFile(path, choice, text); close(); };
</script>

<Drawer title={name} sub="Changed on both branches" wide onclose={close}>
  {#if error}<p class="muted">{error}</p>
  {:else if !d}<RelayLoading say="Comparing your version with theirs" mood="comparing" card={false} />
  {:else}<ChangeStory {d} file={name} bind:nav />{/if}
  {#snippet foot()}
    {#if nav && nav.count}
      <span class="left muted">Change {nav.at + 1} of {nav.count}</span>
      <button class="btn small" disabled={nav.at === 0} onclick={() => nav!.go(nav!.at - 1)}>↑ Previous</button>
      <button class="btn small" disabled={nav.at === nav.count - 1} onclick={() => nav!.go(nav!.at + 1)}>Next change ↓</button>
    {/if}
    {#if clash}
      <button class="btn small" onclick={() => pick("theirs", "kept your edits")}>Keep my edits</button>
      <button class="btn small" onclick={() => pick("ours", "took the pulled version")}>Take theirs</button>
    {:else}
      <button class="btn small" onclick={() => pick("ours", "kept your version")}>Keep mine</button>
      <button class="btn small" onclick={() => pick("theirs", "kept theirs")}>Keep theirs</button>
    {/if}
    <button class="btn small brand" onclick={() => pick("both", "kept both")}>Keep both</button>
  {/snippet}
</Drawer>
