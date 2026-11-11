<script lang="ts">
  import Drawer from "../components/Drawer.svelte";
  import { api, face } from "../lib/api.ts";
  import { act, app, toast } from "../lib/app.svelte.ts";
  import { git } from "../lib/git.svelte.ts";
  import { short } from "../lib/sync.svelte.ts";
  import FolderPicker from "../sync/FolderPicker.svelte";

  type Mode = "clone" | "create" | "add";
  let mode = $state<Mode>("clone");
  const sep = app.info?.sep || "/";
  let url = $state("");
  let parent = $state((app.info?.home ?? "") + sep + "code");
  let name = $state("");
  let nameTouched = false;
  let existing = $state("");
  let busy = $state(false);
  let picking = $state<"" | "parent" | "existing">("");

  // the folder name follows the repository address until you type your own
  $effect(() => {
    const m = /([^/:]+?)(\.git)?\/?$/.exec(url.trim());
    if (m && !nameTouched) name = m[1]!;
  });

  const SAY: Record<Mode, [string, string]> = {
    clone: ["Which repository should I copy?", "Paste the address of a repository on GitHub, GitLab or anywhere else."],
    create: ["Let's start something new!", "I'll make a fresh repository with a main branch."],
    add: ["Which repository is it?", "Pick a folder that's already a git repository."],
  };
  const GO: Record<Mode, string> = { clone: "Clone it", create: "Create it", add: "Open it" };

  async function go() {
    const dest = parent.replace(/[\\/]+$/, "") + sep + name.trim();
    const body =
      mode === "clone"
        ? { action: "clone", url: url.trim(), path: dest }
        : mode === "create"
          ? { action: "create", path: dest }
          : { action: "add", path: existing.trim() };
    if ((mode === "clone" && !url.trim()) || (mode !== "add" && !name.trim()) || (mode === "add" && !existing.trim()))
      return toast("Fill in the empty field first", { error: true });
    busy = true;
    const r = await act(null, () => api<{ id: string; path: string }>("POST", "/git/repos", body));
    busy = false;
    if (!r) return;
    toast({ clone: "Cloned! ", create: "Created! ", add: "Opened " }[mode] + short(r.path), { mood: "party" });
    git.adding = false;
    await git.refresh();
    git.select(r.id);
  }
</script>

<Drawer
  title={picking ? (picking === "parent" ? "Choose where to put it" : "Choose the repository") : "Add a repository"}
  sub="Clone, create, or open one you already have."
  onclose={() => (git.adding = false)}
>
  {#if picking}
    <FolderPicker
      start={(picking === "parent" ? parent : existing) || app.info?.home || ""}
      onpick={(dir) => {
        if (picking === "parent") parent = dir;
        else existing = dir;
        picking = "";
      }}
      onback={() => (picking = "")}
    />
  {:else}
    <div class="narrator">
      <img src={face("excited")} alt="" />
      <div class="bubble">
        <div class="say">{SAY[mode][0]}</div>
        <div class="hint">{SAY[mode][1]}</div>
      </div>
    </div>
    <div class="modes">
      <div class="seg" role="group" aria-label="How">
        {#each [["clone", "Clone"], ["create", "Create new"], ["add", "Open existing"]] as const as [id, label] (id)}
          <button class:on={mode === id} onclick={() => (mode = id)}>{label}</button>
        {/each}
      </div>
    </div>
    <form
      onsubmit={(e) => {
        e.preventDefault();
        void go();
      }}
    >
      {#if mode === "clone"}
        <label class="field"
          ><span class="label">Repository address</span>
          <input
            type="text"
            bind:value={url}
            placeholder="https://github.com/owner/repo.git  or  git@gitlab.com:owner/repo.git"
          />
          <small>Private repositories use your usual git login (SSH keys or a credential helper).</small></label
        >
      {/if}
      {#if mode !== "add"}
        <div class="field">
          <span class="label">Put it inside</span>
          <div class="inline">
            <input type="text" bind:value={parent} /><button
              type="button"
              class="btn small"
              onclick={() => (picking = "parent")}>Choose…</button
            >
          </div>
        </div>
        <label class="field"
          ><span class="label">Folder name</span><input
            type="text"
            bind:value={name}
            oninput={() => (nameTouched = true)}
            placeholder="folder name"
          /></label
        >
      {:else}
        <div class="field">
          <span class="label">Repository folder</span>
          <div class="inline">
            <input type="text" bind:value={existing} placeholder="the repository's folder" /><button
              type="button"
              class="btn small"
              onclick={() => (picking = "existing")}>Choose…</button
            >
          </div>
        </div>
      {/if}
      <button type="submit" hidden aria-hidden="true" tabindex="-1"></button>
    </form>
  {/if}
  {#snippet foot()}
    {#if !picking}
      <button class="btn ghost" onclick={() => (git.adding = false)}>Cancel</button>
      <button class="btn brand" disabled={busy} onclick={go}
        >{busy ? (mode === "clone" ? "Cloning…" : "Working…") : GO[mode]}</button
      >
    {/if}
  {/snippet}
</Drawer>

<style lang="scss">
  @use "tokens" as *;
  .modes {
    margin-bottom: space(4);
  }
</style>
