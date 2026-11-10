<script lang="ts">
  import Dock, { type DockAction, type DockItem } from "../components/Dock.svelte";
  import Icon from "../components/Icon.svelte";
  import RelayLoading from "../components/RelayLoading.svelte";
  import { face } from "../lib/api.ts";
  import { app } from "../lib/app.svelte.ts";
  import { ago } from "../lib/format.ts";
  import { doFetch, doPull, doPush, git, remoteJob, removeRepo, repoMood, type GitView, type RemoteJob } from "../lib/git.svelte.ts";
  import { look } from "../lib/look.svelte.ts";
  import { short } from "../lib/sync.svelte.ts";
  import type { RepoEntry } from "../lib/types.ts";
  import BranchesView from "./BranchesView.svelte";
  import ChangesView from "./ChangesView.svelte";
  import FilesView from "./FilesView.svelte";
  import InsightsView from "./InsightsView.svelte";
  import JiraView from "./JiraView.svelte";
  import PrsView from "./PrsView.svelte";
  import HistoryView from "./HistoryView.svelte";
  import StashesView from "./StashesView.svelte";
  import TagsView from "./TagsView.svelte";
  import UndoView from "./UndoView.svelte";
  import WorktreesView from "./WorktreesView.svelte";
  import OperationCard from "./OperationCard.svelte";
  import RemoteCard from "./RemoteCard.svelte";

  let { r }: { r: RepoEntry } = $props();
  const st = $derived(git.state);
  const m = $derived(repoMood(st, git.error));
  const horizontal = $derived(look.get("dock") === "horizontal");

  const items = $derived<DockItem[]>(([
    ["files", "Files", "folder", 0], ["changes", "Changes", "files", st ? st.files.filter((f) => !f.conflicted).length : 0], ["history", "History", "clock", 0],
    ["insights", "Insights", "chart", 0], ["branches", "Branches", "branch", 0], ["stashes", "Stashes", "box", st?.stashes ?? 0], ["prs", "Pull requests", "pr", 0],
    ["issues", "Jira", "ticket", 0], ["tags", "Tags", "tag", 0], ["worktrees", "Worktrees", "tree", 0], ["undo", "Undo anything", "undo", 0],
  ] as const).filter(([id]) => id !== "issues" || app.conns?.jira.connected).map(([id, name, icon, count]) => ({ id, name, icon, count })));
  $effect(() => { if (!items.some((i) => i.id === git.view)) git.view = "changes"; });

  const rc = $derived(git.remote[git.selected]);
  const stateOf = (job: RemoteJob) => (git.busy === job ? "working" : git.done?.job === job ? "done" : "") as DockAction["state"];
  const actions = $derived.by<DockAction[]>(() => {
    const behind = st?.behind ?? 0, ahead = st?.ahead ?? 0, publish = !!st && !st.upstream;
    const checked = rc ? (rc.error ? "couldn't reach the remote" : "checked " + ago(rc.checkedAt)) : "";
    const toPush = ahead > 0 || publish;
    return [
      { id: "fetch", name: git.busy === "fetch" ? "Fetching…" : "Fetch", icon: "cloud", tip: "Fetch" + (checked ? " · " + checked : ""), state: stateOf("fetch"), disabled: !!git.busy,
        onclick: () => remoteJob("fetch", doFetch) },
      { id: "pull", name: git.busy === "pull" ? "Pulling…" : behind ? `Pull ${behind} commit${behind > 1 ? "s" : ""}` : "Pull", icon: "down", count: behind, hot: !!behind,
        tone: behind && !git.busy ? "incoming" : "", state: stateOf("pull"), disabled: !!git.busy, onclick: () => remoteJob("pull", () => doPull()) },
      { id: "push", name: git.busy === "push" ? "Pushing…" : publish ? "Publish branch" : ahead ? `Push ${ahead} commit${ahead > 1 ? "s" : ""}` : "Push", icon: "up", count: ahead, hot: toPush,
        tone: toPush && !git.busy && !behind ? "outgoing" : "", tip: ahead && behind ? "Push · pull first" : undefined, state: stateOf("push"), disabled: !!git.busy,
        onclick: () => remoteJob("push", () => doPush()) },
    ];
  });
</script>

