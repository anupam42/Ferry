<script lang="ts">
  import { fade } from "svelte/transition";

  import Icon from "../components/Icon.svelte";
  import { face } from "../lib/api.ts";
  import { app } from "../lib/app.svelte.ts";
  import { intro } from "../lib/intro.svelte.ts";
  import { ms } from "../lib/look.svelte.ts";
  import { relay } from "../lib/relay.svelte.ts";
  import { canPlay, chirp, opening, OPENING_HIT, setSound, soundOn } from "../lib/sound.ts";
  import type { Mode } from "../lib/types.ts";

  /**
   * Relay introduces Ferry, one idea at a time: who it is, why Ferry exists, what it does, and
   * where things are. Arrow keys, Enter and the dots move between scenes; Escape or Skip ends it.
   */
  interface Scene {
    face: string;
    eyebrow: string;
    title: string;
    text: string;
    /** the picture beside the words */
    art: "hello" | "mess" | "ferry" | "safe" | "git" | "todo" | "go";
    /** the background's two colours */
    tint: [string, string];
  }
  const SCENES: Scene[] = [
    {
      face: "excited",
      eyebrow: "Hello",
      title: "Hi, I'm Relay.",
      text: "I live inside Ferry, and I'll be keeping your work in flow. Let me show you around. It takes a minute.",
      art: "hello",
      tint: ["var(--accent)", "var(--accent-2)"],
    },
    {
      face: "thinking",
      eyebrow: "Why Ferry",
      title: "Good work starts messy.",
      text: "Experiments, scratch files, half-finished ideas. That's how building feels. But your repository should only see what's ready, and committing it all by hand is tedious and easy to get wrong.",
      art: "mess",
      tint: ["var(--violet)", "var(--accent)"],
    },
    {
      face: "happy",
      eyebrow: "What it does",
      title: "Work in one folder. Commit from another.",
      text: "Ferry watches your working folder and carries every change into your git repository, one way or both ways. It can also commit and push on a timer, or send your work to a server or the cloud.",
      art: "ferry",
      tint: ["var(--accent-2)", "var(--accent)"],
    },
    {
      face: "cool",
      eyebrow: "Nothing gets lost",
      title: "Every change has a way back.",
      text: "Each sync is recorded, so you can undo it or go back to this morning. Conflicts wait for your decision instead of being overwritten, and secrets are caught before they leave your machine.",
      art: "safe",
      tint: ["var(--green)", "var(--accent-2)"],
    },
    {
      face: "focused",
      eyebrow: "Git, made friendly",
      title: "All of git, none of the fear.",
      text: "Commit single lines, switch branches, fix conflicts change by change, rewrite or undo history, and review pull requests. I'll tell you what each step does before it happens.",
      art: "git",
      tint: ["var(--accent)", "var(--violet)"],
    },
    {
      face: "happy",
      eyebrow: "Stay on track",
      title: "Your plans, where your code is.",
      text: "The Todo tab reads the checklists in each project's README. Tick things off, give them a date, and I'll nudge you when something's late or has been waiting too long.",
      art: "todo",
      tint: ["var(--amber)", "var(--accent)"],
    },
    {
      face: "party",
      eyebrow: "Ready",
      title: "Let's get your work moving.",
      text: "Start with a folder pair: the folder you work in and the repository it goes to. Or look around first. You can watch this again any time from Settings → About.",
      art: "go",
      tint: ["var(--accent)", "var(--accent-2)"],
    },
  ];

  let at = $state(0);
  let dir = $state(1);
  const s = $derived(SCENES[at]!);
  const last = $derived(at === SCENES.length - 1);
  let next = $state<HTMLButtonElement>();
  const before = document.activeElement as HTMLElement | null;
  $effect(() => {
    void at;
    next?.focus();
  });
  $effect(() => () => before?.focus?.());
  // the app behind isn't seen meanwhile: hiding it also stops a wide page from widening a phone's screen
  $effect(() => {
    document.documentElement.classList.add("intro-open");
    return () => document.documentElement.classList.remove("intro-open");
  });

  /**
   * The opening, like a film's: a dark stage, a light that swells while the sound rises around
   * you, and a flash into the first scene as the chord lands, with Relay's "hi" in it. Browsers
   * only allow sound after a click, so when they hold it back it starts behind a "Begin" button.
   * With motion reduced there's no opening, just the first scene and Relay's chirp.
   */
  let sound = $state(soundOn());
  let phase = $state<"wait" | "gate" | "opening" | "scenes">("wait");
  let flashed = $state(false);
  let stopOpening = () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  let beginBtn = $state<HTMLButtonElement>();
  function runOpening(withSound: boolean) {
    phase = "opening";
    if (withSound) stopOpening = opening();
    timer = setTimeout(() => {
      phase = "scenes";
      flashed = true;
    }, OPENING_HIT * 1000);
  }
  $effect(() => {
    void (async () => {
      if (ms(1) === 0) {
        phase = "scenes";
        chirp("hello", true);
      } else if (!soundOn()) runOpening(false);
      else if (await canPlay()) runOpening(true);
      else phase = "gate";
    })();
    return () => {
      clearTimeout(timer);
      stopOpening();
    };
  });
  $effect(() => {
    if (phase === "gate") beginBtn?.focus();
  });
  // a click: the browser now allows sound (canPlay asks for it inside the click)
  function begin() {
    void canPlay().then((ok) => runOpening(ok && soundOn()));
  }
  function toggleSound() {
    sound = !sound;
    setSound(sound);
    if (!sound) stopOpening();
    else if (phase === "scenes") chirp("hello");
  }
  const MARK = "FERRY".split("");

  function go(i: number) {
    if (i < 0 || i >= SCENES.length || i === at) return;
    dir = i > at ? 1 : -1;
    at = i;
    chirp("pop");
  }
  function finish(to: Mode | null) {
    clearTimeout(timer);
    if (phase !== "scenes") stopOpening();
    else chirp(to ? "party" : "pop");
    intro.close();
    if (to) app.go(to);
    relay.react("party", 1600, { jump: true, burst: true });
  }
  function key(e: KeyboardEvent) {
    if (phase !== "scenes" && e.key !== "Escape") return;
    if (e.key === "Escape") {
      e.preventDefault();
      finish(null);
    } else if (e.key === "ArrowRight" || e.key === "PageDown") {
      e.preventDefault();
      go(at + 1);
    } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
      e.preventDefault();
      go(at - 1);
    }
  }
  const words = (t: string) => t.split(" ");
  const FILES = ["notes.md", "app.ts", "styles.css", "draft.json"];
