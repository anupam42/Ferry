<script lang="ts">
  import { face } from "../lib/api.ts";
  import { app } from "../lib/app.svelte.ts";
  import { git } from "../lib/git.svelte.ts";
  import { sync } from "../lib/sync.svelte.ts";

  /**
   * At the top of the page, pull down (touch), drag down on an empty part of
   * the page (mouse), or keep scrolling up (trackpad or wheel): Relay drops in
   * and follows the pull, a ring fills as it nears the point of no return, and
   * letting go refreshes what's on screen. Off while a drawer, dialog or the
   * big compare window is open, or while typing.
   */
  const TRIGGER = 86, MAX = 150;
  let pull = $state(0);
  let phase = $state<"" | "snap" | "busy" | "done" | "leaving">("");
  const k = $derived(Math.min(1, pull / TRIGGER));
  const ready = $derived(pull >= TRIGGER && !phase);
  const shown = $derived(pull > 2 || phase === "busy" || phase === "done");
  const mood = $derived(phase === "busy" ? "focused" : phase === "done" ? "party" : ready ? "excited" : "sleepy");
  const label = $derived(phase === "busy" ? "Refreshing…" : phase === "done" ? "Up to date" : ready ? "Let go to refresh" : "Pull to refresh");
  const busy = () => phase === "busy" || phase === "done" || phase === "leaving";

  const blocked = (t: EventTarget | null) => busy() || window.scrollY > 0 || !!document.querySelector('[aria-modal="true"]') ||
    !!(t as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable], [role=dialog], [role=alertdialog], [role=separator], [role=slider]");
  const show = (p: number) => { pull = Math.max(0, Math.min(MAX, p)); };
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  async function run() {
    phase = "busy";
    pull = TRIGGER;
    const started = Date.now();
    try {
      if (app.mode === "git") { await git.checkRemote(true, false); git.bump++; await git.refresh(); }
      else if (app.mode === "settings") { await Promise.all([app.loadSettings(), app.loadConnections()]); }
      else { sync.bump++; await sync.refresh(); }
    } catch {}
    // stay long enough to read, even when it's instant
    await wait(Math.max(0, 900 - (Date.now() - started)));
    phase = "done";
    await wait(750);
    phase = "leaving";
    await wait(260);
    pull = 0;
    phase = "";
  }
  function release() {
    if (busy()) return;
    if (pull >= TRIGGER) { void run(); return; }
    phase = "snap";
    pull = 0;
    setTimeout(() => { if (phase === "snap") phase = ""; }, 260);
  }

  $effect(() => {
    // touch: pull with a little resistance, so it feels like stretching
    let startY: number | null = null;
    const tStart = (e: TouchEvent) => { startY = e.touches.length === 1 && !blocked(e.target) ? e.touches[0]!.clientY : null; };
    const tMove = (e: TouchEvent) => {
      if (startY == null || busy()) return;
      const dy = e.touches[0]!.clientY - startY;
      if (dy <= 0 || window.scrollY > 0) { if (pull) show(0); return; }
      e.preventDefault(); // instead of the browser's own overscroll
      show(dy * 0.5);
    };
    const tEnd = () => { if (startY != null) release(); startY = null; };

    // mouse: press on an empty part of the page and drag down, like pulling it with your finger.
    // It only takes over for a mostly vertical drag (sideways drags stay text selection), and not on controls or rows.
    const NOT_HERE = "button, a, input, textarea, select, label, summary, nav, tr, li, pre, code, [role=slider], [role=separator], [role=row], [role=button], [draggable=true]";
    let drag: { x: number; y: number; active: boolean } | null = null;
    const root = document.documentElement;
    const pDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      drag = e.pointerType === "mouse" && e.button === 0 && !blocked(t) && !t.closest?.(NOT_HERE) ? { x: e.clientX, y: e.clientY, active: false } : null;
    };
    const pMove = (e: PointerEvent) => {
      if (!drag || busy()) return;
      const dy = e.clientY - drag.y, dx = Math.abs(e.clientX - drag.x);
      if (!drag.active) {
        if (dy > 10 && dx < dy * .6) { drag.active = true; root.classList.add("ptr-dragging"); }
        else if (dy < -6 || dx > 14) { drag = null; return; }
        else return;
      }
      getSelection()?.removeAllRanges();
      show((dy - 10) * 0.5);
    };
    const pEnd = () => { if (drag?.active) { root.classList.remove("ptr-dragging"); release(); } drag = null; };

    // trackpad / wheel: scrolling up while already at the top builds the pull; stopping lets go.
    // The momentum of scrolling up to the top doesn't count: the page has to have been still for a moment.
    let idle: ReturnType<typeof setTimeout> | undefined, lastScroll = 0;
    const onScroll = () => { lastScroll = Date.now(); };
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY >= 0 || e.ctrlKey) { if (pull && !busy()) { clearTimeout(idle); release(); } return; }
      if (blocked(e.target) || (!pull && Date.now() - lastScroll < 400)) return;
      // a firmer pull than touch, so ordinary scrolling up to the top doesn't refresh by accident
      show(pull + Math.min(40, -e.deltaY * (e.deltaMode === 1 ? 12 : 1)) * 0.32);
      clearTimeout(idle);
      idle = setTimeout(release, 220);
    };

    document.addEventListener("touchstart", tStart, { passive: true });
    document.addEventListener("touchmove", tMove, { passive: false });
    document.addEventListener("touchend", tEnd);
    document.addEventListener("pointerdown", pDown);
    document.addEventListener("pointermove", pMove);
    document.addEventListener("pointerup", pEnd);
    document.addEventListener("pointercancel", pEnd);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("wheel", onWheel, { passive: true });
    return () => {
      clearTimeout(idle);
      root.classList.remove("ptr-dragging");
      document.removeEventListener("touchstart", tStart);
      document.removeEventListener("touchmove", tMove);
      document.removeEventListener("touchend", tEnd);
      document.removeEventListener("pointerdown", pDown);
      document.removeEventListener("pointermove", pMove);
      document.removeEventListener("pointerup", pEnd);
      document.removeEventListener("pointercancel", pEnd);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("wheel", onWheel);
    };
  });
