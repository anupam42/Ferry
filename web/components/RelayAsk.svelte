<script lang="ts">
  import { fade, scale } from "svelte/transition";

  import { face } from "../lib/api.ts";
  import { asking } from "../lib/app.svelte.ts";
  import { ms } from "../lib/look.svelte.ts";

  // Relay reacts to which answer you're about to pick
  let hover = $state<"yes" | "no" | "">("");
  const q = $derived(asking.current);
  const yesFirst = $derived(q?.primary === "yes" && !q?.hold);
  // with hold: the risky answer is pressed and held, so a slip of the mouse can't do it
  let progress = $state(0);
  let last = $state<{ mood: string; say: string; text?: string } | null>(null);
  let holding = $state(false);
  const mood = $derived(last ? last.mood : !q ? "thinking" : holding ? "worried" : hover === "yes" ? q.yesMood || "sad" : hover === "no" ? q.noMood || "happy" : q.mood || "thinking");

  // the fields' values, filled from their defaults each time a new question opens
  let values = $state<Record<string, string | boolean>>({});
  let seen: unknown = null;
  $effect(() => {
    if (q && q !== seen) { seen = q; values = Object.fromEntries((q.fields ?? []).map((f) => [f.name, f.value ?? (f.type === "check" ? false : "")])); }
  });
  const trimmed = () => Object.fromEntries(Object.entries(values).map(([k, v]) => [k, typeof v === "string" ? v.trim() : v]));

  let started = 0, frame = 0;
  function finish(v: boolean, after?: { mood: string; say: string; text?: string }) {
    const cur = q;
    if (!cur) return;
    const out = v && cur.fields ? trimmed() : undefined;
    if (after) { last = after; setTimeout(() => { last = null; progress = 0; cur.resolve(v, out); }, 950); }
    else { progress = 0; cur.resolve(v, out); }
  }
  function tick() {
    progress = Math.min(1, (performance.now() - started) / 1100);
    if (progress >= 1) { holding = false; started = 0; return finish(true, { mood: "sleepy", say: "Okay. I'll stop here.", text: "Your files stay exactly where they are." }); }
    frame = requestAnimationFrame(tick);
  }
  function down(e: PointerEvent | KeyboardEvent) {
    if (!q?.hold || started || last) return;
    if (e instanceof KeyboardEvent && ((e.key !== " " && e.key !== "Enter") || e.repeat)) return;
    e.preventDefault();
    started = performance.now();
    holding = true;
    frame = requestAnimationFrame(tick);
  }
  function up() {
    if (!started) return;
    cancelAnimationFrame(frame);
    started = 0;
    holding = false;
    if (progress < 1) progress = 0;
  }
  function keydown(e: KeyboardEvent) {
    if (q && e.key === "Escape" && !last) q.resolve(false);
  }
</script>

<svelte:window onkeydown={keydown} />

