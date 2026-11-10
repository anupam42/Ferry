<script lang="ts" module>
  export interface DockItem { id: string; name: string; icon: string; count?: number; alert?: boolean }
  /** A button in the dock's second group (Fetch, Pull, Push): it acts rather than switches the view. */
  export interface DockAction {
    id: string; name: string; icon: string; tip?: string; count?: number;
    /** draws the eye: something to pull or push */
    hot?: boolean;
    /** "incoming" (amber, to pull), "outgoing" (blue, to push) */
    tone?: "" | "incoming" | "outgoing";
    state?: "" | "working" | "done";
    disabled?: boolean;
    onclick: () => void;
  }
  // expanded or collapsed is one setting for every dock, remembered (shared with the current page)
  const dockState = $state({ wide: localStorage.getItem("ferry-dock") === "wide" });
  function setWide(on: boolean) {
    dockState.wide = on;
    localStorage.setItem("ferry-dock", on ? "wide" : "narrow");
  }
</script>

<script lang="ts">
  import Icon from "./Icon.svelte";

  /**
   * The views of a folder pair or repository: a rail beside the content
   * (or a bar across the top, Settings → Appearance → Toolbar). The highlight
   * slides to the current view; "[" expands or collapses it.
   */
  let { label, items, current, onpick, actions = [], actionsLabel = "Remote" }: {
    label: string; items: DockItem[]; current: string; onpick: (id: string) => void; actions?: DockAction[]; actionsLabel?: string;
  } = $props();

  let group: HTMLElement;
  let glow = $state({ y: 0, x: 0, w: 0, h: 0, on: false });
  $effect(() => {
    void current; void items.length; void dockState.wide;
    const move = () => {
      const sel = group?.querySelector<HTMLElement>(".btn-dock.on");
      glow = sel ? { y: sel.offsetTop, x: sel.offsetLeft, w: sel.offsetWidth, h: sel.offsetHeight, on: true } : { ...glow, on: false };
    };
    move();
    const t = setTimeout(move, 320); // after the buttons settle when expanding
    return () => clearTimeout(t);
  });

  function key(e: KeyboardEvent) {
    if (e.key !== "[" || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (document.querySelector('[aria-modal="true"]')) return;
    e.preventDefault();
    setWide(!dockState.wide);
  }
</script>

<svelte:window onkeydown={key} />

<nav class="dock" class:wide={dockState.wide} aria-label={label}>
  <button type="button" class="toggle" aria-expanded={dockState.wide} aria-label={dockState.wide ? "Collapse the toolbar" : "Expand the toolbar"}
    title="{dockState.wide ? 'Collapse' : 'Expand'} ( [ )" onclick={() => setWide(!dockState.wide)}>
    <Icon name="caret" size={18} /><span class="label">Collapse</span>
  </button>
  <span class="head" aria-hidden="true">Views</span>
  <div class="group" role="group" aria-label="Views" bind:this={group}>
    <span class="glow" aria-hidden="true" style:transform="translate({glow.x}px, {glow.y}px)" style:width="{glow.w}px" style:height="{glow.h}px" style:opacity={glow.on ? 1 : 0}></span>
    {#each items as it (it.id)}
      <button type="button" class="btn-dock" class:on={current === it.id} class:alert={it.alert && !!it.count}
        aria-label={it.name + (it.count ? ` (${it.count})` : "")} aria-pressed={current === it.id} onclick={() => onpick(it.id)}>
        <Icon name={it.icon} size={20} /><span class="label" aria-hidden="true">{it.name}</span>
        {#if it.count}<span class="n" aria-hidden="true">{it.count > 99 ? "99+" : it.count}</span>{/if}
        <span class="tip" aria-hidden="true">{it.name}</span>
      </button>
    {/each}
  </div>
  {#if actions.length}
    <span class="sep" aria-hidden="true"></span>
    <span class="head" aria-hidden="true">{actionsLabel}</span>
    <div class="group" role="group" aria-label={actionsLabel}>
      {#each actions as a (a.id)}
        <button type="button" class="btn-dock act {a.tone ?? ''} {a.state ?? ''}" class:hot={a.hot} disabled={a.disabled}
          aria-label={a.name + (a.count ? ` (${a.count})` : "")} aria-busy={a.state === "working"} onclick={a.onclick}>
          <Icon name={a.state === "done" ? "check" : a.icon} size={20} /><span class="label" aria-hidden="true">{a.name}</span>
          {#if a.count}<span class="n" aria-hidden="true">{a.count > 99 ? "99+" : a.count}</span>{/if}
          <span class="tip" aria-hidden="true">{a.tip || a.name}</span>
        </button>
      {/each}
    </div>
  {/if}
</nav>

<style lang="scss">
  @use "tokens" as *;
  @use "mixins" as *;

  .dock {
    position: sticky; top: space(4) + 2; z-index: 5; display: flex; flex-direction: column; align-items: center; gap: space(1) + 2; padding: 9px;
    background: var(--rail); backdrop-filter: blur(16px); border-radius: $radius-xl - 2; box-shadow: var(--shadow);
    &.wide { align-items: stretch; }
  }
  .group { position: relative; display: flex; flex-direction: column; gap: space(1); }
  .glow {
    position: absolute; left: 0; top: 0; border-radius: 15px; @include brand-gradient; pointer-events: none;
    box-shadow: 0 6px 16px color-mix(in srgb, var(--accent) 30%, transparent);
    @include motion { transition: transform .32s cubic-bezier(.3, 1.35, .5, 1), width .28s $ease-out, opacity .2s; }
  }
  .btn-dock {
    position: relative; z-index: 1; width: 44px; height: 44px; border: 0; border-radius: 15px; background: transparent; color: var(--muted);
    display: flex; align-items: center; gap: space(3); padding: 0 space(3); cursor: pointer;
    &:hover { background: var(--accent-soft); color: var(--text); }
    &:focus-visible { outline: none; box-shadow: 0 0 0 2.5px var(--accent); }
    &.on, &.on:hover { background: transparent; color: #fff; }
    :global(svg) { flex: none; }
    &:hover .tip, &:focus-visible .tip { opacity: 1; transform: translate(0, -50%); }
  }
  .sep { width: 22px; height: 1px; background: var(--line); margin: space(1) 0; flex: none; }
  .act {
    &.hot { color: var(--accent); }
    &.incoming { color: var(--amber); .n { background: var(--amber); } }
    &.outgoing { color: var(--accent); }
    &.working { color: var(--accent); background: var(--accent-soft); cursor: progress; opacity: 1;
      :global(svg) { @include motion { animation: breathe 1s ease-in-out infinite; } } }
    &.done { color: var(--green); background: var(--green-soft); }
    &:disabled:not(.working) { opacity: .45; cursor: progress; }
  }
  @keyframes breathe { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
  .label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 13.5px; font-weight: $weight-semibold; opacity: 0; max-width: 0; min-width: 0; }
  .n {
    position: absolute; top: 3px; right: 2px; min-width: 17px; height: 17px; padding: 0 4px; border-radius: $radius-pill;
    background: var(--accent); color: #fff; font-size: 10px; font-weight: $weight-heavy; line-height: 17px; text-align: center; box-shadow: 0 0 0 2px var(--card-solid);
  }
  .on .n { background: var(--card-solid); color: var(--accent); }
  .alert .n { background: var(--red); } .alert.on .n { background: var(--card-solid); color: var(--red); }
  .tip {
    position: absolute; right: calc(100% + 12px); top: 50%; transform: translate(6px, -50%); padding: space(1) + 2 space(3) - 1; border-radius: $radius-md - 2;
    background: var(--text); color: var(--card-solid); font-size: fs(sm); font-weight: $weight-semibold; white-space: nowrap; pointer-events: none; opacity: 0;
    @include motion { transition: opacity .12s, transform .12s; }
  }
  .head { display: block; align-self: stretch; height: 0; opacity: 0; overflow: hidden; padding: 0 space(3); font-size: 10.5px; font-weight: $weight-bold; letter-spacing: .08em; text-transform: uppercase; color: var(--faint); }
  .toggle {
    width: 44px; height: 30px; border: 0; border-radius: $radius-md; background: transparent; color: var(--faint);
    display: flex; align-items: center; gap: space(2) + 2; padding: 0 space(3); cursor: pointer; overflow: hidden; flex: none;
    &:hover { background: var(--accent-soft); color: var(--text); }
    :global(svg) { flex: none; transform: rotate(90deg); @include motion { transition: transform .28s; } }
    .label { font-size: fs(sm); }
  }
  .wide {
    .btn-dock, .toggle { width: 184px; }
    .label { opacity: 1; max-width: 140px; }
    .n { position: static; margin-left: auto; box-shadow: none; flex: none; }
    .on .n { background: rgba(255, 255, 255, .25); color: #fff; }
    .tip { display: none; }
    .head { height: 22px; opacity: 1; padding-top: space(1) + 2; }
    .sep { width: auto; align-self: stretch; margin: space(1) + 2 space(2) 2px; }
    .toggle :global(svg) { transform: rotate(-90deg); }
  }
  // Settings → Appearance → Toolbar: horizontal, a bar across the top
  :global([data-dock="horizontal"]) {
    .dock { flex-direction: row; flex-wrap: wrap; align-items: center; width: 100%; padding: space(1) + 2 space(2); border-radius: $radius-xl - 2; }
    .group { flex-direction: row; }
    .head, .toggle { display: none; }
    .sep { width: 1px; height: 24px; margin: 0 space(1) + 2 0 auto; align-self: center; }
    .wide .btn-dock { width: auto; padding: 0 space(3) + 2 0 space(3); }
    .tip { right: auto; left: 50%; top: calc(100% + 10px); transform: translate(-50%, -4px); }
    .btn-dock:hover .tip { transform: translate(-50%, 0); }
  }
  @include below(laptop) { .toggle { display: none; } }
  @include below(phone) {
    .dock { position: fixed; top: auto; bottom: space(2) + 2; left: space(2) + 2; right: space(2) + 2; flex-direction: row; overflow-x: auto; @include hide-scrollbar; }
    .group { flex-direction: row; }
    .glow, .tip, .head { display: none; }
    .sep { width: 1px; height: 22px; margin: 0 space(1); align-self: center; }
    .btn-dock.on { @include brand-gradient; }
  }
</style>
