<script lang="ts">
  import ChangeStory from "../components/ChangeStory.svelte";
  import Drawer from "../components/Drawer.svelte";
  import RelayLoading from "../components/RelayLoading.svelte";
  import { api, face } from "../lib/api.ts";
  import { plural } from "../lib/format.ts";
  import { discardFiles, fileURL, git } from "../lib/git.svelte.ts";
  import type { FileDiff } from "../lib/types.ts";

  /** A changed file: stage single lines (or whole changes), or look at what's already staged. */
  const path = git.review!;
  const name = path.split("/").pop()!;
  let staged = $state(false);
  let d = $state<FileDiff | null>(null);
  let error = $state("");
  let picked = $state<Record<number, boolean>>({});

  async function load() {
    d = null; error = "";
    try {
      const r = await api<FileDiff>("GET", fileURL("diff", path, staged));
      // every changed line starts picked
      picked = Object.fromEntries(r.lines.flatMap((l, i) => (l.op === "+" || l.op === "-" ? [[i, true]] : [])));
      d = r;
    } catch (e) { error = (e as Error).message; }
  }
  $effect(() => { void staged; void load(); });

  interface Row { i: number; op: " " | "+" | "-"; no: number; text: string }
  interface Hunk { at: number; rows: Row[] }
  const hunks = $derived.by(() => {
    const out: Hunk[] = [];
    if (!d) return out;
    let oldNo = 1, newNo = 1, cur: Hunk | null = null;
    d.lines.forEach((l, i) => {
      if (l.op === "@") {
        const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(l.text);
        if (m) { oldNo = +m[1]!; newNo = +m[2]!; }
        cur = { at: newNo, rows: [] };
        out.push(cur);
        return;
      }
      if (!cur) return;
      if (l.op === " ") { cur.rows.push({ i, op: " ", no: newNo, text: l.text }); oldNo++; newNo++; }
      else if (l.op === "+") { cur.rows.push({ i, op: "+", no: newNo, text: l.text }); newNo++; }
      else { cur.rows.push({ i, op: "-", no: oldNo, text: l.text }); oldNo++; }
    });
    return out.filter((h) => h.rows.some((r) => r.op !== " "));
  });
  const all = $derived(Object.keys(picked).length);
  const chosen = $derived(Object.entries(picked).filter(([, v]) => v).map(([k]) => +k));
  const hunkState = (h: Hunk) => {
    const c = h.rows.filter((r) => r.op !== " ");
    const on = c.filter((r) => picked[r.i]).length;
    return { on: on === c.length, some: on > 0 && on < c.length };
  };
  function setHunk(h: Hunk, v: boolean) { for (const r of h.rows) if (r.op !== " ") picked[r.i] = v; }

  async function stage() {
    const r = chosen.length === all
      ? await git.try("stage", { files: [path] }, "Staged " + path)
      : await git.try("stage-lines", { path, lines: chosen }, `Staged ${plural(chosen.length, "line")}`);
    if (r) await load();
  }
  const close = () => (git.review = null);
</script>

<Drawer title={name} sub={path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "top folder"} wide onclose={close}>
  <div class="top">
    <span class="muted">Tick the lines you want in the next commit. Lines you leave unticked stay changed in your folder.</span>
    <div class="seg" role="group" aria-label="Which changes">
      <button class:on={!staged} onclick={() => (staged = false)}>Not staged yet</button>
      <button class:on={staged} onclick={() => (staged = true)}>Staged</button>
    </div>
  </div>
  {#if error}<p class="muted">{error}</p>
  {:else if !d}<RelayLoading say="Comparing the two versions" mood="comparing" card={false} />
  {:else if staged}<ChangeStory {d} file={name} />
  {:else if !hunks.length}
    <div class="narrator"><img src={face("happy")} alt="" /><div class="bubble"><div class="say">Nothing left to stage here.</div>
      <div class="hint">{d.lines[0]?.text ?? "Everything in this file is already staged."}</div></div></div>
  {:else}
    {#each hunks as h, k (k)}
      {@const hs = hunkState(h)}
      <div class="hunk">
        <div class="hunk-head">
          <input type="checkbox" aria-label="Include this whole change" checked={hs.on} indeterminate={hs.some} onchange={(e) => setHunk(h, e.currentTarget.checked)} />
          <b>Change {k + 1}</b><span class="muted">near line {h.at}</span>
        </div>
        <div class="lines">
          {#each h.rows as r (r.i)}
            {#if r.op === " "}
              <div class="ln ctx"><span></span><span class="no">{r.no}</span><span class="op"></span><span class="tx">{r.text || " "}</span></div>
            {:else}
              <label class="ln {r.op === '+' ? 'add' : 'del'}" class:off={!picked[r.i]}>
                <span class="cbx"><input type="checkbox" bind:checked={picked[r.i]} aria-label="{r.op === '+' ? 'add' : 'remove'}: {r.text}" /></span>
                <span class="no">{r.no}</span><span class="op">{r.op === "+" ? "+" : "−"}</span><span class="tx">{r.text || " "}</span>
              </label>
            {/if}
          {/each}
        </div>
      </div>
    {/each}
  {/if}
  {#snippet foot()}
    {#if staged}
      <button class="btn" onclick={async () => { await git.try("unstage", { files: [path] }, "Unstaged " + path); await load(); }}>Unstage this file</button>
    {:else if d && hunks.length}
      <button class="btn ghost danger left" onclick={() => { close(); void discardFiles([path], path); }}>Discard this file</button>
      <button class="btn brand" disabled={!chosen.length} onclick={stage}>{chosen.length === all ? "Stage the whole file" : `Stage ${plural(chosen.length, "picked line")}`}</button>
    {/if}
  {/snippet}
</Drawer>

<style lang="scss">
  @use "tokens" as *;

  .top { display: flex; justify-content: space-between; align-items: center; gap: space(3); flex-wrap: wrap; margin-bottom: space(3) + 2; }
  .hunk { border-radius: $radius-lg + 2; border: 2px solid var(--line); margin-bottom: space(3) + 2; overflow: hidden; }
  .hunk-head { display: flex; gap: space(2) + 2; align-items: center; padding: space(2) + 2 space(3) + 2; background: var(--card2); font-size: 13.5px;
    input { accent-color: var(--accent); width: 16px; height: 16px; } }
  .lines { font-family: $font-mono; font-size: fs(sm); }
  .ln { display: grid; grid-template-columns: 30px 54px 22px 1fr; align-items: start;
    .cbx { display: grid; place-items: center; padding-top: 3px; input { accent-color: var(--accent); width: 15px; height: 15px; } }
    .no { color: var(--faint); text-align: right; padding: 3px space(2) 3px 0; user-select: none; }
    .op { text-align: center; padding: 3px 0; user-select: none; font-weight: $weight-bold; }
    .tx { padding: 3px space(3) 3px space(1); white-space: pre-wrap; overflow-wrap: anywhere; }
    &.ctx { color: var(--muted); }
    &.add { background: var(--ins); cursor: pointer; .op, .tx { color: var(--ins-text); } }
    &.del { background: var(--del); cursor: pointer; .op, .tx { color: var(--del-text); } }
    &.off { opacity: .45; } }
</style>
