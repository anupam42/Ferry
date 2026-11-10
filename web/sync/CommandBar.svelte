<script lang="ts">
  import Icon from "../components/Icon.svelte";
  import { api } from "../lib/api.ts";
  import { act, app, toast } from "../lib/app.svelte.ts";
  import { ago } from "../lib/format.ts";
  import type { Mood } from "../lib/mood.ts";
  import { pairURL, short, stopPair, sync, syncNow } from "../lib/sync.svelte.ts";
  import type { PairStatus } from "../lib/types.ts";

  /** A status chip, then pause / sync now / stop as icon buttons, then a ⋯ menu. */
  let { p, m }: { p: PairStatus; m: Mood } = $props();
  const paused = $derived(!!p.user_paused);
  const busy = $derived(sync.busy === p.name);
  const done = $derived(!busy && sync.done?.name === p.name);
  const synced = $derived(p.last_sync && !p.last_sync.startsWith("0001") ? ago(p.last_sync) : "");
  const tone = $derived(busy ? "blue" : paused ? "amber" : m.tone);
  const label = $derived(busy ? "Syncing…" : paused ? "Paused" : m.label.charAt(0).toUpperCase() + m.label.slice(1));
  const canStop = $derived(!!app.info?.can_add);

  async function pause() {
    await act(paused ? "Back to work!" : "Paused", () => api("POST", pairURL(p.name, paused ? "resume" : "pause")), paused ? "happy" : "sleepy");
    sync.soon();
  }
  async function approve() {
    await act("approved", () => api("POST", pairURL(p.name, "approve")), "happy");
    sync.soon();
  }

  // ⋯ menu
  let open = $state(false);
  let menu: HTMLElement = $state()!;
  let more: HTMLButtonElement;
  function toggle() {
    open = !open;
    if (open) queueMicrotask(() => menu?.querySelector<HTMLElement>("[role=menuitem]")?.focus());
  }
  function close(back = false) { open = false; if (back) more.focus(); }
  function menuKey(e: KeyboardEvent) {
    const items = [...menu.querySelectorAll<HTMLElement>("[role=menuitem]")];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(true); }
    else if (e.key === "ArrowDown") { e.preventDefault(); items[(i + 1) % items.length]!.focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); items[(i - 1 + items.length) % items.length]!.focus(); }
    else if (e.key === "Tab") close();
  }
  function outside(e: PointerEvent) {
    if (open && !menu.contains(e.target as Node) && !more.contains(e.target as Node)) close();
  }
  const copy = (text: string, what: string) => navigator.clipboard.writeText(text).then(() => toast(`Copied the ${what} path`), () => toast("Couldn't copy to the clipboard", { error: true }));
</script>

<svelte:document onpointerdowncapture={outside} />

