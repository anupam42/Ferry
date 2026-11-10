<script lang="ts" module>
  /** Lets the drawer around a story put Previous / Next in its footer. */
  export interface StoryNav { at: number; count: number; go: (i: number) => void }
</script>

<script lang="ts">
  import { face } from "../lib/api.ts";
  import { parseDiff, story, wordDiff, type Change } from "../lib/diff.ts";
  import { ms, plural } from "../lib/look.svelte.ts";
  import type { FileDiff } from "../lib/types.ts";
  import ChangeMap from "./ChangeMap.svelte";
  import Compare from "./Compare.svelte";
  import Icon from "./Icon.svelte";
  import SplitView from "./SplitView.svelte";

  /**
   * Relay's change story: what changed in plain words, a map of where, and
   * each change as a card (or side by side, or the classic diff). J/K step
   * through the changes. nav (bindable) feeds a footer's Previous / Next.
   */
  let { d, file, nav = $bindable() }: { d: FileDiff; file: string; nav?: StoryNav } = $props();

  type ViewKind = "story" | "split" | "classic";
  const saved = localStorage.getItem("ferry-diffview") as ViewKind | null;
  let view = $state<ViewKind>(saved && ["story", "split", "classic"].includes(saved) ? saved : "story");
  const parsed = $derived(parseDiff(d.lines));
  const st = $derived(story(parsed, file));
  let at = $state(0);
  let cards: HTMLElement[] = $state([]);
  let starts: HTMLElement[] = $state([]);
  let big = $state(false);
  const targets = $derived(view === "split" ? starts : view === "story" ? cards.filter(Boolean) : []);

  function go(i: number, scroll = true) {
    if (!targets.length) return;
    at = Math.max(0, Math.min(targets.length - 1, i));
    if (scroll) targets[at]?.scrollIntoView({ behavior: ms(1) ? "smooth" : "auto", block: "start" });
  }
  $effect(() => { nav = { at, count: targets.length, go }; });

  function pick(v: ViewKind) { view = v; localStorage.setItem("ferry-diffview", v); }
  function key(e: KeyboardEvent) {
    if (big || (e.target as HTMLElement).closest?.("input, textarea, select") || document.querySelector('[role="alertdialog"]')) return;
    if (e.key === "j") go(at + 1);
    if (e.key === "k") go(at - 1);
  }
  const title = (c: Change) => {
    const n = Math.max(c.removed.length, c.added.length);
    return c.kind === "add" ? `Added ${plural(c.added.length, "line")}` : c.kind === "del" ? `Removed ${plural(c.removed.length, "line")}` : `Edited ${plural(n, "line")}`;
  };
  const pairs = (c: Change) => (c.kind === "edit" ? Math.min(c.removed.length, c.added.length) : 0);
</script>

<svelte:window onkeydown={key} />

