<script lang="ts">
  import Dock, { type DockItem } from "../components/Dock.svelte";
  import Icon from "../components/Icon.svelte";
  import { face } from "../lib/api.ts";
  import { look } from "../lib/look.svelte.ts";
  import { short, sync, type View } from "../lib/sync.svelte.ts";
  import type { PairStatus } from "../lib/types.ts";
  import CommandBar from "./CommandBar.svelte";
  import ActivityView from "./ActivityView.svelte";
  import CommitView from "./CommitView.svelte";
  import FilesView from "./FilesView.svelte";
  import HistoryView from "./HistoryView.svelte";
  import StatsView from "./StatsView.svelte";

  let { p }: { p: PairStatus } = $props();
  const m = $derived(sync.moodOf(p));
  const items = $derived<DockItem[]>([
    { id: "files", name: "Files", icon: "files", count: p.conflicts.length, alert: true },
    ...(p.is_git ? [{ id: "git", name: "Commit", icon: "commit", count: (p.git_status || []).length }] : []),
    { id: "history", name: "History", icon: "clock" },
    { id: "stats", name: "Stats", icon: "chart" },
    { id: "activity", name: "Activity", icon: "list" },
  ]);
  $effect(() => { if (!items.some((i) => i.id === sync.view)) sync.view = "files"; });
  const horizontal = $derived(look.get("dock") === "horizontal");
</script>

<div class="layout" class:dock-h={horizontal}>
  <div class="content">
    {#if horizontal}<Dock label="Folder pair" {items} current={sync.view} onpick={(id) => (sync.view = id as View)} />{/if}
    <div class="crumbs"><span>Folder pairs</span><span>›</span><b>{p.name}</b></div>
    <div class="title-row">
      <h1>{p.name}</h1>
      <div class="grow"></div>
      <label class="search"><Icon name="search" size={18} /><input type="text" placeholder="Search files…" aria-label="Search files" bind:value={sync.query} /></label>
      <CommandBar {p} {m} />
    </div>
    <div class="paths">
      <code title="your working folder">{short(p.source)}</code><span>{p.mode === "two-way" ? "⇄" : "→"}</span><code title="target">{p.remote || short(p.target)}</code>
      <span>{p.mode === "two-way" ? "both ways" : "one way"}{p.is_git ? ` · git ${p.branch || ""}` : ""} · this session +{p.added} ~{p.updated} −{p.deleted}</span>
    </div>
    <div class="card hero">
      <img src={face(m.face)} alt="Relay" class:anim={m.anim} class:float={!m.anim} />
      <div class="bubble" role="status">
        <div class="say">{m.say}</div>
        <div class="hint">{m.hint}</div>
        {#if m.progress != null}<div class="track"><div class="fill" style:width="{Math.round(m.progress * 100)}%"></div></div>{/if}
      </div>
    </div>
    <div class="body">
      {#if sync.view === "files"}<FilesView {p} />
      {:else if sync.view === "git"}<CommitView {p} />
      {:else if sync.view === "history"}{#key sync.bump}<HistoryView {p} />{/key}
      {:else if sync.view === "stats"}<StatsView {p} />
      {:else}<ActivityView {p} />{/if}
    </div>
  </div>
  {#if !horizontal}<Dock label="Folder pair" {items} current={sync.view} onpick={(id) => (sync.view = id as View)} />{/if}
</div>

<style lang="scss">
  @use "tokens" as *;
  @use "mixins" as *;

  .layout { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: space(4) + 2; align-items: start; &.dock-h { grid-template-columns: minmax(0, 1fr); } }
  .content { min-width: 0; display: flex; flex-direction: column; gap: space(4); }
  .crumbs { font-size: 14px; color: var(--muted); display: flex; gap: space(2); align-items: center; padding: space(1) + 2 space(1) 0; b { color: var(--text); font-weight: $weight-semibold; } }
  .title-row { display: flex; align-items: center; gap: space(3) + 2; flex-wrap: wrap; padding: 0 space(1); h1 { font-size: fs(xxl); letter-spacing: -.01em; } .grow { flex: 1; } }
  .search {
    display: flex; align-items: center; gap: space(2); background: var(--pill); border-radius: $radius-pill; padding: space(2) space(4); min-width: 240px;
    box-shadow: 0 2px 8px rgba(9, 35, 72, .06); color: var(--muted);
    input { border: 0; outline: 0; background: none; flex: 1; min-width: 0; padding: 2px 0; border-radius: 0; color: var(--text); }
  }
  .paths {
    display: flex; gap: space(2); align-items: center; flex-wrap: wrap; padding: 0 space(1); font-size: fs(sm); color: var(--muted);
    code { background: var(--card); padding: 3px space(2) + 2; border-radius: $radius-pill; font-family: $font-mono; font-size: 12px; color: var(--text); max-width: 100%; overflow-wrap: anywhere; }
  }
  .hero {
    display: flex; align-items: center; gap: space(4) + 2; padding: space(3) + 2 space(5) + 2;
    > img { width: 112px; height: 82px; flex: none; &.anim { width: 150px; height: 71px; } }
  }
  .track { height: 9px; border-radius: $radius-pill; background: var(--card2); overflow: hidden; margin-top: space(2); }
  .fill { height: 100%; border-radius: $radius-pill; @include brand-gradient; @include motion { transition: width .35s ease; } }
  .body { display: flex; flex-direction: column; gap: space(3) + 2; }
  @include below(phone) { .layout { grid-template-columns: minmax(0, 1fr); padding-bottom: 78px; } .search { min-width: 0; flex: 1; } }
</style>
