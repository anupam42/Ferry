<script lang="ts">
  import Icon from "../components/Icon.svelte";
  import { face } from "../lib/api.ts";
  import { toast } from "../lib/app.svelte.ts";
  import { notes } from "../lib/notes.svelte.ts";
  import { relay } from "../lib/relay.svelte.ts";
  import { colorOf } from "../lib/timecolors.ts";
  import { work } from "../lib/work.svelte.ts";
  import { clock, duration } from "../../src/shared/work.ts";

  /**
   * The timer: what you're on, a big clock while it runs, Start and Stop. A focus session counts
   * down instead, holds notifications, and chimes when it's over. When Ferry sees you've been saving
   * with no timer, it offers to start one from when you began; when a timer runs but the saves have
   * stopped, it asks what to do with the idle time.
   */
  const running = $derived(work.timer?.running ?? null);
  const elapsed = $derived(running ? work.now - running.start : 0);
  const fs = $derived(work.focus);
  const left = $derived(fs ? fs.ends - work.now : 0);

  let task = $state("");
  let project = $state(localStorage.getItem("ferry-timer-project") || "");
  let billable = $state<boolean | null>(null);
  type Mode = 0 | 25 | 50;
  let mode = $state<Mode>((+(localStorage.getItem("ferry-timer-mode") ?? 0) as Mode) || 0);
  // the last project used, or the one you're saving in
  $effect(() => {
    if (!project && work.suggestion) project = work.suggestion.repo;
    else if (!project && work.projects.length) project = work.projects[0]!;
  });
  const billNow = $derived(billable ?? !!work.timer?.billable[project]);

  async function start(from?: number) {
    const p = project.trim() || work.suggestion?.repo || "";
    if (!p) return;
    localStorage.setItem("ferry-timer-project", p);
    localStorage.setItem("ferry-timer-mode", String(mode));
    const ok = await work.act("start", {
      project: p,
      task,
      billable: billNow,
      ...(from ? { start: from } : {}),
      ...(mode && !from ? { focus: mode } : {}),
    });
    if (ok) {
      task = "";
      billable = null;
      relay.react("focused", 900, { jump: true });
    }
  }
  async function stop(at?: number) {
    if (await work.act("stop", at ? { at } : {})) relay.react("happy", 900, { jump: true });
  }

  // the end of a focus session: a chime, a desktop notice when the page is hidden, and Relay
  let chimed = $state("");
  $effect(() => {
    if (!fs?.done || !running) return;
    const key = String(running.start);
    if (chimed === key) return;
    chimed = key;
    chime();
    relay.react("party", 1600, { jump: true, burst: true });
    toast("Focus session done. Take a break?", { mood: "party" });
    if (document.hidden && notes.prefs.desktop && "Notification" in window && Notification.permission === "granted")
      new Notification("Ferry · focus session done", { body: running.task || running.project, icon: "/logo.svg" });
  });
  function chime() {
    try {
      const ctx = new AudioContext();
      [660, 880].forEach((f, i) => {
        const o = ctx.createOscillator(),
          g = ctx.createGain();
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.18);
        g.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + i * 0.18 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.18 + 0.5);
        o.connect(g).connect(ctx.destination);
        o.start(ctx.currentTime + i * 0.18);
        o.stop(ctx.currentTime + i * 0.18 + 0.55);
      });
    } catch {}
  }
  // the ring around a focus session's clock
  const R = 46,
    C = 2 * Math.PI * R;
  const since = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
</script>

