<script lang="ts">
  import { untrack } from "svelte";
  import { face } from "../lib/api.ts";
  import { app } from "../lib/app.svelte.ts";
  import { look } from "../lib/look.svelte.ts";
  import { git, repoMood } from "../lib/git.svelte.ts";
  import { notes } from "../lib/notes.svelte.ts";
  import { relay } from "../lib/relay.svelte.ts";
  import { releases } from "../lib/releases.svelte.ts";
  import { sync } from "../lib/sync.svelte.ts";
  import type { Mode } from "../lib/types.ts";
  import Icon from "./Icon.svelte";

  const SIZES = [["thin", "Thin"], ["", "Regular"], ["wide", "Wide"]] as const;
  const WIDTHS: Record<string, number> = { thin: 64, "": 92, wide: 210 };
  const snap = (w: number) => (w < 78 ? "thin" : w < 150 ? "" : "wide");

  const items: { mode: Mode; label: string; icon: string }[] = [
    { mode: "sync", label: "Folder pairs", icon: "home" },
    { mode: "git", label: "Git", icon: "branch" },
  ];

  let rail: HTMLElement;
  // Relay on the rail shows how the folder pair you're looking at is doing
  const railFace = $derived.by(() => {
    if (!app.online) return "sad";
    if (app.mode === "git") return git.state ? repoMood(git.state).face : "happy";
    const p = app.mode === "sync" ? sync.current : null;
    if (!p) return "happy";
    const m = sync.moodOf(p);
    return m.anim ? "focused" : m.face;
  });
  const size = $derived(look.get("rail"));
  const sizeIndex = $derived(Math.max(0, SIZES.findIndex(([k]) => k === size)));

  // Relay reacting for a moment (hover, click, live events): a quick face, a jump, a ring
  let home: HTMLButtonElement;
  const shownFace = $derived(relay.mood || railFace);
  const timers: Record<string, ReturnType<typeof setTimeout>> = {};
  /** Plays a one-shot class again from the start, even mid-animation. */
  function replay(cls: string, ms: number) {
    if (!home) return;
    clearTimeout(timers[cls]);
    home.classList.remove(cls);
    void home.offsetWidth;
    home.classList.add(cls);
    timers[cls] = setTimeout(() => home?.classList.remove(cls), ms);
  }
  $effect(() => { if (relay.jump) untrack(() => replay("jump", 700)); });
  $effect(() => { if (relay.burst) untrack(() => replay("burst", 700)); });
  function homeEnter() { if (!home.classList.contains("jump")) relay.react("excited", 1400); }
  function homeClick() {
    relay.react("party", 1100, { jump: true, burst: true });
    app.go("sync");
  }

  /** The branch icon draws itself on hover: one normalised length lets a single dash cover each line. */
  function drawable(node: HTMLElement, icon: string) {
    if (icon === "branch") node.querySelectorAll("svg path, svg circle").forEach((p) => p.setAttribute("pathLength", "1"));
  }

  function key(e: KeyboardEvent) {
    const i = sizeIndex;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") { e.preventDefault(); glideTo(SIZES[Math.min(2, i + 1)]![0]); }
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") { e.preventDefault(); glideTo(SIZES[Math.max(0, i - 1)]![0]); }
  }

  /**
   * Resizing without re-laying out the page per frame: only the rail's own width changes
   * (its blur is off meanwhile), the page beside it slides on its own GPU layer, and the
   * real size (the grid column) is set once at the end. The rail already shows the size
   * it will land on (labels and all) while you drag.
   */
  let peek = $state<string | null>(null);
  const shownSize = $derived(peek ?? size);
  type Glide = { start: number; paint: (w: number) => void; settle: (want: string) => void; finish: () => void };
  let active: Glide | null = null;
  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.motion === "reduce";

  function begin(): Glide {
    active?.finish();
    const root = document.documentElement;
    const zoom = parseFloat(getComputedStyle(document.body).zoom) || 1;
    const start = rail.getBoundingClientRect().width / zoom;
    const beside = [...document.querySelectorAll<HTMLElement>(".app > .content")];
    root.classList.add("rail-dragging");
    for (const el of beside) el.style.willChange = "transform";
    let want = size, done = false, timer: ReturnType<typeof setTimeout> | undefined;
    const paint = (w: number) => {
      rail.style.width = w + "px";
      const dx = w - start;
      for (const el of beside) el.style.transform = dx ? `translate3d(${dx}px, 0, 0)` : "";
    };
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      for (const el of [rail, ...beside]) { el.style.transition = ""; el.style.transform = ""; el.style.willChange = ""; }
      rail.style.width = "";
      look.set("rail", want);
      peek = null;
      void document.body.offsetWidth; // apply the new layout before transitions come back
      root.classList.remove("rail-dragging");
      if (active === g) active = null;
    };
    const settle = (w: string) => {
      want = w;
      peek = w;
      const target = WIDTHS[w]!;
      if (reduced() || Math.abs(rail.getBoundingClientRect().width / zoom - target) < 1) return finish();
      const ease = "220ms cubic-bezier(.3,1,.4,1)";
      rail.style.transition = `width ${ease}`;
      for (const el of beside) el.style.transition = `transform ${ease}`;
      requestAnimationFrame(() => { if (!done) paint(target); });
      timer = setTimeout(finish, 240);
    };
    const g: Glide = { start, paint, settle, finish };
    active = g;
    return g;
  }

  /** Keyboard and double-click: glide to a size. */
  function glideTo(want: string) {
    if (want === size && !active) return;
    if (look.get("railpos") === "top" || !rail.offsetParent) { look.set("rail", want); return; }
    begin().settle(want);
  }

  // Drag the edge: the rail follows the pointer, then glides to the nearest size.
  function down(e: PointerEvent) {
    if (e.button !== 0 || look.get("railpos") === "top") return;
    e.preventDefault();
    const grip = e.currentTarget as HTMLElement;
    try { grip.setPointerCapture(e.pointerId); } catch {}
    const g = begin();
    const zoom = parseFloat(getComputedStyle(document.body).zoom) || 1;
    const left = rail.getBoundingClientRect().left;
    let w = g.start, frame = 0;
    const paint = () => {
      frame = 0;
      g.paint(w);
      const s = snap(w);
      if (s !== peek) peek = s;
    };
    const move = (ev: PointerEvent) => {
      w = Math.max(56, Math.min(232, (ev.clientX - left) / zoom));
      if (!frame) frame = requestAnimationFrame(paint);
    };
    const up = () => {
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", up);
      grip.removeEventListener("pointercancel", up);
      if (frame) { cancelAnimationFrame(frame); paint(); }
      g.settle(snap(w));
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up);
    grip.addEventListener("pointercancel", up);
  }