<div class="bar" role="toolbar" aria-label="Pair controls">
  <div class="chip t-{tone}" class:live={busy} role="status" title={synced ? "Last sync " + synced : ""}>
    <span class="dot" aria-hidden="true"></span><b>{label}</b>{#if synced && !busy}<small>{synced}</small>{/if}
  </div>
  {#if p.pending_batch > 0}
    <span class="sep" aria-hidden="true"></span>
    <button type="button" class="approve" onclick={approve}><Icon name="check" size={16} />Approve {p.pending_batch} changes</button>
  {/if}
  <span class="sep" aria-hidden="true"></span>
  <button type="button" class="ib" class:accent={paused} aria-label={paused ? "Resume syncing" : "Pause syncing"} onclick={pause}>
    <Icon name={paused ? "play" : "pause"} size={18} /><span class="tip" aria-hidden="true">{paused ? "Resume syncing" : "Pause syncing"}</span>
  </button>
  <button type="button" class="ib" class:working={busy} class:done aria-label={busy ? "Syncing everything…" : "Sync everything now"} aria-busy={busy} disabled={busy} onclick={() => syncNow(p)}>
    <Icon name={done ? "check" : "sync"} size={18} /><span class="tip" aria-hidden="true">{busy ? "Syncing everything…" : "Sync everything now"}</span>
  </button>
  {#if canStop}
    <button type="button" class="ib danger" aria-label="Stop syncing" onclick={() => stopPair(p)}>
      <Icon name="stop" size={16} /><span class="tip" aria-hidden="true">Stop syncing</span>
    </button>
  {/if}
  <span class="sep" aria-hidden="true"></span>
  <div class="more-wrap">
    <button type="button" class="ib" bind:this={more} aria-label="More" aria-haspopup="menu" aria-expanded={open} onclick={toggle}>
      <Icon name="more" size={18} /><span class="tip" aria-hidden="true">More</span>
    </button>
    {#if open}
      <div class="menu" role="menu" tabindex="-1" bind:this={menu} onkeydown={menuKey}>
        <button type="button" role="menuitem" class="item" onclick={() => { close(); void copy(p.source, "working folder"); }}>
          <Icon name="folder" size={17} /><span class="text">Copy working folder path<small>{short(p.source)}</small></span>
        </button>
        <button type="button" role="menuitem" class="item" onclick={() => { close(); void copy(p.remote || p.target, "target"); }}>
          <Icon name="folder" size={17} /><span class="text">Copy target path<small>{p.remote || short(p.target)}</small></span>
        </button>
      </div>
    {/if}
  </div>
</div>

<style lang="scss">
  @use "tokens" as *;
  @use "mixins" as *;

  .bar {
    display: inline-flex; align-items: center; gap: space(1); padding: 5px; border-radius: $radius-pill; background: var(--card-solid);
    box-shadow: 0 8px 24px rgba(9, 35, 72, .09), 0 1px 3px rgba(9, 35, 72, .06); border: 1px solid var(--line);
  }
  .chip {
    --c: var(--green); display: inline-flex; align-items: center; gap: space(2); height: 36px; padding: 0 space(3) + 2 0 space(3);
    border-radius: $radius-pill; white-space: nowrap; font-size: 13.5px; background: color-mix(in srgb, var(--c) 12%, transparent);
    &.t-blue { --c: var(--accent); } &.t-amber { --c: var(--amber); } &.t-red { --c: var(--red); }
    b { font-weight: $weight-bold; } small { color: var(--faint); font-size: 12px; }
  }
  .dot {
    position: relative; width: 8px; height: 8px; border-radius: 50%; background: var(--c); flex: none;
    &::after { content: ""; position: absolute; inset: -4px; border-radius: 50%; background: var(--c); opacity: .35; @include motion { animation: pulse 2s ease-out infinite; } }
  }
  .t-amber .dot::after, .t-red .dot::after { animation: none; opacity: 0; }
  .live .dot::after { animation-duration: 1s; }
  .sep { width: 1px; height: 20px; background: var(--line); margin: 0 space(1); flex: none; }
  .ib {
    position: relative; width: 36px; height: 36px; border: 0; border-radius: 50%; background: transparent; color: var(--muted);
    display: grid; place-items: center; cursor: pointer;
    @include motion { transition: background .15s, color .15s, transform .12s; }
    &:hover { background: var(--accent-soft); color: var(--text); }
    &:active { transform: scale(.92); }
    &:focus-visible { outline: none; box-shadow: 0 0 0 2.5px var(--accent); }
    &.accent { color: var(--accent); }
    &.danger:hover, &.danger:focus-visible { background: var(--red-soft); color: var(--red); }
    &[aria-expanded="true"] { background: var(--accent-soft); color: var(--text); .tip { opacity: 0; } }
    &.working { color: var(--accent); cursor: progress; :global(svg) { @include motion { animation: spin 1s linear infinite; } } }
    &.done { color: var(--green); background: var(--green-soft); }
    &:hover .tip, &:focus-visible .tip { opacity: 1; transform: translate(-50%, 0); }
  }
  .tip {
    position: absolute; top: calc(100% + 10px); left: 50%; transform: translate(-50%, -4px); padding: space(1) + 2 space(2) + 2; border-radius: 9px;
    background: var(--text); color: var(--card-solid); font-size: 12px; font-weight: $weight-semibold; white-space: nowrap; pointer-events: none; opacity: 0; z-index: 30;
    @include motion { transition: opacity .12s, transform .12s; }
  }
  .approve {
    display: inline-flex; align-items: center; gap: space(1) + 2; height: 36px; padding: 0 space(3) + 2; border: 0; border-radius: $radius-pill; cursor: pointer;
    font-weight: $weight-bold; font-size: 13px; color: #fff; @include brand-gradient;
  }
  .more-wrap { position: relative; }
  .menu {
    position: absolute; top: calc(100% + 10px); right: -5px; min-width: 250px; padding: space(1) + 2; border-radius: $radius-lg;
    background: var(--card-solid); border: 1px solid var(--line); box-shadow: 0 18px 44px rgba(9, 35, 72, .18); z-index: 40;
  }
  .item {
    display: flex; align-items: center; gap: 11px; width: 100%; border: 0; background: none; padding: 9px 11px; border-radius: $radius-md; cursor: pointer; text-align: left; color: var(--text);
    :global(svg) { color: var(--muted); flex: none; }
    &:hover, &:focus-visible { background: var(--accent-soft); outline: none; }
  }
  .text { display: flex; flex-direction: column; min-width: 0; font-size: 13.5px; font-weight: $weight-semibold;
    small { font-weight: 400; color: var(--faint); font-size: 12px; @include ellipsis; max-width: 260px; } }
  @keyframes pulse { 0% { transform: scale(.6); opacity: .5; } 100% { transform: scale(1.6); opacity: 0; } }
  @keyframes spin { to { transform: rotate(360deg); } }
  @include below(phone) { .bar { width: 100%; } .chip { flex: 1; min-width: 0; small { display: none; } } }
</style>