</script>

<svelte:window onkeydown={key} />

<div
  class="intro"
  role="dialog"
  aria-modal="true"
  aria-label="Meet Relay"
  class:cinema={phase !== "scenes"}
  style:--t1={s.tint[0]}
  style:--t2={s.tint[1]}
  transition:fade={{ duration: ms(300) }}
>
  <div class="sky" aria-hidden="true">
    <span class="blob a"></span><span class="blob b"></span><span class="blob c"></span>
  </div>

  <header class="top">
    <img src="/logo.svg" alt="Ferry" class="logo" />
    <div class="tools">
      <button
        type="button"
        class="skip icon"
        aria-label={sound ? "Mute Relay" : "Let Relay make sounds"}
        title={sound ? "Mute Relay" : "Turn sound on"}
        aria-pressed={!sound}
        onclick={toggleSound}><Icon name={sound ? "sound" : "mute"} size={18} /></button
      >
      <button type="button" class="skip" onclick={() => finish(null)}>Skip</button>
    </div>
  </header>

  {#if phase !== "scenes"}
    <div class="prelude" class:lit={phase === "opening"} aria-live="polite">
      <div class="orb" aria-hidden="true"></div>
      <div class="rays" aria-hidden="true">
        {#each [0, 1, 2, 3, 4, 5] as n (n)}<i style:--n={n}></i>{/each}
      </div>
      <div class="mark" aria-label="Ferry">
        {#each MARK as c, i (i)}<span style:--i={i} aria-hidden="true">{c}</span>{/each}
      </div>
      {#if phase === "gate"}
        <button type="button" class="begin" bind:this={beginBtn} onclick={begin}
          ><Icon name="play" size={18} />Begin</button
        >
        <small class="phones">Sound on · best with headphones</small>
      {/if}
    </div>
  {:else}
    {#if flashed}<div class="flash" aria-hidden="true"></div>{/if}
    {#key at}
      <section class="scene" style:--dir={dir} aria-live="polite">
        <div class="words">
          <div class="eyebrow">{s.eyebrow}</div>
          <h1>
            {#each words(s.title) as w, i (i)}<span class="w" style:--i={i}>{w}</span>{/each}
          </h1>
          <p style:--i={words(s.title).length}>{s.text}</p>
        </div>

        <div class="art art-{s.art}" aria-hidden="true">
          {#if s.art === "ferry"}
            <div class="shore left">
              <div class="label"><Icon name="folder" size={18} />Working folder</div>
              {#each FILES as f, i (f)}<div class="file" style:--i={i}><Icon name="files" size={15} />{f}</div>{/each}
            </div>
            <div class="river">
              <img src={face(s.face)} alt="" class="relay boat" />
              {#each FILES as f, i (f)}<span class="cargo" style:--i={i}></span>{/each}
            </div>
            <div class="shore right">
              <div class="label"><Icon name="branch" size={18} />Git repository</div>
              {#each FILES as f, i (f)}<div class="file landed" style:--i={i}>
                  <Icon name="check" size={15} />{f}
                </div>{/each}
            </div>
          {:else}
            <div class="stage">
              <div class="halo"></div>
              {#if s.art === "mess"}
                {#each ["draft-3-final.md", "test.ts", "old/", "TODO.txt", "copy of app.ts"] as f, i (f)}
                  <span class="paper" style:--i={i}><Icon name="files" size={14} />{f}</span>
                {/each}
              {:else if s.art === "safe"}
                {#each [["undo", "Undo the last sync"], ["clock", "Go back to this morning"], ["shield", "Secrets caught"]] as [ic, t], i (t)}
                  <span class="chip" style:--i={i}><Icon name={ic} size={15} />{t}</span>
                {/each}
              {:else if s.art === "git"}
                {#each [["branch", "Branches"], ["merge", "Conflicts, change by change"], ["undo", "Undo anything"], ["pr", "Pull requests"]] as [ic, t], i (t)}
                  <span class="chip" style:--i={i}><Icon name={ic} size={15} />{t}</span>
                {/each}
              {:else if s.art === "todo"}
                {#each ["Write the docs", "Ship the Todo tab", "Fix the login bug"] as t, i (t)}
                  <span class="check" class:ticked={i === 1} style:--i={i}
                    ><span class="box"><Icon name="check" size={13} /></span>{t}</span
                  >
                {/each}
              {:else if s.art === "go" || s.art === "hello"}
                {#each [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as n (n)}<i
                    class="spark"
                    style:--a="{n * 30}deg"
                    style:--n={n}
                  ></i>{/each}
              {/if}
              {#if s.art === "hello"}
                <div class="welcome">
                  <span class="hi" aria-hidden="true">Hi!<span class="hand">👋</span></span>
                  <img src={face(s.face)} alt="" class="relay wave" />
                  <span class="shadow"></span>
                  {#each [0, 1, 2] as n (n)}<span class="heart" style:--n={n}>♥</span>{/each}
                </div>
              {:else}
                <img src={face(s.face)} alt="" class="relay" />
              {/if}
            </div>
          {/if}
        </div>
      </section>
    {/key}

    <footer class="bottom">
      <div class="dots" role="tablist" aria-label="Scenes">
        {#each SCENES as sc, i (i)}
          <button
            type="button"
            role="tab"
            class="dot"
            class:on={i === at}
            class:past={i < at}
            aria-selected={i === at}
            aria-label="{i + 1}. {sc.eyebrow}"
            onclick={() => go(i)}
          ></button>
        {/each}
      </div>
      <div class="nav">
        {#if at > 0}<button type="button" class="btn ghost" onclick={() => go(at - 1)}>Back</button>{/if}
        {#if last}
          <button type="button" class="btn ghost" onclick={() => finish(null)}>Look around</button>
          <button type="button" class="btn brand" bind:this={next} onclick={() => finish("sync")}
            >Add a folder pair<Icon name="plus" size={17} /></button
          >
        {:else}
          <button type="button" class="btn brand" bind:this={next} onclick={() => go(at + 1)}
            >{at === 0 ? "Show me" : "Next"}<span class="arrow" aria-hidden="true">→</span></button
          >
        {/if}
      </div>
    </footer>
  {/if}
</div>

<style lang="scss">
  @use "tokens" as *;
  @use "mixins" as *;

  :global(.intro-open .app) {
    visibility: hidden;
    display: none;
  }
  .intro {
    position: fixed;
    inset: 0;
    z-index: z(ask) + 5;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto 1fr auto;
    background: var(--bg, var(--card-solid));
    background: color-mix(in srgb, var(--card-solid) 92%, var(--t1));
    color: var(--text);
    overflow: hidden auto;
    padding: space(6) space(10);
    @include below(laptop) {
      padding: space(5) space(6);
    }
    @include below(phone) {
      padding: space(4);
      gap: space(4);
    }
  }

  // ---------- the opening ----------
  .intro.cinema {
    background: #050a18;
    color: #fff;
    .sky {
      opacity: 0;
    }
    .skip {
      background: rgba(255, 255, 255, 0.08);
      color: rgba(255, 255, 255, 0.7);
      &:hover {
        color: #fff;
      }
    }
    .logo {
      opacity: 0;
    }
  }
  .prelude {
    position: relative;
    display: grid;
    place-items: center;
    align-content: center;
    gap: space(6);
    grid-row: 2 / 4;
  }
  .orb {
    position: absolute;
    width: 420px;
    height: 420px;
    border-radius: 50%;
    background: radial-gradient(
      circle,
      rgba(255, 255, 255, 0.9) 0%,
      color-mix(in srgb, var(--accent-2) 70%, transparent) 18%,
      color-mix(in srgb, var(--accent) 45%, transparent) 40%,
      transparent 70%
    );
    filter: blur(8px);
    opacity: 0.12;
    transform: scale(0.25);
  }
  .rays {
    position: absolute;
    width: 900px;
    height: 900px;
    opacity: 0;
    i {
      position: absolute;
      left: 50%;
      top: 50%;
      width: 2px;
      height: 50%;
      margin-left: -1px;
      transform-origin: 50% 0;
      transform: rotate(calc(var(--n) * 60deg));
      background: linear-gradient(to bottom, rgba(255, 255, 255, 0.35), transparent 70%);
    }
  }
  .mark {
    position: relative;
    display: flex;
    gap: 0.5em;
    font-size: clamp(30px, 5vw, 56px);
    font-weight: 800;
    letter-spacing: 0.1em;
    span {
      opacity: 0.15;
    }
  }
  .begin {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: space(2);
    padding: space(3) space(6);
    border: 1px solid rgba(255, 255, 255, 0.3);
    border-radius: $radius-pill;
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
    font: inherit;
    font-size: 16px;
    font-weight: $weight-bold;
    cursor: pointer;
    &:hover {
      background: rgba(255, 255, 255, 0.18);
    }
    &:focus-visible {
      outline: 2px solid #fff;
      outline-offset: 3px;
    }
  }
  .phones {
    position: relative;
    margin-top: calc(space(4) * -1);
    color: rgba(255, 255, 255, 0.55);
    font-size: 13px;
  }
  // the chord lands: a flash of light, and the first scene is there
  .flash {
    position: fixed;
    inset: 0;
    z-index: 3;
    pointer-events: none;
    background: radial-gradient(circle at 70% 50%, #fff, color-mix(in srgb, #fff 70%, var(--accent-2)) 40%, #fff);
    opacity: 0;
  }

  // soft colour drifting behind everything, tinted per scene
  .sky {
    position: fixed;
    inset: -20%;
    pointer-events: none;
    filter: blur(70px);
    opacity: 0.55;
  }
  .blob {
    position: absolute;
    width: 46vmax;
    height: 46vmax;
    border-radius: 50%;
    @include motion {
      transition: background 1.2s ease;
    }
    &.a {
      left: 5%;
      top: 10%;
      background: color-mix(in srgb, var(--t1) 55%, transparent);
    }
    &.b {
      right: 0;
      top: 30%;
      background: color-mix(in srgb, var(--t2) 50%, transparent);
    }
    &.c {
      left: 35%;
      bottom: -5%;
      width: 34vmax;
      height: 34vmax;
      background: color-mix(in srgb, var(--t1) 30%, var(--t2) 20%);
    }
  }

  .top,
  .bottom,
  .scene {
    position: relative;
  }
  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .logo {
    height: 34px;
  }
  .tools {
    display: flex;
    gap: space(2);
  }
  .skip.icon {
    display: grid;
    place-items: center;
    width: 38px;
    padding: 0;
  }
  .skip {
    border: 0;
    background: color-mix(in srgb, var(--card-solid) 70%, transparent);
    color: var(--muted);
    font: inherit;
    font-weight: $weight-semibold;
    padding: space(2) space(4);
    border-radius: $radius-pill;
    cursor: pointer;
    &:hover {
      color: var(--text);
    }
    &:focus-visible {
      @include focus-ring;
    }
  }

  .scene {
    display: grid;
    grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr);
    align-items: center;
    gap: space(10);
    max-width: 1180px;
    width: 100%;
    margin: 0 auto;
    @include below(laptop) {
      grid-template-columns: minmax(0, 1fr);
      gap: space(5);
      align-content: center;
      .art {
        order: -1;
      }
    }
  }
  .eyebrow {
    font-size: 13px;
    font-weight: $weight-bold;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--accent);
    margin-bottom: space(3);
  }
  h1 {
    font-size: clamp(34px, 5.2vw, 64px);
    line-height: 1.04;
    letter-spacing: -0.025em;
    margin: 0 0 space(5);
    font-weight: 800;
  }
  // each word animates on its own; the gap stands in for the space between them
  .w {
    display: inline-block;
    margin-right: 0.24em;
  }
  p {
    font-size: clamp(16px, 1.45vw, 19px);
    line-height: 1.6;
    color: var(--muted);
    max-width: 34em;
    margin: 0;
  }

  // the picture
  .art {
    position: relative;
    min-height: 360px;
    display: grid;
    place-items: center;
    @include below(laptop) {
      min-height: 220px;
    }
  }
  .stage {
    position: relative;
    width: 360px;
    height: 360px;
    display: grid;
    place-items: center;
    @include below(laptop) {
      width: 240px;
      height: 240px;
    }
  }
  .halo {
    position: absolute;
    inset: 12%;
    border-radius: 50%;
    background: radial-gradient(circle, color-mix(in srgb, var(--t2) 35%, transparent), transparent 70%);
  }
  .relay {
    position: relative;
    width: 220px;
    height: 162px;
    filter: drop-shadow(0 18px 30px rgba(9, 35, 72, 0.18));
    @include below(laptop) {
      width: 150px;
      height: 110px;
    }
  }
  // things floating around Relay
  .paper,
  .chip,
  .check {
    position: absolute;
    display: inline-flex;
    align-items: center;
    gap: space(2);
    padding: space(2) space(3);
    border-radius: $radius-md;
    background: var(--card-solid);
    box-shadow: 0 8px 24px rgba(9, 35, 72, 0.1);
    font-size: 13px;
    font-weight: $weight-semibold;
    white-space: nowrap;
    z-index: 1;
  }
  .paper {
    font-family: $font-mono;
    font-weight: 500;
    color: var(--muted);
    &:nth-of-type(1) {
      left: -12%;
      top: 6%;
      rotate: -8deg;
    }
    &:nth-of-type(2) {
      right: -16%;
      top: 14%;
      rotate: 6deg;
    }
    &:nth-of-type(3) {
      left: -6%;
      bottom: 10%;
      rotate: 4deg;
    }
    &:nth-of-type(4) {
      right: -4%;
      bottom: 2%;
      rotate: -5deg;
    }
    &:nth-of-type(5) {
      left: 30%;
      top: -8%;
      rotate: 2deg;
    }
  }
  .chip {
    color: var(--text);
    :global(svg) {
      color: var(--accent);
    }
    &:nth-of-type(1) {
      left: -16%;
      top: 4%;
    }
    &:nth-of-type(2) {
      right: -20%;
      top: 14%;
    }
    &:nth-of-type(3) {
      left: -12%;
      bottom: 6%;
    }
    &:nth-of-type(4) {
      right: -10%;
      bottom: -2%;
    }
  }
  .art-safe .chip :global(svg) {
    color: var(--green);
  }
  .check {
    left: -10%;
    top: calc(8% + var(--i) * 56px);
    .box {
      width: 20px;
      height: 20px;
      border-radius: 6px;
      border: 2px solid var(--faint);
      display: grid;
      place-items: center;
      color: transparent;
    }
    &.ticked .box {
      background: var(--green);
      border-color: var(--green);
      color: #fff;
    }
    &.ticked {
      color: var(--muted);
    }
  }
  .art-todo .relay {
    margin-left: 46%;
    margin-top: 30%;
  }
  // the first scene: Relay arrives, says hi and waves
  .welcome {
    position: relative;
    display: grid;
    place-items: center;
  }
  .hi {
    position: absolute;
    right: -38%;
    top: -26%;
    z-index: 2;
    padding: space(2) space(4);
    border-radius: 18px 18px 18px 4px;
    background: var(--card-solid);
    box-shadow: 0 10px 28px rgba(9, 35, 72, 0.14);
    font-size: 22px;
    font-weight: 800;
    white-space: nowrap;
  }
  .hand {
    display: inline-block;
    margin-left: 6px;
    transform-origin: 70% 80%;
  }
  .shadow {
    position: absolute;
    bottom: -14px;
    width: 120px;
    height: 14px;
    border-radius: 50%;
    background: rgba(9, 35, 72, 0.14);
    filter: blur(3px);
  }
  .heart {
    position: absolute;
    top: 0;
    left: calc(30% + var(--n) * 22%);
    color: #ff6b8b;
    font-size: 18px;
    opacity: 0;
  }
  .spark {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 8px;
    height: 8px;
    margin: -4px;
    border-radius: 50%;
    background: var(--accent);
    opacity: 0;
    &:nth-of-type(3n + 1) {
      background: var(--accent-2);
    }
    &:nth-of-type(3n + 2) {
      background: var(--amber);
    }
  }

  // the ferry: files cross from the working folder to the repository
  .art-ferry {
    grid-template-columns: 1fr 1.1fr 1fr;
    gap: space(3);
    width: 100%;
    @include below(laptop) {
      grid-template-columns: 1fr 1fr 1fr;
    }
  }
  .shore {
    display: flex;
    flex-direction: column;
    gap: space(2);
    padding: space(4);
    border-radius: $radius-lg + 4;
    background: color-mix(in srgb, var(--card-solid) 85%, transparent);
    box-shadow: 0 12px 34px rgba(9, 35, 72, 0.1);
    min-width: 0;
  }
  .label {
    display: flex;
    align-items: center;
    gap: space(2);
    font-weight: $weight-bold;
    font-size: 13.5px;
    margin-bottom: space(1);
    @include ellipsis;
  }
  .file {
    display: flex;
    align-items: center;
    gap: space(2);
    font-family: $font-mono;
    font-size: 12px;
    color: var(--muted);
    padding: 5px space(2);
    border-radius: $radius-sm;
    background: var(--card2);
    @include ellipsis;
    &.landed :global(svg) {
      color: var(--green);
    }
  }
  .river {
    position: relative;
    height: 200px;
    display: grid;
    place-items: center;
    // the water: a dashed line Relay rides along
    &::before {
      content: "";
      position: absolute;
      left: -8%;
      right: -8%;
      top: 50%;
      border-top: 2px dashed color-mix(in srgb, var(--accent) 45%, transparent);
    }
  }
  .boat {
    width: 130px;
    height: 96px;
    z-index: 1;
  }
  @include below(phone) {
    .art-ferry {
      gap: space(1);
    }
    .shore {
      padding: space(2);
      gap: space(1);
    }
    .label {
      font-size: 12px;
    }
    .file {
      font-size: 10.5px;
      padding: 3px space(1);
      :global(svg) {
        display: none;
      }
    }
    .boat {
      width: 84px;
      height: 62px;
    }
    .river {
      height: 140px;
    }
  }
  .cargo {
    position: absolute;
    left: -8%;
    top: 50%;
    width: 10px;
    height: 10px;
    margin-top: -5px;
    border-radius: 3px;
    background: var(--accent);
    opacity: 0;
  }

  // footer: progress dots and buttons
  .bottom {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: space(4);
    max-width: 1180px;
    width: 100%;
    margin: 0 auto;
  }
  .dots {
    display: flex;
    gap: space(2);
  }
  .dot {
    width: 9px;
    height: 9px;
    padding: 0;
    border: 0;
    border-radius: $radius-pill;
    background: color-mix(in srgb, var(--text) 18%, transparent);
    cursor: pointer;
    @include motion {
      transition:
        width 0.35s $ease-out,
        background 0.3s;
    }
    &.past {
      background: color-mix(in srgb, var(--accent) 55%, transparent);
    }
    &.on {
      width: 30px;
      background: var(--accent);
    }
    &:focus-visible {
      @include focus-ring;
    }
  }
  .nav {
    display: flex;
    gap: space(2);
    .btn {
      font-size: 15px;
      padding: space(3) space(5);
    }
  }
  .arrow {
    display: inline-block;
    margin-left: space(1);
  }

  // ---------- motion ----------
  @include motion {
    // the opening: the light swells and the letters come out of the dark, in step with the sound
    .prelude.lit .orb {
      animation: swell 2.6s cubic-bezier(0.5, 0, 0.9, 0.6) forwards;
    }
    .prelude.lit .rays {
      animation: rays 2.6s ease-in forwards;
    }
    .prelude.lit .mark span {
      animation: letter 2.2s ease-out calc(0.3s + var(--i) * 0.18s) forwards;
    }
    .prelude .orb {
      animation: glow 3s ease-in-out infinite alternate;
    }
    .flash {
      animation: flash 1.1s ease-out forwards;
    }
    .begin {
      animation: rise 0.6s $ease-out 0.4s backwards;
    }
    .blob.a {
      animation: drift-a 16s ease-in-out infinite alternate;
    }
    .blob.b {
      animation: drift-b 19s ease-in-out infinite alternate;
    }
    .blob.c {
      animation: drift-c 23s ease-in-out infinite alternate;
    }
    // a scene arrives from the side it was asked for
    .eyebrow {
      animation: rise 0.5s $ease-out backwards;
    }
    .w {
      animation: word 0.6s cubic-bezier(0.2, 0.9, 0.3, 1) calc(0.08s + var(--i) * 55ms) backwards;
    }
    p {
      animation: rise 0.6s $ease-out calc(0.2s + var(--i) * 55ms) backwards;
    }
    .art {
      animation: art-in 0.7s cubic-bezier(0.2, 0.9, 0.3, 1) 0.1s backwards;
    }
    .relay {
      animation:
        pop 0.7s cubic-bezier(0.3, 1.6, 0.5, 1) 0.15s backwards,
        bob 4s ease-in-out 0.9s infinite;
    }
    // hello: Relay drops in with a squash, hops twice with the chirps, waves, then floats
    .relay.wave {
      animation:
        arrive 0.6s cubic-bezier(0.3, 1.3, 0.5, 1) 0.05s backwards,
        hop 0.5s ease-out 0.55s 2,
        hello 1.4s ease-in-out 1.6s 2,
        bob 4s ease-in-out 4.4s infinite;
    }
    .shadow {
      animation:
        shadow-in 0.6s ease-out 0.05s backwards,
        shadow-hop 0.5s ease-out 0.55s 2;
    }
    .hi {
      animation: bubble 0.55s cubic-bezier(0.3, 1.7, 0.5, 1) 0.75s backwards;
    }
    .hand {
      animation: wave-hand 1.2s ease-in-out 1.1s 3;
    }
    .heart {
      animation: heart 2.4s ease-out calc(1.2s + var(--n) * 0.35s) 2;
    }
    .halo {
      animation: breathe 5s ease-in-out infinite;
    }
    .paper {
      animation:
        float-in 0.6s cubic-bezier(0.3, 1.4, 0.5, 1) calc(0.35s + var(--i) * 90ms) backwards,
        jitter 3.5s ease-in-out calc(1s + var(--i) * 0.4s) infinite;
    }
    .chip,
    .check {
      animation: float-in 0.6s cubic-bezier(0.3, 1.4, 0.5, 1) calc(0.45s + var(--i) * 120ms) backwards;
    }
    .check.ticked .box {
      animation: tick 0.4s cubic-bezier(0.3, 1.7, 0.5, 1) 1.4s backwards;
    }
    .spark {
      animation: spark 1.6s ease-out calc(0.5s + var(--n) * 40ms) infinite;
    }
    .art-hello .spark {
      animation-iteration-count: 1;
    }
    .file {
      animation: rise 0.45s $ease-out calc(0.3s + var(--i) * 80ms) backwards;
    }
    .file.landed {
      animation: land 0.5s cubic-bezier(0.3, 1.5, 0.5, 1) calc(1.3s + var(--i) * 0.55s) backwards;
    }
    .cargo {
      animation: cross 2.2s cubic-bezier(0.45, 0, 0.55, 1) calc(0.6s + var(--i) * 0.55s) infinite;
    }
    .boat {
      animation:
        pop 0.7s cubic-bezier(0.3, 1.6, 0.5, 1) 0.15s backwards,
        sail 2.2s ease-in-out 0.9s infinite;
    }
    .nav .brand:hover .arrow {
      animation: nudge 0.6s ease-in-out infinite;
    }
  }
  @keyframes word {
    from {
      opacity: 0;
      transform: translateY(0.45em) rotate(calc(var(--dir) * 2deg));
      filter: blur(6px);
    }
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(14px);
    }
  }
  @keyframes art-in {
    from {
      opacity: 0;
      transform: translateX(calc(var(--dir) * 40px)) scale(0.96);
    }
  }
  @keyframes pop {
    from {
      opacity: 0;
      transform: scale(0.5) rotate(-8deg);
    }
  }
  @keyframes bob {
    50% {
      transform: translateY(-10px);
    }
  }
  @keyframes hello {
    0%,
    100% {
      transform: rotate(0);
    }
    20% {
      transform: rotate(-9deg);
    }
    40% {
      transform: rotate(7deg);
    }
    60% {
      transform: rotate(-5deg);
    }
    80% {
      transform: rotate(3deg);
    }
  }
  @keyframes swell {
    0% {
      transform: scale(0.25);
      opacity: 0.15;
    }
    100% {
      transform: scale(3.2);
      opacity: 1;
    }
  }
  @keyframes glow {
    to {
      opacity: 0.22;
      transform: scale(0.32);
    }
  }
  @keyframes rays {
    0% {
      opacity: 0;
      transform: rotate(0) scale(0.6);
    }
    100% {
      opacity: 1;
      transform: rotate(80deg) scale(1.4);
    }
  }
  @keyframes letter {
    0% {
      opacity: 0.15;
      letter-spacing: 0.1em;
      filter: blur(6px);
    }
    60% {
      opacity: 1;
      filter: blur(0);
    }
    100% {
      opacity: 1;
      text-shadow: 0 0 24px rgba(255, 255, 255, 0.8);
    }
  }
  @keyframes flash {
    0% {
      opacity: 1;
    }
    100% {
      opacity: 0;
    }
  }
  @keyframes arrive {
    0% {
      opacity: 0;
      transform: translateY(-120px) scale(0.6, 1.2);
    }
    55% {
      opacity: 1;
      transform: translateY(0) scale(1.18, 0.82);
    }
    75% {
      transform: translateY(-8px) scale(0.95, 1.06);
    }
    100% {
      transform: none;
    }
  }
  @keyframes hop {
    0%,
    100% {
      transform: none;
    }
    20% {
      transform: scale(1.08, 0.92);
    }
    50% {
      transform: translateY(-26px) scale(0.96, 1.05);
    }
    80% {
      transform: scale(1.05, 0.95);
    }
  }
  @keyframes shadow-in {
    from {
      opacity: 0;
      transform: scale(0.3);
    }
  }
  @keyframes shadow-hop {
    50% {
      transform: scale(0.7);
      opacity: 0.6;
    }
  }
  @keyframes bubble {
    from {
      opacity: 0;
      transform: translate(-30px, 20px) scale(0.3);
    }
  }
  @keyframes wave-hand {
    0%,
    100% {
      transform: rotate(0);
    }
    15%,
    45% {
      transform: rotate(18deg);
    }
    30%,
    60% {
      transform: rotate(-12deg);
    }
  }
  @keyframes heart {
    0% {
      opacity: 0;
      transform: translateY(10px) scale(0.5);
    }
    20% {
      opacity: 1;
    }
    100% {
      opacity: 0;
      transform: translateY(-90px) scale(1.2) rotate(calc((var(--n) - 1) * 18deg));
    }
  }
  @keyframes breathe {
    50% {
      transform: scale(1.12);
      opacity: 0.7;
    }
  }
  @keyframes float-in {
    from {
      opacity: 0;
      transform: translateY(18px) scale(0.85);
    }
  }
  @keyframes jitter {
    50% {
      transform: translateY(-6px);
    }
  }
  @keyframes tick {
    from {
      transform: scale(0.4);
      background: transparent;
    }
  }
  @keyframes spark {
    0% {
      opacity: 0;
      transform: rotate(var(--a)) translateY(-60px) scale(0.4);
    }
    25% {
      opacity: 1;
    }
    100% {
      opacity: 0;
      transform: rotate(var(--a)) translateY(-160px) scale(1);
    }
  }
  @keyframes cross {
    0% {
      left: -8%;
      opacity: 0;
      transform: scale(0.6);
    }
    15% {
      opacity: 1;
      transform: scale(1);
    }
    85% {
      opacity: 1;
    }
    100% {
      left: 104%;
      opacity: 0;
      transform: scale(0.6);
    }
  }
  @keyframes land {
    from {
      opacity: 0;
      transform: translateX(-14px);
    }
  }
  @keyframes sail {
    50% {
      transform: translateY(-6px) rotate(-3deg);
    }
  }
  @keyframes nudge {
    50% {
      transform: translateX(4px);
    }
  }
  @keyframes drift-a {
    to {
      transform: translate(12%, 8%) scale(1.1);
    }
  }
  @keyframes drift-b {
    to {
      transform: translate(-14%, -6%) scale(0.92);
    }
  }
  @keyframes drift-c {
    to {
      transform: translate(8%, -12%) scale(1.15);
    }
  }
</style>