<section class="card timer" class:on={!!running} class:focus={!!fs} aria-label="Timer">
  {#if !fs}
    <img
      src={face(running ? (work.idle ? "sleepy" : "focused") : work.suggestion ? "wink" : "happy")}
      alt=""
      class="relay"
      class:bob={!!running}
    />
  {/if}
  {#if running}
    <div class="label">{fs ? (fs.done ? "Focus session done" : "Focusing") : "On the clock"}</div>
    {#if fs}
      <div class="ring-row">
        <svg viewBox="0 0 110 110" width="110" height="110" class="ring" aria-hidden="true">
          <circle cx="55" cy="55" r={R} class="ring-track" />
          <circle
            cx="55"
            cy="55"
            r={R}
            class="ring-fill"
            stroke-dasharray="{C * fs.progress} {C}"
            transform="rotate(-90 55 55)"
          />
          <image href={face(fs.done ? "party" : "focused")} x="25" y="33" width="60" height="44" />
        </svg>
        <div>
          <div class="clock mono" role="timer" aria-live="off">{fs.done ? clock(elapsed) : clock(left)}</div>
          <div class="muted small">
            {fs.done ? `${running.focus} minutes done, still counting` : `left of ${running.focus} minutes`} · notifications
            {fs.done ? "are back" : "wait"}
          </div>
        </div>
      </div>
    {:else}
      <div class="clock mono" role="timer" aria-live="off">{clock(elapsed)}</div>
    {/if}
    <div class="what">
      <span class="dot" style:background={colorOf(running.project)}></span>
      <b>{running.task || "No task"}</b>
      <span class="muted">· {running.project} · since {since(running.start)}</span>
      {#if running.billable}<span class="pill green">$ billable</span>{/if}
    </div>
    {#if work.idle}
      {@const idle = work.idle}
      <div class="idle" role="alert">
        <div>
          <b>No saves in {running.project} since {since(idle.since)}</b>
          <span class="muted">({duration(idle.minutes)}). Were you still on it?</span>
        </div>
        <div class="idle-acts">
          <button
            type="button"
            class="btn small ghost"
            disabled={work.busy}
            onclick={() => work.act("edit", { id: "running", idleOk: Date.now() })}>Yes, keep it</button
          >
          <button
            type="button"
            class="btn small ghost"
            disabled={work.busy}
            title="Stops the timer at your last save, then starts it again now"
            onclick={async () => {
              const r = running;
              if (await work.act("stop", { at: idle.since }))
                await work.act("start", { project: r.project, task: r.task, billable: r.billable });
            }}>Drop it, carry on</button
          >
          <button type="button" class="btn small ghost danger" disabled={work.busy} onclick={() => stop(idle.since)}
            >Stop at {since(idle.since)}</button
          >
        </div>
      </div>
    {/if}
    <div class="row">
      <input
        type="text"
        placeholder="What are you working on?"
        aria-label="Task"
        value={running.task}
        onchange={(e) => work.act("edit", { id: "running", task: e.currentTarget.value })}
      />
      {#if fs?.done}
        <button
          type="button"
          class="btn small ghost"
          disabled={work.busy}
          title="Keep timing without the countdown"
          onclick={() => work.act("edit", { id: "running", focus: null })}>Keep going</button
        >
        <button type="button" class="btn stop" disabled={work.busy} onclick={() => stop(fs.ends)}
          ><Icon name="stop" size={15} />Stop at {since(fs.ends)}</button
        >
      {:else}
        <button type="button" class="btn stop" disabled={work.busy} onclick={() => stop()}
          ><Icon name="stop" size={15} />Stop</button
        >
      {/if}
    </div>
  {:else}
    <div class="label">Time tracker</div>
    <h3>What are you working on?</h3>
    <form
      class="form"
      onsubmit={(e) => {
        e.preventDefault();
        void start();
      }}
    >
      <input type="text" placeholder="Fixing the login bug (PROJ-12)" aria-label="Task" bind:value={task} />
      <div class="row">
        <input
          type="text"
          list="time-projects"
          placeholder="Project"
          aria-label="Project"
          bind:value={project}
          onchange={() => (billable = null)}
        />
        <datalist id="time-projects">
          {#each work.projects as p (p)}<option value={p}></option>{/each}
        </datalist>
        <button
          type="button"
          class="bill"
          class:yes={billNow}
          aria-pressed={billNow}
          title={billNow ? "Billable" : "Not billable"}
          onclick={() => (billable = !billNow)}>$</button
        >
        <button type="submit" class="btn go" disabled={work.busy || !project.trim()}
          ><Icon name="play" size={15} />{mode ? `Focus ${mode}` : "Start"}</button
        >
      </div>
      <div class="modes" role="radiogroup" aria-label="Timer or focus session">
        {#each [[0, "Timer"], [25, "Focus 25 min"], [50, "Focus 50 min"]] as const as [m, l] (m)}
          <button type="button" role="radio" aria-checked={mode === m} class:on={mode === m} onclick={() => (mode = m)}
            >{l}</button
          >
        {/each}
        {#if mode}<span class="muted">notifications wait until it's over</span>{/if}
      </div>
    </form>
    {#if work.suggestion}
      {@const s = work.suggestion}
      <div class="suggest">
        <span>You've been saving in <b>{s.repo}</b> for {duration(s.minutes)}.</span>
        <button
          type="button"
          class="btn small ghost"
          disabled={work.busy}
          onclick={() => {
            project = s.repo;
            void start(s.since);
          }}>Start from {since(s.since)}</button
        >
      </div>
    {:else}
      <p class="hint">No timer needed: I count your saves and commits anyway. Use one when you want it exact.</p>
    {/if}
  {/if}
</section>

<style lang="scss">
  @use "tokens" as *;
  @use "mixins" as *;

  .timer {
    position: relative;
    padding: space(4) + 2 space(4) + 2 space(4);
    overflow: hidden;
    background:
      radial-gradient(120% 90% at 100% 0%, color-mix(in srgb, var(--accent) 22%, transparent), transparent 60%),
      linear-gradient(160deg, color-mix(in srgb, var(--accent) 10%, var(--card-solid)), var(--card-solid));
    border: 1px solid color-mix(in srgb, var(--accent) 22%, var(--line));
    &.on {
      background:
        radial-gradient(120% 90% at 100% 0%, color-mix(in srgb, var(--green) 26%, transparent), transparent 60%),
        linear-gradient(160deg, color-mix(in srgb, var(--green) 10%, var(--card-solid)), var(--card-solid));
      border-color: color-mix(in srgb, var(--green) 30%, var(--line));
    }
  }
  .relay {
    position: absolute;
    right: space(3);
    top: space(3);
    width: 64px;
    height: 48px;
  }
  @include motion {
    .bob {
      animation: bob 2.4s ease-in-out infinite;
    }
  }
  @keyframes bob {
    50% {
      transform: translateY(-4px) rotate(-3deg);
    }
  }
  .label {
    font-size: 11.5px;
    font-weight: $weight-bold;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
  }
  h3 {
    font-size: 17px;
    margin: 4px 0 space(3);
    padding-right: 72px;
  }
  .clock {
    font-size: 40px;
    font-weight: $weight-bold;
    letter-spacing: -0.02em;
    line-height: 1.1;
    margin: 4px 0 space(2);
    font-variant-numeric: tabular-nums;
  }
  .what {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: space(1) + 2;
    font-size: 13px;
    margin-bottom: space(3);
    .pill {
      font-size: 11px;
    }
  }
  .dot {
    width: 10px;
    height: 10px;
    border-radius: 3px;
  }
  .form {
    display: flex;
    flex-direction: column;
    gap: space(2);
  }
  .row {
    display: flex;
    gap: space(2);
    align-items: center;
    input {
      flex: 1;
      min-width: 0;
    }
  }
  input {
    background: var(--card-solid);
  }
  .bill {
    width: 38px;
    height: 38px;
    flex: none;
    border-radius: 50%;
    border: 1px solid var(--line);
    background: var(--card-solid);
    color: var(--faint);
    font-weight: $weight-bold;
    cursor: pointer;
    &.yes {
      background: var(--green-soft);
      border-color: var(--green);
      color: var(--green);
    }
    &:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }
  }
  .btn :global(svg) {
    margin-right: 5px;
  }
  .go {
    background: var(--text);
    color: var(--card-solid);
    border-radius: $radius-pill;
    padding: space(2) + 2 space(4);
    flex: none;
  }
  .stop {
    background: var(--red);
    color: #fff;
    border-radius: $radius-pill;
    padding: space(2) + 2 space(4);
    flex: none;
  }
  .suggest {
    margin-top: space(3);
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: space(2);
    padding: space(2) space(3);
    border-radius: $radius-md + 2;
    background: color-mix(in srgb, var(--card-solid) 70%, transparent);
    font-size: 12.5px;
    span {
      flex: 1;
    }
  }
  .hint {
    margin: space(3) 0 0;
    font-size: 12.5px;
    color: var(--muted);
  }
  // a focus session
  .timer.focus {
    background:
      radial-gradient(120% 90% at 100% 0%, color-mix(in srgb, var(--violet) 26%, transparent), transparent 60%),
      linear-gradient(160deg, color-mix(in srgb, var(--violet) 10%, var(--card-solid)), var(--card-solid));
    border-color: color-mix(in srgb, var(--violet) 30%, var(--line));
  }
  .ring-row {
    display: flex;
    align-items: center;
    gap: space(3);
    margin: space(2) 0;
    .clock {
      margin: 0;
    }
    .small {
      font-size: 12px;
    }
  }
  .ring-track {
    fill: none;
    stroke: var(--card2);
    stroke-width: 8;
  }
  .ring-fill {
    fill: none;
    stroke: var(--violet);
    stroke-width: 8;
    stroke-linecap: round;
    @include motion {
      transition: stroke-dasharray 1s linear;
    }
  }
  // the idle question
  .idle {
    margin-bottom: space(3);
    padding: space(2) + 2 space(3);
    border-radius: $radius-md + 2;
    background: var(--amber-soft);
    border: 1px solid color-mix(in srgb, var(--amber) 40%, transparent);
    font-size: 12.5px;
    display: flex;
    flex-direction: column;
    gap: space(2);
  }
  .idle-acts {
    display: flex;
    flex-wrap: wrap;
    gap: space(1);
  }
  // timer or focus
  .modes {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: space(1);
    font-size: 12px;
    button {
      border: 1px solid var(--line);
      background: var(--card-solid);
      color: var(--muted);
      border-radius: $radius-pill;
      padding: 3px space(2) + 2;
      font: inherit;
      cursor: pointer;
      &.on {
        background: var(--text);
        border-color: var(--text);
        color: var(--card-solid);
      }
    }
    span {
      margin-left: space(1);
    }
  }
</style>