<div class="layout" class:dock-h={horizontal}>
  <div class="content">
    {#if horizontal}<Dock label="Repository" {items} current={git.view} onpick={(id) => (git.view = id as GitView)} {actions} />{/if}
    <div class="crumbs"><span>Repositories</span><span>›</span><b>{r.name}</b></div>
    <div class="title-row">
      <h1>{r.name}</h1>
      <button class="pill blue branch" onclick={() => (git.view = "branches")} title="Branches">
        <Icon name="branch" size={15} />{st ? st.branch || `detached at ${st.head}` : "…"}
      </button>
      {#if st?.ahead}<span class="pill blue" title="commits to push">↑ {st.ahead}</span>{/if}
      {#if st?.behind}<span class="pill amber" title="commits to pull">↓ {st.behind}</span>{/if}
    </div>
    <div class="paths">
      <code>{short(r.path)}</code>
      {#each r.pairs as n (n)}<span class="pill violet" title="a folder pair syncs into this repository">synced by {n}</span>{/each}
      {#if st?.upstream}<span>tracking {st.upstream}</span>{/if}
      {#if r.standalone}<button class="btn small ghost" onclick={() => removeRepo(r)}>Remove from list</button>{/if}
    </div>
    <div class="card hero">
      <img src={face(m.face)} alt="Relay" class="float" />
      <div class="bubble" role="status"><div class="say">{m.say}</div><div class="hint">{m.hint}</div></div>
    </div>
    {#if st}
      <OperationCard {st} />
      <RemoteCard {st} />
    {/if}
    <div class="body">
      {#if !st}
        {#if git.error}<div class="card empty-row">{git.error}</div>
        {:else}<RelayLoading say="Opening the repository" sub="Looking at branches and changes." />{/if}
      {:else if git.view === "files"}
        <FilesView {st} />
      {:else if git.view === "changes"}
        <ChangesView {st} />
      {:else if git.view === "history"}
        <HistoryView {st} />
      {:else if git.view === "insights"}
        <InsightsView {st} />
      {:else if git.view === "branches"}
        <BranchesView {st} />
      {:else if git.view === "stashes"}
        <StashesView />
      {:else if git.view === "tags"}
        <TagsView {st} />
      {:else if git.view === "worktrees"}
        <WorktreesView {st} />
      {:else if git.view === "prs"}
        <PrsView />
      {:else if git.view === "issues"}
        <JiraView {st} />
      {:else}
        <UndoView {st} />
      {/if}
    </div>
  </div>
  {#if !horizontal}<Dock label="Repository" {items} current={git.view} onpick={(id) => (git.view = id as GitView)} {actions} />{/if}
</div>

<style lang="scss">
  @use "tokens" as *;
  @use "mixins" as *;

  .layout { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: space(4) + 2; align-items: start; &.dock-h { grid-template-columns: minmax(0, 1fr); } }
  .content { min-width: 0; display: flex; flex-direction: column; gap: space(4); }
  .crumbs { font-size: 14px; color: var(--muted); display: flex; gap: space(2); align-items: center; padding: space(1) + 2 space(1) 0; b { color: var(--text); font-weight: $weight-semibold; } }
  .title-row { display: flex; align-items: center; gap: space(3); flex-wrap: wrap; padding: 0 space(1); h1 { font-size: fs(xxl); letter-spacing: -.01em; } }
  .branch { border: 0; cursor: pointer; font-size: 14px; padding: space(1) + 2 space(3) + 2; }
  .paths {
    display: flex; gap: space(2); align-items: center; flex-wrap: wrap; padding: 0 space(1); font-size: fs(sm); color: var(--muted);
    code { background: var(--card); padding: 3px space(2) + 2; border-radius: $radius-pill; font-family: $font-mono; font-size: 12px; color: var(--text); max-width: 100%; overflow-wrap: anywhere; }
  }
  .hero { display: flex; align-items: center; gap: space(4) + 2; padding: space(3) + 2 space(5) + 2; > img { width: 112px; height: 82px; flex: none; } }
  .body { display: flex; flex-direction: column; gap: space(3) + 2; }
  @include below(phone) { .layout { grid-template-columns: minmax(0, 1fr); padding-bottom: 78px; } }
</style>
