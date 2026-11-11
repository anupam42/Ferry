<script lang="ts">
  import ChangeStory, { type StoryNav } from "../components/ChangeStory.svelte";
  import Drawer from "../components/Drawer.svelte";
  import RelayLoading from "../components/RelayLoading.svelte";
  import { api, enc } from "../lib/api.ts";
  import { fileURL, git, resolveFile } from "../lib/git.svelte.ts";
  import type { ConflictParts, FileDiff } from "../lib/types.ts";
  import ConflictEditor from "./ConflictEditor.svelte";

  /**
   * A file changed on both sides. Change by change (keep yours, theirs, both, or
   * write it), or the whole file at once; the whole-file view compares the two
   * versions as a change story.
   */
  const path = git.conflict!;
  const name = path.split("/").pop()!;
  // edits put back after a pull (no merge running): "theirs" is your edits, "ours" what came in
  const clash = !git.state?.operation;

  let parts = $state<ConflictParts | null>(null);
  let d = $state<FileDiff | null>(null);
  let error = $state("");
  let nav = $state<StoryNav>();
  $effect(() => {
    api<ConflictParts>("GET", git.url("conflict-parts") + "?path=" + enc(path)).then(
      (r) => {
        parts = r;
        if (!r.parts || !r.parts.some((x) => x.kind === "conflict")) view = "whole";
      },
      () => (view = "whole"),
    );
  });
  let view = $state<"changes" | "whole">("changes");
  $effect(() => {
    if (view !== "whole" || d) return;
    api<FileDiff>("GET", fileURL("conflict", path)).then(
      (r) => (d = r),
      (e) => (error = (e as Error).message),
    );
  });

  let result = $state("");
  let decided = $state(0);
  let total = $state(0);
  let saving = $state(false);

  const close = () => (git.conflict = null);
  const pick = (choice: "ours" | "theirs" | "both", text: string) => {
    void resolveFile(path, choice, text);
    close();
  };
  async function save() {
    saving = true;
    const ok = await git.try(
      "resolve",
      { path, choice: "text", text: result },
      `${path}: settled, change by change`,
      "happy",
    );
    saving = false;
    if (ok !== null) close();
  }
  function nextUndecided() {
    const open = [...document.querySelectorAll<HTMLElement>(".drawer .conflict:not(.done)")];
    open[0]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
</script>

<Drawer title={name} sub="Changed on both sides" wide onclose={close}>
  {#if parts?.parts && parts.parts.some((x) => x.kind === "conflict")}
    <div class="seg views" role="tablist" aria-label="Settle it">
      <button
        role="tab"
        class:on={view === "changes"}
        aria-selected={view === "changes"}
        onclick={() => (view = "changes")}>Change by change</button
      >
      <button role="tab" class:on={view === "whole"} aria-selected={view === "whole"} onclick={() => (view = "whole")}
        >Whole file</button
      >
    </div>
  {:else if parts?.reason}
    <p class="muted note">{parts.reason}</p>
  {/if}

  {#if !parts && view === "changes"}
    <RelayLoading say="Finding where the two versions disagree" mood="comparing" card={false} />
  {:else if view === "changes" && parts?.parts}
    <ConflictEditor parts={parts.parts} swapped={clash} bind:result bind:decided bind:total />
  {:else if error}<p class="muted">{error}</p>
  {:else if !d}<RelayLoading say="Comparing your version with theirs" mood="comparing" card={false} />
  {:else}<ChangeStory {d} file={name} bind:nav />{/if}

  {#snippet foot()}
    {#if view === "changes" && parts?.parts}
      <span class="left muted">{decided} of {total} decided</span>
      {#if decided < total}<button class="btn small" onclick={nextUndecided}>Next undecided ↓</button>{/if}
      <button class="btn small brand" disabled={decided < total || saving} onclick={save}
        >{saving ? "Saving…" : "Save and mark resolved"}</button
      >
    {:else}
      {#if nav && nav.count}
        <span class="left muted">Change {nav.at + 1} of {nav.count}</span>
        <button class="btn small" disabled={nav.at === 0} onclick={() => nav!.go(nav!.at - 1)}>↑ Previous</button>
        <button class="btn small" disabled={nav.at === nav.count - 1} onclick={() => nav!.go(nav!.at + 1)}
          >Next change ↓</button
        >
      {/if}
      {#if clash}
        <button class="btn small" onclick={() => pick("theirs", "kept your edits")}>Keep my edits</button>
        <button class="btn small" onclick={() => pick("ours", "took the pulled version")}>Take theirs</button>
      {:else}
        <button class="btn small" onclick={() => pick("ours", "kept your version")}>Keep mine</button>
        <button class="btn small" onclick={() => pick("theirs", "kept theirs")}>Keep theirs</button>
      {/if}
      <button class="btn small brand" onclick={() => pick("both", "kept both")}>Keep both</button>
    {/if}
  {/snippet}
</Drawer>

<style lang="scss">
  @use "tokens" as *;
  .views {
    margin-bottom: space(3);
  }
  .note {
    margin: 0 0 space(3);
  }
</style>
