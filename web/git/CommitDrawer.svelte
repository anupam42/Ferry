<script lang="ts">
  import ChangeStory from "../components/ChangeStory.svelte";
  import Drawer from "../components/Drawer.svelte";
  import Icon from "../components/Icon.svelte";
  import RelayLoading from "../components/RelayLoading.svelte";
  import Section from "../components/Section.svelte";
  import { api, enc } from "../lib/api.ts";
  import { ask, askFields, toast } from "../lib/app.svelte.ts";
  import { git } from "../lib/git.svelte.ts";
  import type { CommitDetail, FileDiff } from "../lib/types.ts";

  /** One commit: who, when, its message, and each file's change story; plus what you can do with it. */
  const hash = git.commit!;
  let c = $state<CommitDetail | null>(null);
  let error = $state("");
  let open = $state("");
  let d = $state<FileDiff | null>(null);
  let diffError = $state("");

  $effect(() => {
    api<CommitDetail>("GET", git.url("commit") + "?hash=" + enc(hash)).then((r) => { c = r; if (r.files[0]) show(r.files[0].path); }, (e) => (error = (e as Error).message));
  });
  async function show(path: string) {
    open = path; d = null; diffError = "";
    try { d = await api<FileDiff>("GET", git.url("commit-diff") + "?hash=" + enc(hash) + "&path=" + enc(path)); }
    catch (e) { diffError = (e as Error).message; }
  }
  const STATUS: Record<string, [string, string]> = { A: ["Added", "green"], M: ["Modified", "blue"], D: ["Deleted", "red"], R: ["Renamed", "violet"], C: ["Copied", "violet"] };
  const close = () => (git.commit = null);
  const opened = $derived(c?.files.find((f) => f.path === open));

  async function branchHere() {
    const v = await askFields({ mood: "thinking", title: "New branch from this commit", text: "Start a branch here, for example to fix something in an older version.", yes: "Create branch", no: "Cancel", yesMood: "excited", primary: "yes",
      fields: [{ name: "name", label: "Branch name", placeholder: "e.g. hotfix-login" }, { name: "checkout", type: "check", label: "Switch to it now", value: true }] });
    if (v) { close(); await git.try<{ branch: string }>("branch-create", { name: v.name, from: hash, checkout: v.checkout }, (r) => `Created ${r.branch}`, "excited"); }
  }
  async function tagHere() {
    const v = await askFields({ mood: "thinking", title: "Tag this commit", text: "A tag is a name for a commit that never moves, like v1.2.0.", yes: "Create tag", no: "Cancel", yesMood: "excited", primary: "yes",
      fields: [{ name: "name", label: "Tag name", placeholder: "e.g. v1.2.0" }, { name: "message", label: "Note (optional)", placeholder: "e.g. First public release" }] });
    if (v) { close(); await git.try<{ tag: string }>("tag-create", { name: v.name, message: v.message, at: hash }, (r) => `Tagged ${r.tag}`, "party"); }
  }
  async function revert() {
    const ok = await ask({ mood: "thinking", title: "Revert this commit?", text: "I'll make a new commit that undoes exactly what this one did. History stays as it is, so it's safe even after pushing.", yes: "Revert", no: "Cancel", yesMood: "wink" });
    if (ok) { close(); await git.try("revert", { hash }, "Reverted: a new commit undoes it", "wink"); }
  }
  async function cherryPick() {
    const branch = git.state?.branch || "the current branch";
    const ok = await ask({ primary: "yes", mood: "excited", title: `Copy this commit onto ${branch}?`, text: "Cherry-picking applies the same change again as a new commit on your current branch.", yes: "Cherry-pick", no: "Cancel", yesMood: "party" });
    if (ok) { close(); await git.try("cherry-pick", { hash }, "Cherry-picked onto " + branch, "party"); }
  }
  async function copyId() {
    try { await navigator.clipboard.writeText(c?.hash ?? hash); toast("Copied the commit id", { mood: "wink" }); }
    catch { toast("Couldn't copy to the clipboard", { error: true }); }
  }
</script>

<Drawer title={c?.subject ?? "Commit"} sub={hash.slice(0, 7)} wide onclose={close}>
  {#if error}<p class="muted">{error}</p>
  {:else if !c}<RelayLoading say="Opening this commit" mood="thinking" card={false} />
  {:else}
    <div class="meta">
      <b>Author</b><span>{c.author} &lt;{c.email}&gt;</span>
      <b>When</b><span>{new Date(c.date).toLocaleString()}</span>
      <b>Commit</b><span class="mono">{c.hash}</span>
      {#if c.parents.length > 1}<b>Merge of</b><span class="mono">{c.parents.map((x) => x.slice(0, 7)).join(" + ")}</span>{/if}
    </div>
    {#if c.body}<div class="body">{c.body}</div>{/if}
    <Section id="c-files" title="Files in this commit" count={c.files.length}>
      <div class="files">
        {#each c.files as f (f.path)}
          {@const s = STATUS[f.status] ?? [f.status, ""]}
          <button class="file" class:on={f.path === open} onclick={() => show(f.path)}>
            <span class="pill {s[1]}">{s[0]}</span>
            <span class="grow">{f.path}{#if f.from}<small class="muted">  from {f.from}</small>{/if}</span>
            <span class="pill green">+{f.added}</span><span class="pill red">−{f.removed}</span>
          </button>
        {/each}
      </div>
    </Section>
    <div class="pane">
      {#if diffError}<p class="muted">{diffError}</p>
      {:else if !d}
        {#if open}<RelayLoading say="Comparing {open.split('/').pop()}" mood="comparing" card={false} sub={(opened?.added ?? 0) > 2000 ? "It's a big one, so this may take a moment." : ""} />{/if}
      {:else}{#key open}<ChangeStory {d} file={open.split("/").pop() ?? open} />{/key}{/if}
    </div>
  {/if}
  {#snippet foot()}
    {#if c}
      <button class="btn small left" onclick={copyId}>Copy id</button>
      <button class="btn small" onclick={branchHere}><Icon name="branch" size={16} />Branch from here</button>
      <button class="btn small" onclick={tagHere}><Icon name="tag" size={16} />Tag</button>
      <button class="btn small" onclick={revert}>Revert</button>
      <button class="btn small brand" onclick={cherryPick}>Cherry-pick</button>
    {/if}
  {/snippet}
</Drawer>

<style lang="scss">
  @use "tokens" as *;

  .meta { display: grid; grid-template-columns: auto 1fr; gap: space(1) + 2 space(4); margin-bottom: space(3) + 2; font-size: 13.5px; b { color: var(--muted); font-weight: $weight-semibold; } }
  .body { white-space: pre-wrap; margin-bottom: space(3) + 2; padding: space(3) space(4); border-radius: $radius-md; background: var(--card2); font-size: 13.5px; }
  .files { display: flex; flex-direction: column; gap: 2px; padding: 0 space(2) space(2); }
  .file { display: flex; align-items: center; gap: space(2) + 2; width: 100%; padding: space(2) space(3); border: 0; border-radius: $radius-md; background: none; color: var(--text); text-align: left; cursor: pointer; font-size: 13.5px;
    &:hover { background: var(--accent-soft); } &.on { background: var(--accent-soft); box-shadow: inset 3px 0 0 var(--accent); }
    .grow { flex: 1; min-width: 0; overflow-wrap: anywhere; } }
  .pane { margin-top: space(3) + 2; }
</style>