{#if q}
  <div class="wrap" role="alertdialog" aria-modal="true" aria-label={q.title} transition:fade={{ duration: ms(150) }}
    onclick={(e) => { if (e.target === e.currentTarget && !last) q.resolve(false); }} onkeydown={() => {}} tabindex="-1">
    <div class="ask" transition:scale={{ start: .96, duration: ms(180) }}>
      <img class="face" src={face(mood)} alt="Relay" />
      <h3>{last ? last.say : holding ? "Are you sure? Keep holding…" : q.title}</h3>
      {#if last ? last.text : q.text}<p>{last ? last.text : q.text}</p>{/if}
      {#if !last && q.items?.length}
        <div class="items">
          {#each q.items as it, i (i)}
            <div class="item {it.level}"><span class="kind">{it.label}</span><span class="where mono"><bdi>{it.where}</bdi></span><span class="what">{it.text}</span></div>
          {/each}
          {#if q.more}<div class="more">and {q.more} more</div>{/if}
        </div>
      {/if}
      {#if !last && q.fields?.length}
        <div class="fields">
          {#each q.fields as f (f.name)}
            {#if f.type === "check"}
              <label class="check"><input type="checkbox" bind:checked={values[f.name] as boolean} /><span>{f.label}</span></label>
            {:else}
              <label class="field"><span class="label">{f.label}</span>
                <input type="text" placeholder={f.placeholder ?? ""} bind:value={values[f.name] as string}
                  onkeydown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (!q.hold) finish(true); } }} />
                {#if f.hint}<small>{f.hint}</small>{/if}</label>
            {/if}
          {/each}
        </div>
      {/if}
      <div class="row">
        <!-- svelte-ignore a11y_autofocus -->
        <button class="btn" class:brand={!yesFirst} class:ghost={yesFirst} autofocus={!yesFirst} disabled={!!last}
          onmouseenter={() => (hover = "no")} onmouseleave={() => (hover = "")} onfocus={() => (hover = "no")}
          onclick={() => finish(false, q.hold ? { mood: "party", say: "Yay, I'll keep going!" } : undefined)}>{q.no || "Cancel"}</button>
        <button class="btn" class:brand={yesFirst} class:hold={q.hold} class:danger={q.hold} disabled={!!last} style:--p={progress}
          onmouseenter={() => (hover = "yes")} onmouseleave={() => { hover = ""; up(); }} onfocus={() => (hover = "yes")} onblur={up}
          onpointerdown={down} onpointerup={up} onpointercancel={up} onkeydown={down} onkeyup={up}
          onclick={() => { if (!q.hold) finish(true); }}><i class="prog"></i><span>{q.hold ? "Hold to " + (q.yes || "yes").toLowerCase() : q.yes || "Yes"}</span></button>
      </div>
      {#if q.hold}<div class="note">Press and hold for a second (or hold Space), so a slip of the mouse can't do it.</div>{/if}
    </div>
  </div>
{/if}

<style lang="scss">
  @use "tokens" as *;
  @use "mixins" as *;

  .wrap { position: fixed; inset: 0; z-index: z(ask); display: grid; place-items: center; background: var(--overlay); padding: space(4); }
  .ask {
    width: min(480px, 100%); padding: space(5) space(6) space(5); margin-top: 60px; text-align: center;
    background: var(--card-solid); border-radius: $radius-xl + 4; box-shadow: var(--shadow);
  }
  .face {
    width: 150px; height: 110px; margin: -80px auto space(1); display: block; filter: drop-shadow(0 10px 20px rgba(9, 35, 72, .25));
    @include motion { animation: bob 2.4s ease-in-out infinite; }
  }
  h3 { font-size: fs(lg) + 2; margin-bottom: space(2); }
  p { color: var(--muted); margin: 0 0 space(4); }
  .row { display: flex; justify-content: center; gap: space(3); flex-wrap: wrap; }
  .prog { display: none; }
  .hold { position: relative; overflow: hidden; touch-action: none; user-select: none;
    .prog { display: block; position: absolute; inset: 0; background: var(--red-soft); transform-origin: left; transform: scaleX(var(--p, 0)); }
    span { position: relative; } }
  .note { margin-top: space(3); color: var(--muted); font-size: fs(sm); }
  .fields { text-align: left; margin: 0 0 space(4); }
  .items { text-align: left; margin: 0 0 space(4); border: 1px solid var(--line); border-radius: $radius-md; overflow: hidden; max-height: 40vh; overflow-y: auto; }
  .item {
    display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 2px space(2); padding: space(2) space(3); border-top: 1px solid var(--line); font-size: fs(sm);
    &:first-child { border-top: 0; }
    &.block .kind { color: var(--red); } &.warn .kind { color: var(--amber); }
  }
  .kind { font-weight: $weight-bold; }
  .where { color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .what { grid-column: 1 / -1; color: var(--muted); }
  .more { padding: space(2) space(3); color: var(--muted); font-size: fs(sm); border-top: 1px solid var(--line); }
  @keyframes bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
</style>
