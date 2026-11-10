<script lang="ts">
  import { mapLayout, type Parsed } from "../lib/diff.ts";

  /**
   * The change map: the whole file as a track, each change a numbered pin at
   * its place (and as wide as it is), coloured by what happened. Hovering or
   * focusing a pin says what it is; clicking jumps to it.
   */
  let { parsed, at, go }: { parsed: Parsed; at: number; go: (i: number) => void } = $props();
  const m = $derived(mapLayout(parsed));
  const pct = (line: number) => Math.max(0, Math.min(100, ((line - 1) / m.total) * 100));
  const kinds = $derived(new Set(m.marks.flatMap((x) => x.kinds)));
  const NAMES = { edit: ["edited", "var(--map-edit)"], add: ["new", "var(--map-add)"], del: ["removed", "var(--map-del)"] } as const;
</script>

<div class="map">
  <div class="head">
    <span>Where the changes are</span>
    <div class="legend">
      {#each ["edit", "add", "del"] as const as k (k)}
        {#if kinds.has(k)}<span><i style:background={NAMES[k][1]}></i>{NAMES[k][0]}</span>{/if}
      {/each}
    </div>
  </div>
  <div class="track" role="group" aria-label="{m.marks.length} changes across the file">
    {#each m.ticks as v (v)}<span class="grid" style:left="{pct(v + 1)}%"></span>{/each}
    {#each m.marks as mk, k (k)}
      <button class="mk" class:on={k === at} style:left="{mk.left}%" style:width="{mk.width}%" style:background={mk.background}
        aria-label="Change {k + 1} of {m.marks.length}: {mk.where.toLowerCase()}, {mk.what}" onclick={() => go(k)}>
        <span class="pin" style:left="{mk.pin}%">{k + 1}</span>
        <span class="tip {mk.side}" style:left="{mk.pin}%">
          <b>Change {k + 1} of {m.marks.length}</b><span>{mk.where} · {mk.what}</span>
          {#if mk.sample}<code>{mk.sample}</code>{/if}
        </span>
      </button>
    {/each}
  </div>
  <div class="ruler" aria-hidden="true">
    {#each m.ticks as v (v)}<span class="tick" style:left="{pct(v + 1)}%">{v}</span>{/each}
    <span class="tick start">line 1</span><span class="tick end">line {m.total}</span>
  </div>
</div>

<style lang="scss">
  @use "tokens" as *;
  @use "mixins" as *;

  .map { --map-add: #2BC48A; --map-del: #FF5C6C; --map-edit: #F5B33D; margin-bottom: space(4) + 2; }
  .head { display: flex; justify-content: space-between; align-items: center; gap: space(3); font-size: fs(sm); font-weight: $weight-semibold; color: var(--muted); margin-bottom: space(1); }
  .legend { display: flex; gap: space(3) + 2; font-weight: $weight-medium; span { display: inline-flex; align-items: center; gap: space(1) + 2; } i { width: 10px; height: 10px; border-radius: 3px; } }
  .track { position: relative; height: 30px; margin-top: 30px; border-radius: $radius-md - 2; background: var(--card2); }
  .grid { position: absolute; top: 0; bottom: 0; width: 1px; background: color-mix(in srgb, var(--muted) 18%, transparent); }
  .mk {
    position: absolute; top: 6px; bottom: 6px; min-width: 7px; border-radius: 5px; border: 0; padding: 0; cursor: pointer;
    box-shadow: 0 0 0 2px var(--card2);
    @include motion { transition: top .15s, bottom .15s, box-shadow .15s; }
    &:hover, &.on { top: 2px; bottom: 2px; }
    &.on { box-shadow: 0 0 0 2px var(--card2), 0 0 0 4px var(--text); }
    &:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--card2), 0 0 0 4px var(--accent); }
    &:hover .tip, &:focus-visible .tip { opacity: 1; visibility: visible; }
  }
  .pin {
    position: absolute; bottom: calc(100% + 8px); transform: translateX(-50%); min-width: 20px; height: 20px; padding: 0 5px;
    border-radius: 10px; display: grid; place-items: center; font-size: 11px; font-weight: $weight-bold; line-height: 1;
    color: var(--text); background: var(--card-solid); border: 1px solid color-mix(in srgb, var(--muted) 35%, transparent); box-shadow: 0 1px 4px rgba(9, 35, 72, .18);
    &::after { content: ""; position: absolute; top: 100%; left: 50%; width: 2px; height: 6px; margin-left: -1px; background: color-mix(in srgb, var(--muted) 45%, transparent); }
  }
  .mk.on .pin { background: var(--text); color: var(--card-solid); transform: translateX(-50%) scale(1.1); }
  .tip {
    position: absolute; top: calc(100% + 10px); transform: translateX(-50%); z-index: 5; width: max-content; max-width: 280px;
    padding: 9px 12px; border-radius: $radius-md; background: var(--text); color: var(--card-solid); font-size: 12px; line-height: 1.45; text-align: left;
    box-shadow: 0 8px 24px rgba(9, 35, 72, .28); pointer-events: none; opacity: 0; visibility: hidden;
    &.left { transform: translateX(-14px); } &.right { transform: translateX(calc(-100% + 14px)); }
    b, span, code { display: block; }
    code { margin-top: space(1); font: 11.5px $font-mono; opacity: .8; white-space: pre; overflow: hidden; text-overflow: ellipsis; }
  }
  .ruler {
    position: relative; height: 22px; margin-top: space(1); font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums;
    .tick { position: absolute; top: 0; transform: translateX(-50%); padding-top: 5px;
      &::before { content: ""; position: absolute; top: 0; left: 50%; width: 1px; height: 4px; background: currentColor; opacity: .5; } }
    .start { left: 0; transform: none; &::before { left: 0; } }
    .end { right: 0; left: auto; transform: none; &::before { left: auto; right: 0; } }
  }
</style>