</script>

<nav class="rail" bind:this={rail} data-size={shownSize} aria-label="Ferry">
  <button class="home" bind:this={home} onclick={homeClick} onmouseenter={homeEnter} title="Relay: back to the home page" aria-label="Home">
    <span class="face"><img src={face(shownFace)} alt="" /></span>
    <span class="dot" class:off={!app.online} title={app.online ? "Ferry is running" : "Ferry isn't answering"}></span>
    <span class="label brand">Ferry<small>with Relay</small></span>
  </button>
  {#each items as it (it.mode)}
    <button class="btn-rail" data-icon={it.icon} use:drawable={it.icon} class:on={app.mode === it.mode} onclick={() => app.go(it.mode)} title={it.label} aria-label={it.label} aria-current={app.mode === it.mode ? "page" : undefined}>
      <Icon name={it.icon} size={22} /><span class="label">{it.label}</span>
    </button>
  {/each}
  <div class="grow"></div>
  <button class="btn-rail" data-icon="sparkle" class:on={!!releases.whatsNew} onclick={() => releases.openWhatsNew()} title="What's new" aria-label={releases.unseen ? "What's new: a new version" : "What's new"} disabled={!releases.info?.releases.length}>
    <Icon name="sparkle" size={22} /><span class="label">What's new</span>{#if releases.unseen}<span class="new-dot" aria-hidden="true"></span>{/if}
  </button>
  <button class="btn-rail" data-icon="bell" class:on={notes.open} onclick={() => notes.toggle()} title={notes.unread ? `Notifications: ${notes.unread} new` : "Notifications"}
    aria-label={notes.unread ? `Notifications: ${notes.unread} new` : "Notifications"} aria-expanded={notes.open}>
    <Icon name="bell" size={22} /><span class="label">Notifications</span>{#if notes.unread}<span class="badge" aria-hidden="true">{notes.unread > 99 ? "99+" : notes.unread}</span>{/if}
  </button>
  <button class="btn-rail" data-icon="gear" class:on={app.mode === "settings"} onclick={() => app.go("settings")} title="Settings" aria-label="Settings" aria-current={app.mode === "settings" ? "page" : undefined}>
    <Icon name="gear" size={22} /><span class="label">Settings</span>
  </button>
  <div class="grip" role="slider" tabindex="0" aria-label="Sidebar width: drag, or use the arrow keys" aria-valuemin={0} aria-valuemax={2}
    aria-valuenow={sizeIndex} aria-valuetext={SIZES[sizeIndex]![1]} title="Drag to make the sidebar thinner or wider · double-click to switch"
    onpointerdown={down} onkeydown={key} ondblclick={() => glideTo(SIZES[(sizeIndex + 1) % 3]![0])}></div>
</nav>

<style lang="scss">
  @use "tokens" as *;
  @use "mixins" as *;

  .rail {
    position: sticky; top: space(4) + 2; z-index: z(rail);
    height: calc(100vh / var(--zoom) - #{space(9)});
    display: flex; flex-direction: column; align-items: center; gap: space(3) + 2; padding: space(4) 0;
    background: var(--rail); backdrop-filter: blur(16px); border-radius: $radius-xl + 6; box-shadow: var(--shadow);
    overflow-y: auto; @include hide-scrollbar;
    > * { flex: none; }
  }
  .grow { flex: 1; }
  .label { display: none; }

  .home {
    position: relative; width: 62px; height: 62px; border-radius: 50%; border: 0; cursor: pointer;
    background: var(--card-solid); display: grid; place-items: center; box-shadow: 0 4px 14px rgba(9, 35, 72, .12);
    @include motion { transition: box-shadow $duration-base; }
    &:hover { box-shadow: 0 0 0 3px var(--accent-soft), 0 6px 18px rgba(9, 35, 72, .16); }
    .face { position: relative; display: grid; place-items: center; flex: none; }
    .face img { width: 50px; height: 38px; display: block; transform-origin: 50% 85%; }
    // Relay idles, perks up on hover, and jumps when something happens (or you click)
    @include motion {
      .face img { animation: relay-idle 5.5s ease-in-out infinite; }
      &:hover .face img { animation: relay-wiggle .55s ease-in-out infinite alternate; }
      &:global(.jump) .face img { animation: relay-jump .6s cubic-bezier(.3, 1.4, .5, 1); }
      // clicked: a ring bursts out behind
      &:global(.burst) .face::after {
        content: ""; position: absolute; inset: -6px; border-radius: 50%; border: 3px solid var(--accent); pointer-events: none;
        animation: burst .6s ease-out forwards;
      }
    }
  }
  @keyframes burst { from { transform: scale(.6); opacity: .8; } to { transform: scale(1.5); opacity: 0; } }
  .dot {
    position: absolute; top: 6px; right: 6px; width: 11px; height: 11px; border-radius: 50%;
    background: #22C55E; border: 2px solid var(--card-solid);
    &.off { background: var(--red); }
  }
  .btn-rail {
    width: 54px; height: 54px; border-radius: 50%; border: 0; cursor: pointer; position: relative;
    display: grid; place-items: center; background: var(--pill); color: var(--text);
    box-shadow: 0 2px 8px rgba(9, 35, 72, .06);
    @include motion { transition: transform $duration-fast; }
    &:hover { transform: translateY(-2px); }
    &.on { @include brand-gradient; color: #fff; }
    &:disabled { opacity: .5; cursor: default; transform: none; }
  }
  // unread notifications, and a new version not looked at yet
  .badge { position: absolute; top: 2px; right: 0; min-width: 20px; height: 20px; padding: 0 5px; border-radius: $radius-pill; background: #E5484D; color: #fff;
    font-size: 11.5px; font-weight: $weight-heavy; display: grid; place-items: center; border: 2px solid var(--rail); }
  .new-dot { position: absolute; top: 7px; right: 7px; width: 10px; height: 10px; border-radius: 50%; @include brand-gradient; box-shadow: 0 0 0 2px var(--pill);
    @include motion { animation: breathe 2.4s ease-in-out infinite; } }
  @keyframes breathe { 0%, 100% { box-shadow: 0 0 0 2px var(--pill), 0 0 0 0 color-mix(in srgb, var(--accent) 45%, transparent); } 50% { box-shadow: 0 0 0 2px var(--pill), 0 0 0 6px transparent; } }

  // ---------- the icons: each moves like what it is ----------
  .btn-rail :global(svg) { transform-origin: center; @include motion { transition: transform .45s cubic-bezier(.3, 1.5, .5, 1); } }
  @include motion {
    .btn-rail:active:not(:disabled) { transform: scale(.92); transition-duration: .08s; }
    // picking a page: its icon pops once
    .btn-rail.on :global(svg) { animation: ico-pop .45s cubic-bezier(.3, 1.7, .5, 1); }
    // home: a squash and a hop
    [data-icon="home"]:hover :global(svg) { animation: ico-hop .6s cubic-bezier(.3, 1.4, .5, 1); transform-origin: 50% 90%; }
    // git: the branch draws itself, lines then dots
    [data-icon="branch"]:hover :global(svg path) { stroke-dasharray: 1; animation: ico-draw .55s ease-out backwards; }
    [data-icon="branch"]:hover :global(svg circle) { transform-box: fill-box; transform-origin: center; animation: ico-dot .4s cubic-bezier(.3, 1.8, .5, 1) .05s backwards; }
    [data-icon="branch"]:hover :global(svg circle:nth-of-type(2)) { animation-delay: .3s; }
    [data-icon="branch"]:hover :global(svg circle:nth-of-type(3)) { animation-delay: .4s; }
    // what's new: a twinkle
    [data-icon="sparkle"]:hover:not(:disabled) :global(svg) { animation: ico-twinkle .7s ease-in-out; }
    // notifications: the bell swings on hover, and rings now and then while something is unread
    [data-icon="bell"] :global(svg) { transform-origin: 50% 12%; }
    [data-icon="bell"]:hover :global(svg) { animation: ico-ring .9s ease-in-out; }
    [data-icon="bell"]:has(.badge):not(:hover) :global(svg) { animation: ico-ring-idle 5s ease-in-out infinite; }
    // settings: the gear turns a quarter on hover, and keeps turning slowly while Settings is open
    [data-icon="gear"]:hover :global(svg) { transform: rotate(90deg); }
    [data-icon="gear"].on :global(svg) { animation: ico-pop .45s cubic-bezier(.3, 1.7, .5, 1), ico-turn 14s linear .45s infinite; }
    [data-icon="gear"].on:hover :global(svg) { animation: ico-turn 3s linear infinite; }
  }
  @keyframes ico-pop { 0% { transform: scale(.6); } 100% { transform: scale(1); } }
  @keyframes ico-hop { 0% { transform: none; } 25% { transform: scale(1.12, .86); } 55% { transform: translateY(-4px) scale(.94, 1.08); } 80% { transform: translateY(0) scale(1.04, .96); } 100% { transform: none; } }
  @keyframes ico-draw { from { stroke-dashoffset: 1; } }
  @keyframes ico-dot { from { transform: scale(0); } }
  @keyframes ico-twinkle { 0% { transform: none; } 30% { transform: rotate(-12deg) scale(1.15); } 60% { transform: rotate(10deg) scale(.95); } 100% { transform: none; } }
  @keyframes ico-ring { 0%, 100% { transform: rotate(0); } 15% { transform: rotate(16deg); } 30% { transform: rotate(-14deg); } 45% { transform: rotate(10deg); } 60% { transform: rotate(-7deg); } 75% { transform: rotate(3deg); } }
  @keyframes ico-ring-idle { 0%, 20%, 100% { transform: rotate(0); } 3% { transform: rotate(14deg); } 6% { transform: rotate(-12deg); } 9% { transform: rotate(8deg); } 12% { transform: rotate(-5deg); } 15% { transform: rotate(2deg); } }
  @keyframes ico-turn { to { transform: rotate(360deg); } }

  .grip {
    position: absolute; top: 50%; right: 0; width: 14px; height: 64px; margin-top: -32px; z-index: 6;
    cursor: ew-resize; touch-action: none; outline: none; border-radius: $radius-pill;
    &::before {
      content: ""; position: absolute; left: 5px; top: 10px; bottom: 10px; width: 4px; border-radius: $radius-pill;
      background: var(--faint); opacity: 0; transition: opacity $duration-fast, top $duration-base, bottom $duration-base;
    }
    &:hover::before, &:focus-visible::before { opacity: 1; background: var(--accent); top: 0; bottom: 0; }
  }
  .rail:hover .grip::before { opacity: .45; }
  :global(.rail-dragging), :global(.rail-dragging *) { cursor: ew-resize !important; user-select: none; }
  // while resizing: no blur to recompute each frame (only the fixed background is behind it, so it looks the same)
  :global(.rail-dragging) .rail { backdrop-filter: none; }

  // the sizes are on the rail itself (data-size), so it can show where it'll land while you drag
  // thin: small icons
  .rail[data-size="thin"] {
    padding: space(3) 0; gap: space(2) + 2; border-radius: $radius-xl;
    .btn-rail { width: 42px; height: 42px; }
    .home { width: 48px; height: 48px; .face img { width: 38px; height: 29px; } }
  }
  // wide: icons and names
  .rail[data-size="wide"] {
    align-items: stretch; padding: space(4) space(3); gap: space(2);
    .label { display: block; font-weight: $weight-semibold; font-size: 14px; @include ellipsis; }
    .btn-rail {
      width: auto; height: 46px; border-radius: $radius-lg - 2; display: flex; align-items: center; gap: space(3); padding: 0 space(4);
      justify-content: flex-start; box-shadow: none; background: transparent;
      &:hover { transform: none; background: var(--pill); }
      &.on { @include brand-gradient; box-shadow: 0 6px 16px color-mix(in srgb, var(--accent) 30%, transparent); }
    }
    .home { width: auto; height: 64px; border-radius: $radius-lg + 2; display: flex; align-items: center; gap: space(2) + 2; padding: 0 space(3) 0 space(2); margin-bottom: space(1) + 2; }
    .dot { left: 48px; right: auto; top: 8px; }
    .badge, .new-dot { position: static; margin-left: auto; }
    .brand { font-size: fs(lg); font-weight: $weight-heavy; text-align: left; small { display: block; font-size: fs(xs); color: var(--muted); font-weight: $weight-semibold; } }
  }
  // across the top
  :global([data-railpos="top"]) {
    .rail { flex-direction: row; height: auto; top: space(2) + 2; padding: space(2) space(3); border-radius: $radius-xl - 2; overflow: visible; }
    .grip { display: none; }
  }
  @include below(phone) {
    .rail { flex-direction: row; justify-content: space-around; height: auto; top: space(2) + 2; padding: space(2) space(2) + 2; border-radius: $radius-xl - 2; overflow: visible; }
    .grow, .grip { display: none; }
    .btn-rail { width: 46px; height: 46px; }
    .home { width: 46px; height: 46px; .face img { width: 38px; height: 29px; } }
  }
</style>
