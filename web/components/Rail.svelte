<script lang="ts">
  import { face } from "../lib/api.ts";
  import { app } from "../lib/app.svelte.ts";
  import { look } from "../lib/look.svelte.ts";
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
    const p = app.mode === "sync" ? sync.current : null;
    if (!p) return "happy";
    const m = sync.moodOf(p);
    return m.anim ? "focused" : m.face;
  });
  const size = $derived(look.get("rail"));
  const sizeIndex = $derived(Math.max(0, SIZES.findIndex(([k]) => k === size)));

  function key(e: KeyboardEvent) {
    const i = sizeIndex;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") { e.preventDefault(); look.set("rail", SIZES[Math.min(2, i + 1)]![0]); }
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") { e.preventDefault(); look.set("rail", SIZES[Math.max(0, i - 1)]![0]); }
  }

  // Drag the edge: the rail follows the pointer (only its own width changes and the page beside
  // it slides with a transform, so nothing re-lays out per frame), then glides to the nearest size.
  function down(e: PointerEvent) {
    if (e.button !== 0 || look.get("railpos") === "top") return;
    e.preventDefault();
    const grip = e.currentTarget as HTMLElement;
    try { grip.setPointerCapture(e.pointerId); } catch {}
    const root = document.documentElement;
    root.classList.add("rail-dragging");
    const zoom = parseFloat(getComputedStyle(document.body).zoom) || 1;
    const box = rail.getBoundingClientRect();
    const start = box.width / zoom;
    const beside = [...document.querySelectorAll<HTMLElement>(".app > .content")];
    let w = start, frame = 0;
    const paint = () => {
      frame = 0;
      rail.style.width = w + "px";
      for (const el of beside) el.style.transform = `translateX(${w - start}px)`;
    };
    const move = (ev: PointerEvent) => {
      w = Math.max(56, Math.min(232, (ev.clientX - box.left) / zoom));
      if (!frame) frame = requestAnimationFrame(paint);
    };
    const up = () => {
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", up);
      grip.removeEventListener("pointercancel", up);
      if (frame) { cancelAnimationFrame(frame); paint(); }
      const want = snap(w), target = WIDTHS[want]!;
      const finish = () => {
        for (const el of [rail, ...beside]) { el.style.transition = ""; el.style.transform = ""; }
        rail.style.width = "";
        look.set("rail", want);
        void document.body.offsetWidth; // apply the new layout before transitions come back
        root.classList.remove("rail-dragging");
      };
      if (matchMedia("(prefers-reduced-motion: reduce)").matches || root.dataset.motion === "reduce" || Math.abs(w - target) < 1) return finish();
      const ease = "220ms cubic-bezier(.3,1,.4,1)";
      rail.style.transition = `width ${ease}`;
      for (const el of beside) el.style.transition = `transform ${ease}`;
      requestAnimationFrame(() => {
        rail.style.width = target + "px";
        for (const el of beside) el.style.transform = `translateX(${target - start}px)`;
      });
      setTimeout(finish, 240);
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up);
    grip.addEventListener("pointercancel", up);
  }
</script>

<nav class="rail" bind:this={rail} aria-label="Ferry">
  <button class="home" onclick={() => app.go("sync")} title="Relay: back to the home page" aria-label="Home">
    <span class="face"><img src={face(railFace)} alt="" /></span>
    <span class="dot" class:off={!app.online} title={app.online ? "Ferry is running" : "Ferry isn't answering"}></span>
    <span class="label brand">Ferry<small>with Relay</small></span>
  </button>
  {#each items as it (it.mode)}
    <button class="btn-rail" class:on={app.mode === it.mode} onclick={() => app.go(it.mode)} title={it.label} aria-label={it.label} aria-current={app.mode === it.mode ? "page" : undefined}>
      <Icon name={it.icon} size={22} /><span class="label">{it.label}</span>
    </button>
  {/each}
  <div class="grow"></div>
  <button class="btn-rail" class:on={app.mode === "settings"} onclick={() => app.go("settings")} title="Settings" aria-label="Settings" aria-current={app.mode === "settings" ? "page" : undefined}>
    <Icon name="gear" size={22} /><span class="label">Settings</span>
  </button>
  <div class="grip" role="slider" tabindex="0" aria-label="Sidebar width: drag, or use the arrow keys" aria-valuemin={0} aria-valuemax={2}
    aria-valuenow={sizeIndex} aria-valuetext={SIZES[sizeIndex]![1]} title="Drag to make the sidebar thinner or wider · double-click to switch"
    onpointerdown={down} onkeydown={key} ondblclick={() => look.set("rail", SIZES[(sizeIndex + 1) % 3]![0])}></div>
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
    .face img { width: 50px; height: 38px; display: block; }
  }
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
  }

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

  // thin: small icons
  :global([data-rail="thin"]) {
    .rail { padding: space(3) 0; gap: space(2) + 2; border-radius: $radius-xl; }
    .btn-rail { width: 42px; height: 42px; }
    .home { width: 48px; height: 48px; .face img { width: 38px; height: 29px; } }
  }
  // wide: icons and names
  :global([data-rail="wide"]) {
    .rail { align-items: stretch; padding: space(4) space(3); gap: space(2); }
    .label { display: block; font-weight: $weight-semibold; font-size: 14px; @include ellipsis; }
    .btn-rail {
      width: auto; height: 46px; border-radius: $radius-lg - 2; display: flex; align-items: center; gap: space(3); padding: 0 space(4);
      justify-content: flex-start; box-shadow: none; background: transparent;
      &:hover { transform: none; background: var(--pill); }
      &.on { @include brand-gradient; box-shadow: 0 6px 16px color-mix(in srgb, var(--accent) 30%, transparent); }
    }
    .home { width: auto; height: 64px; border-radius: $radius-lg + 2; display: flex; align-items: center; gap: space(2) + 2; padding: 0 space(3) 0 space(2); margin-bottom: space(1) + 2; }
    .dot { left: 48px; right: auto; top: 8px; }
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