{#snippet ln(cls: string, no: number | undefined, op: string, text: string)}
  <div class="ln {cls}"><span class="no">{no ?? ""}</span><span class="op">{op}</span><span class="tx">{text || " "}</span></div>
{/snippet}

{#if !parsed.changes.length}
  <div class="narrator">
    <img src={face(parsed.notes.length ? "thinking" : "happy")} alt="" />
    <div class="bubble">
      <div class="say">{parsed.notes.length ? "I can't show this one line by line." : "Nothing changed here."}</div>
      <div class="hint">{parsed.notes[0] || "These two versions are identical."}</div>
    </div>
  </div>
{:else}
  <div class="narrator">
    <img src={face("thinking")} alt="" />
    <div class="bubble"><div class="say">{st.title}</div><div class="hint">{st.detail} Green is new, red is gone, and highlighted words show exactly what was edited.</div></div>
  </div>
  <div class="chips">
    {#if st.added}<span class="pill green">+ {plural(st.added, "new line")}</span>{/if}
    {#if st.edited}<span class="pill amber">✎ {plural(st.edited, "edited line")}</span>{/if}
    {#if st.removed}<span class="pill red">− {plural(st.removed, "removed line")}</span>{/if}
  </div>
  <ChangeMap {parsed} at={view === "classic" ? -1 : at} go={(i) => go(i)} />
{/if}

<div class="sides"><div class="side"><b>Before</b>{d.before}</div><div class="side"><b>After</b>{d.after}</div></div>
<div class="bar">
  <span class="muted tip">Tip: press J and K to jump between changes.</span>
  <span class="inline">
    {#if parsed.changes.length}<button class="btn small" title="Before and after side by side, filling the screen" onclick={() => (big = true)}><Icon name="expand" size={16} />Open big</button>{/if}
    <div class="seg" role="group" aria-label="How to show the changes">
      <button class:on={view === "story"} onclick={() => pick("story")}>Story</button>
      <button class:on={view === "split"} onclick={() => pick("split")}>Side by side</button>
      <button class:on={view === "classic"} onclick={() => pick("classic")}>Classic</button>
    </div>
  </span>
</div>
{#if d.more}
  <div class="more">This file is very big, so I'm showing the first {d.lines.length.toLocaleString()} changed lines. {d.more.toLocaleString()} more aren't shown.</div>
{/if}

{#if view === "split"}
  <SplitView {d} {at} bind:starts />
{:else if view === "classic"}
  <div class="classic lines">
    {#each d.lines as l, i (i)}
      {#if l.op === "@"}<div class="hdr">{l.text}</div>
      {:else}{@render ln(l.op === "+" ? "add" : l.op === "-" ? "del" : "ctx", undefined, l.op === " " ? "" : l.op === "-" ? "−" : "+", l.text)}{/if}
    {/each}
  </div>
{:else}
  {#each parsed.changes as c, k (k)}
    <div class="change" class:on={k === at} bind:this={cards[k]} onclick={() => go(k, false)} onkeydown={() => {}} role="presentation">
      <div class="change-head">
        <span class="ic {c.kind}">{({ add: "+", del: "−", edit: "✎" })[c.kind]}</span><b>{title(c)}</b><span class="muted">near line {c.at}</span>
        <span class="grow"></span><span class="muted">{k + 1} / {parsed.changes.length}</span>
      </div>
      <div class="lines">
        {#each c.before as b, i (i)}{@render ln("ctx", b.newNo, "", b.text)}{/each}
        {#each c.removed.slice(0, pairs(c)) as r, i (i)}
          {@const w = wordDiff(r.text, c.added[i]!.text)}
          <div class="edit-pair">
            <div class="lab">Line {c.added[i]!.newNo} · before</div>
            <div class="txt">{#each w as p, j (j)}{#if p.op === ""}{p.t}{:else if p.op === "-"}<del class="w">{p.t}</del>{/if}{/each}</div>
            <div class="lab">after</div>
            <div class="txt">{#each w as p, j (j)}{#if p.op === ""}{p.t}{:else if p.op === "+"}<ins class="w">{p.t}</ins>{/if}{/each}</div>
          </div>
        {/each}
        {#each c.removed.slice(pairs(c)) as r, i (i)}{@render ln("del", r.oldNo, "−", r.text)}{/each}
        {#each c.added.slice(pairs(c)) as a, i (i)}{@render ln("add", a.newNo, "+", a.text)}{/each}
        {#each c.after as a, i (i)}{@render ln("ctx", a.newNo, "", a.text)}{/each}
      </div>
    </div>
  {/each}
{/if}

{#if big}<Compare {d} {file} onclose={() => (big = false)} />{/if}

<style lang="scss">
  @use "tokens" as *;

  .sides { display: grid; grid-template-columns: 1fr 1fr; gap: space(2) + 2; margin-bottom: space(3); font-size: fs(sm); }
  .side { border-radius: $radius-md + 2; padding: space(2) space(3); background: var(--card2); b { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); } }
  .bar { display: flex; justify-content: space-between; align-items: center; gap: space(2) + 2; margin-bottom: space(2) + 2; flex-wrap: wrap; }
  .tip { font-size: fs(sm); }
  .more { margin: space(3) + 2 0 space(1); padding: space(3) space(3) + 2; border-radius: $radius-md + 2; background: var(--accent-soft); color: var(--muted); font-size: 13px; }
  .change { border-radius: $radius-lg + 2; border: 2px solid var(--line); margin-bottom: space(3) + 2; overflow: hidden; scroll-margin-top: space(2) + 2;
    &.on { border-color: var(--accent); box-shadow: 0 0 0 4px var(--accent-soft); } }
  .change-head { display: flex; gap: space(2) + 2; align-items: center; padding: space(2) + 2 space(3) + 2; background: var(--card2); font-size: 13.5px; .grow { flex: 1; } }
  .ic { width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; color: #fff; font-weight: $weight-heavy; flex: none;
    &.add { background: #19A974; } &.del { background: #E5484D; } &.edit { background: #E8A120; } }
  .lines { font-family: $font-mono; font-size: fs(sm); }
  .ln { display: grid; grid-template-columns: 54px 22px 1fr; align-items: start;
    .no { color: var(--faint); text-align: right; padding: 3px space(2) 3px 0; user-select: none; }
    .op { text-align: center; padding: 3px 0; user-select: none; font-weight: $weight-bold; }
    .tx { padding: 3px space(3) 3px space(1); white-space: pre-wrap; overflow-wrap: anywhere; }
    &.ctx { color: var(--muted); }
    &.add { background: var(--ins); .op, .tx { color: var(--ins-text); } }
    &.del { background: var(--del); .op, .tx { color: var(--del-text); } .tx { text-decoration: line-through; text-decoration-thickness: 1px; } } }
  .edit-pair { padding: space(2) space(3) space(2) + 2;
    .lab { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); margin: space(1) + 2 0 2px; font-family: $font-sans; }
    .txt { white-space: pre-wrap; overflow-wrap: anywhere; padding: space(1) + 2 space(2) + 2; border-radius: $radius-md - 2; background: var(--card2); } }
  .classic { border-radius: $radius-lg - 2; background: var(--card2); padding: space(2) 0; .hdr { color: var(--accent); padding: space(1) space(3) + 2; } }
</style>
