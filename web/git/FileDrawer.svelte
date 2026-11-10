<script lang="ts">
  import ChangeStory from "../components/ChangeStory.svelte";
  import Drawer from "../components/Drawer.svelte";
  import Icon from "../components/Icon.svelte";
  import RelayLoading from "../components/RelayLoading.svelte";
  import { api, enc } from "../lib/api.ts";
  import { ago, plural } from "../lib/format.ts";
  import { git } from "../lib/git.svelte.ts";
  import type { Blame, FileContent, FileDiff, FileVersion } from "../lib/types.ts";
  import Avatar from "./Avatar.svelte";

  /** A file from the repository: its content, who changed each line, and its history. */
  const path = git.file!;
  const name = path.split("/").pop() ?? path;
  type View = "content" | "blame" | "history";
  let view = $state<View>("content");
  const q = "?path=" + enc(path);

  let content = $state<FileContent | null>(null);
  let blame = $state<Blame | null>(null);
  let versions = $state<FileVersion[] | null>(null);
  let error = $state("");
  $effect(() => {
    error = "";
    const fail = (e: unknown) => (error = (e as Error).message);
    if (view === "content" && !content) api<FileContent>("GET", git.url("file") + q).then((r) => (content = r), fail);
    if (view === "blame" && !blame) api<Blame>("GET", git.url("blame") + q).then((r) => (blame = r), fail);
    if (view === "history" && !versions) api<FileVersion[]>("GET", git.url("file-history") + q).then((r) => { versions = r; if (r[0]) void pick(r[0]); }, fail);
  });

  const lines = $derived(content && !content.binary && !content.tooBig ? content.text.replace(/\n$/, "").split("\n") : []);
  // newer changes glow brighter on the strip beside each run of lines
  const heat = $derived.by(() => {
    if (!blame?.chunks.length) return { of: (_: number) => 0, newest: 0 };
    const times = blame.chunks.map((c) => Date.parse(c.date) || Date.now());
    const oldest = Math.min(...times), newest = Math.max(...times), span = Math.max(newest - oldest, 1);
    return { of: (i: number) => (blame!.chunks[i]!.uncommitted ? 1 : (times[i]! - oldest) / span), newest };
  });

  let picked = $state<FileVersion | null>(null);
  let d = $state<FileDiff | null>(null);
  async function pick(v: FileVersion) {
    picked = v; d = null;
    try { d = await api<FileDiff>("GET", git.url("commit-diff") + "?hash=" + enc(v.hash) + "&path=" + enc(v.path)); }
    catch (e) { error = (e as Error).message; }
  }
  const WORD: Record<string, [string, string]> = { A: ["Created", "green"], M: ["Changed", "blue"], D: ["Deleted", "red"], R: ["Renamed", "violet"], C: ["Copied", "violet"] };
  const shortDate = (iso: string) => Date.now() - Date.parse(iso) < 7 * 86400e3 ? ago(iso) : new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
</script>