</script>

<div class="ptr {phase}" class:on={shown} class:ready role="status" aria-live="polite" style:--pull="{pull}px" style:--k={k.toFixed(3)}>
  <div class="ptr-bubble">
    <svg class="ptr-ring" viewBox="0 0 60 60" aria-hidden="true">
      <circle cx="30" cy="30" r="27" class="ptr-track" />
      <circle cx="30" cy="30" r="27" class="ptr-arc" pathLength="100" />
    </svg>
    <img class="ptr-face" src={face(mood)} alt="" />
  </div>
  <span class="ptr-text">{label}</span>
</div>

<style lang="scss">
  @use "tokens" as *;
  @use "mixins" as *;

  .ptr {
    --pull: 0px; --k: 0;
    position: fixed; left: 50%; top: 0; z-index: z(ask); display: flex; flex-direction: column; align-items: center; gap: space(1) + 2; pointer-events: none;
    // Relay's top is 70px above the screen at rest and 16px below it at the trigger point; the label rides below
    transform: translate(-50%, calc(var(--pull) - 70px)); opacity: 0;
    @include motion { transition: opacity .15s; }
    &.on { opacity: 1; }
    &.snap, &.leaving, &.busy, &.done { @include motion { transition: transform .26s cubic-bezier(.3, 1.3, .5, 1), opacity .2s; } }
    &.leaving { transform: translate(-50%, -110%); opacity: 0; }
  }
  :global(.ptr-dragging), :global(.ptr-dragging *) { user-select: none !important; cursor: grabbing !important; }
  .ptr-bubble {
    position: relative; width: 60px; height: 60px; border-radius: 50%; background: var(--card-solid); box-shadow: 0 10px 28px rgba(9, 35, 72, .22);
    display: grid; place-items: center;
    // stretches a little as you pull, like it's hanging on
    @include motion { transform: scale(calc(.7 + var(--k) * .3)) rotate(calc((1 - var(--k)) * -25deg)); }
  }
  .ptr-face { width: 42px; height: 32px; transform-origin: 50% 80%; }
  .ptr-ring { position: absolute; inset: 0; width: 100%; height: 100%; transform: rotate(-90deg); }
  .ptr-track { fill: none; stroke: var(--line); stroke-width: 3; }
  // the ring fills as you pull; at the trigger it's full
  .ptr-arc {
    fill: none; stroke: var(--accent); transform-box: fill-box; transform-origin: center; stroke-width: 3.5; stroke-linecap: round;
    stroke-dasharray: calc(var(--k) * 100) 100; @include motion { transition: stroke .2s; }
  }
  .ready .ptr-arc { stroke: var(--accent-2); }
  .done .ptr-arc { stroke: var(--green); stroke-dasharray: 100 100; }
  .busy .ptr-arc { stroke-dasharray: 28 100; }
  @include motion {
    .ready .ptr-face { animation: relay-wiggle .45s ease-in-out infinite alternate; }
    .busy .ptr-face { animation: bob .7s ease-in-out infinite alternate; }
    .done .ptr-face { animation: relay-jump .6s cubic-bezier(.3, 1.4, .5, 1); }
    // refreshing: a short arc that spins
    .busy .ptr-arc { animation: spin .8s linear infinite; }
  }
  @keyframes bob { from { transform: translateY(1px) scale(1); } to { transform: translateY(-2px) scale(1.04); } }
  @keyframes spin { to { transform: rotate(360deg); } }
  .ptr-text {
    font-size: fs(sm); font-weight: $weight-bold; color: var(--text); background: var(--card-solid); padding: space(1) space(3); border-radius: $radius-pill;
    box-shadow: 0 4px 12px rgba(9, 35, 72, .12); opacity: calc(var(--k) * 1.4 - .3);
  }
  .busy .ptr-text, .done .ptr-text { opacity: 1; }
</style>
