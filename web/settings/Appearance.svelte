<script lang="ts">
  import Icon from "../components/Icon.svelte";
  import Seg from "../components/Seg.svelte";
  import { face } from "../lib/api.ts";
  import { toast } from "../lib/app.svelte.ts";
  import { look, type ThemeChoice } from "../lib/look.svelte.ts";
  import Row from "./Row.svelte";

  const THEMES: [ThemeChoice, string][] = [["light", "Light"], ["dark", "Dark"], ["system", "System"]];
  // the swatch colours; the real ones are tokens (see $accents in _tokens.scss)
  const ACCENTS = [["", "Relay", "#2586E6", "#3CCBB0"], ["ocean", "Ocean", "#0E7CC2", "#2BB3D9"], ["forest", "Forest", "#1E8C5A", "#6DB85C"],
    ["sunset", "Sunset", "#D9531F", "#EFA233"], ["grape", "Grape", "#7C4DDB", "#C94FBE"], ["graphite", "Graphite", "#3D4A63", "#7A8AA8"]] as const;
  const BACKGROUNDS = [["", "Relay"], ["plain", "Plain"], ["sky", "Sky"], ["mint", "Mint"], ["lavender", "Lavender"], ["sand", "Sand"]] as const;
  let time = $state(localStorage.getItem("ferry-time") || "relative");
</script>