<Drawer title={name} sub={path} wide onclose={() => (git.file = null)}>
  <div class="seg views" role="tablist" aria-label="Show">
    {#each [["content", "Content", "files"], ["blame", "Who changed what", "user"], ["history", "History", "clock"]] as const as [v, label, ic] (v)}
      <button type="button" role="tab" class:on={view === v} aria-selected={view === v} onclick={() => (view = v)}><Icon name={ic} size={15} />{label}</button>
    {/each}
  </div>

  {#if error}<p class="muted">{error}</p>
  {:else if view === "content"}
    {#if !content}<RelayLoading say="Reading {name}" card={false} />
    {:else if content.binary}<div class="empty-row">That's a binary file, so I can't show it as text.</div>
    {:else if content.tooBig}<div class="empty-row">That file is too large to show here (over 1 MB).</div>
    {:else}<div class="code mono">{#each lines as l, i (i)}<div class="line"><span class="n">{i + 1}</span><span class="t">{l || " "}</span></div>{/each}</div>{/if}
  {:else if view === "blame"}
    {#if !blame}<RelayLoading say="Finding who changed each line" mood="thinking" card={false} />
    {:else if !blame.chunks.length}<div class="empty-row">This file is empty.</div>
    {:else}
      {@const people = new Set(blame.chunks.filter((c) => !c.uncommitted).map((c) => c.author)).size}
      <div class="sum muted">{plural(people, "person", "people")} · {plural(new Set(blame.chunks.map((c) => c.hash)).size, "commit")} · newest change {ago(new Date(heat.newest).toISOString())}{blame.truncated ? " · showing the first 6000 lines" : ""}</div>
      <div class="blame">
        {#each blame.chunks as c, i (i)}
          <div class="chunk" class:mine={c.uncommitted} style:--heat={0.15 + heat.of(i) * 0.85}>
            <button type="button" class="meta" disabled={c.uncommitted} title={c.uncommitted ? "Not committed yet" : `${c.subject}\n${c.author} · ${new Date(c.date).toLocaleString()}`} onclick={() => (git.commit = c.hash)}>
              <Avatar author={c.author} size={24} />
              <span class="txt"><span class="subj">{c.subject}</span><small>{c.uncommitted ? "you, just now" : `${c.author} · ${ago(c.date)}`}</small></span>
            </button>
            <div class="code mono">{#each c.lines as l, j (j)}<div class="line"><span class="n">{c.start + j}</span><span class="t">{l || " "}</span></div>{/each}</div>
          </div>
        {/each}
      </div>
    {/if}
  {:else}
    {#if !versions}<RelayLoading say="Reading this file's history" mood="thinking" card={false} />
    {:else if !versions.length}<div class="empty-row">This file hasn't been committed yet.</div>
    {:else}
      <div class="sum muted">{plural(versions.length, "change")} by {plural(new Set(versions.map((v) => v.author)).size, "person", "people")}{versions.some((v) => v.path !== path) ? " · followed through renames" : ""}</div>
      <div class="versions">
        {#each versions as v (v.hash)}
          {@const w = WORD[v.status] ?? [v.status, ""]}
          <button type="button" class="version" class:on={picked?.hash === v.hash} onclick={() => pick(v)}>
            <Avatar author={v.author} />
            <span class="main"><span class="subj">{v.subject}</span><small>{v.author} · {shortDate(v.date)} · <span class="mono">{v.short}</span>{v.path !== path ? ` · was ${v.path}` : ""}</small></span>
            <span class="pill {w[1]}">{w[0]}</span>
            <span class="nums"><span class="plus">+{v.added}</span> <span class="minus">−{v.removed}</span></span>
          </button>
        {/each}
      </div>
      <div class="diff">
        {#if picked && !d}<RelayLoading say="Comparing" mood="comparing" card={false} />
        {:else if d && picked}{#key picked.hash}<ChangeStory {d} file={picked.path.split("/").pop() ?? picked.path} />{/key}{/if}
      </div>
    {/if}
  {/if}
</Drawer>

<style lang="scss">
  @use "tokens" as *;
  @use "mixins" as *;

  .views { margin-bottom: space(3) + 2; button { display: inline-flex; align-items: center; gap: space(1) + 2; } }
  .sum { font-size: fs(sm); margin-bottom: space(2) + 2; }
  .code { font-size: fs(sm); line-height: 1.6; background: var(--card2); border-radius: $radius-md; padding: space(2) 0; overflow-x: auto; }
  .line { display: grid; grid-template-columns: 54px 1fr; }
  .n { color: var(--faint); text-align: right; padding-right: space(3); user-select: none; }
  .t { white-space: pre; padding-right: space(3); }
  .blame { display: flex; flex-direction: column; gap: 2px; }
  .chunk { display: grid; grid-template-columns: 240px minmax(0, 1fr); border-left: 4px solid color-mix(in srgb, var(--accent) calc(var(--heat) * 100%), transparent);
    .code { border-radius: 0; padding: space(1) 0; }
    &.mine { border-left-color: var(--amber); } }
  .meta { display: flex; align-items: flex-start; gap: space(2); padding: space(1) + 2 space(2) + 2; border: 0; background: var(--card-solid); text-align: left; cursor: pointer; color: var(--text); min-width: 0;
    &:hover:not(:disabled) { background: var(--accent-soft); } &:disabled { cursor: default; } }
  .txt { min-width: 0; display: flex; flex-direction: column; font-size: 12.5px; .subj { @include ellipsis; font-weight: $weight-semibold; } small { color: var(--muted); @include ellipsis; } }
  .versions { display: flex; flex-direction: column; gap: 2px; max-height: 40vh; overflow-y: auto; margin-bottom: space(3); }
  .version { display: grid; grid-template-columns: 28px minmax(0, 1fr) auto auto; gap: space(3); align-items: center; padding: space(2) space(3); border: 0; border-radius: $radius-md;
    background: none; color: var(--text); text-align: left; cursor: pointer;
    &:hover { background: var(--accent-soft); } &.on { background: var(--accent-soft); box-shadow: inset 3px 0 0 var(--accent); } }
  .main { min-width: 0; display: flex; flex-direction: column; .subj { @include ellipsis; font-weight: $weight-semibold; font-size: 13.5px; } small { color: var(--muted); @include ellipsis; } }
  .nums { font-family: $font-mono; font-size: 12px; white-space: nowrap; .plus { color: var(--green); } .minus { color: var(--red); } }
  @include below(tablet) { .chunk { grid-template-columns: minmax(0, 1fr); } }
</style>