<Row label="Theme" hint="System follows your computer's light or dark mode" tall>
  <div class="themes" role="radiogroup" aria-label="Theme">
    {#each THEMES as [id, name] (id)}
      <button class="theme" class:on={look.theme === id} role="radio" aria-checked={look.theme === id} onclick={() => look.setTheme(id)}>
        <span class="preview {id}" aria-hidden="true"><i></i><i></i><i></i></span>
        <span class="name">{name}{#if look.theme === id}<Icon name="check" size={16} />{/if}</span>
      </button>
    {/each}
  </div>
</Row>

<Row label="Accent colour" hint="Buttons, highlights and Relay's glow. Charts keep their own colours so they read the same">
  <div class="swatches" role="radiogroup" aria-label="Accent colour">
    {#each ACCENTS as [id, name, a, b] (id)}
      <button class="swatch" class:on={look.get("accent") === id} role="radio" aria-checked={look.get("accent") === id} aria-label={name} title={name}
        style:background="linear-gradient(135deg, {a}, {b})" onclick={() => look.set("accent", id)}>
        {#if look.get("accent") === id}<Icon name="check" size={15} />{/if}
      </button>
    {/each}
  </div>
</Row>

<Row label="Background" hint="Behind everything. Each one has a light and a dark version that follows the theme" tall>
  <div class="bgs" role="radiogroup" aria-label="Background">
    {#each BACKGROUNDS as [id, name] (id)}
      <button class="bg" class:on={look.get("bg") === id} role="radio" aria-checked={look.get("bg") === id} onclick={() => look.set("bg", id)}>
        <span class="bg-preview" style:background="var(--bg-{id || 'relay'}-{look.shown === 'dark' ? 'd' : 'l'})">
          {#if look.get("bg") === id}<Icon name="check" size={18} />{/if}
        </span>
        <span>{name}</span>
      </button>
    {/each}
  </div>
</Row>

<Row label="Interface size" hint="Makes everything smaller or bigger, text included">
  <Seg label="Interface size" options={[["small", "Small"], ["", "Default"], ["large", "Large"]]} value={look.get("size")} onchange={(v) => look.set("size", v)} />
</Row>

<Row label="Sidebar position" hint="Down the left, or as a bar across the top of the app">
  <Seg label="Sidebar position" options={[["", "Vertical"], ["top", "Horizontal"]]} value={look.get("railpos")}
    onchange={(v) => { look.set("railpos", v); toast(v ? "Sidebar across the top" : "Sidebar down the left", { mood: "wink" }); }} />
</Row>

<Row label="Sidebar size" hint="Thin keeps just small icons, wide adds names. With the sidebar down the left you can also drag its edge">
  <Seg label="Sidebar size" options={[["thin", "Thin"], ["", "Regular"], ["wide", "Wide"]]} value={look.get("rail")} onchange={(v) => look.set("rail", v)} />
</Row>

<Row label="Toolbar" hint="The views of a folder pair or repository: a rail down the right, or a bar across the top">
  <Seg label="Toolbar position" options={[["", "Vertical"], ["horizontal", "Horizontal"]]} value={look.get("dock")}
    onchange={(v) => { look.set("dock", v); toast(v ? "Toolbar across the top" : "Toolbar down the right", { mood: "wink" }); }} />
</Row>

<Row label="Motion" hint="Relay's animations, drawers sliding in, and other movement">
  <select aria-label="Motion" value={look.get("motion")} onchange={(e) => look.set("motion", e.currentTarget.value)}>
    <option value="">Follow my system</option><option value="reduce">Reduce motion</option>
  </select>
</Row>

<Row label="Times" hint="How the app shows when things happened">
  <select aria-label="Times" bind:value={time} onchange={() => { localStorage.setItem("ferry-time", time); toast(time === "exact" ? "Showing exact times" : "Showing relative times", { mood: "wink" }); }}>
    <option value="relative">Relative (5 min ago)</option><option value="exact">Exact (9 Nov, 2:05 PM)</option>
  </select>
</Row>

<div class="note"><img src={face("wink")} alt="" /><span>More themes and backgrounds are coming. This is where you'll pick them.</span></div>

<style lang="scss">
  @use "tokens" as *;
  @use "mixins" as *;

  .themes { display: flex; gap: space(3); flex-wrap: wrap; }
  .theme {
    width: 132px; padding: space(2); border-radius: $radius-lg - 2; border: 2px solid var(--line);
    background: var(--card-solid); color: var(--text); text-align: left; cursor: pointer;
    &.on { border-color: var(--accent); }
  }
  .name {
    display: flex; align-items: center; justify-content: space-between; padding: space(2) space(1) 2px;
    font-weight: $weight-semibold; font-size: fs(sm) + 1; color: var(--text);
    :global(svg) { color: var(--accent); stroke-width: 3; }
  }
  .preview {
    display: grid; grid-template-columns: 18px 1fr; grid-template-rows: 1fr 1fr; gap: 5px; height: 70px; padding: 7px; border-radius: $radius-md - 2;
    i { border-radius: 5px; &:first-child { grid-row: span 2; } }
    &.light { background: linear-gradient(135deg, #DDF6EE, #E4EEFF 50%, #ECE6FF); i { background: #fff; } i:nth-child(2) { background: linear-gradient(135deg, #2586E6, #3CCBB0); } }
    &.dark { background: linear-gradient(135deg, #071430, #1A1844); i { background: #13213F; } i:nth-child(2) { background: linear-gradient(135deg, #4C9DF5, #4FD8BD); } }
    &.system { background: linear-gradient(115deg, #E4EEFF 0 50%, #0D1E40 50% 100%); i { background: linear-gradient(115deg, #fff 0 50%, #13213F 50%); } }
  }

  .swatches { display: flex; gap: space(2) + 2; flex-wrap: wrap; justify-content: flex-end; }
  .swatch {
    width: 30px; height: 30px; border-radius: 50%; border: 0; cursor: pointer; display: grid; place-items: center; color: #fff;
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, .08);
    @include motion { transition: transform $duration-fast; }
    &:hover { transform: scale(1.08); }
    &.on { box-shadow: 0 0 0 2px var(--card-solid), 0 0 0 4px color-mix(in srgb, var(--text) 35%, transparent); }
    :global(svg) { stroke-width: 3; }
  }

  .bgs { display: grid; grid-template-columns: repeat(3, 92px); gap: space(3); }
  .bg {
    display: flex; flex-direction: column; align-items: center; gap: space(1) + 2; padding: 0; border: 0; background: none;
    color: var(--muted); font-size: fs(sm); font-weight: $weight-semibold; cursor: pointer;
    &.on { color: var(--text); .bg-preview { box-shadow: 0 0 0 2px var(--card-solid), 0 0 0 4px var(--accent); } }
  }
  .bg-preview {
    width: 92px; height: 54px; border-radius: $radius-md; display: grid; place-items: center; color: var(--accent); box-shadow: inset 0 0 0 1px var(--line);
    :global(svg) { stroke-width: 3; padding: 3px; border-radius: 50%; background: var(--card-solid); }
  }

  .note { display: flex; align-items: center; gap: space(3); padding: space(3) + 2 space(5) + 2; color: var(--muted); font-size: fs(sm) + .5; background: var(--card2); img { width: 46px; height: 34px; } }

  @include below(phone) {
    .swatches { justify-content: flex-start; }
    .theme { width: calc((100% - #{space(6)}) / 3); min-width: 96px; }
  }
</style>
