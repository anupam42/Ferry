<script lang="ts">
  import Icon from "../components/Icon.svelte";
  import { face } from "../lib/api.ts";
  import { relay } from "../lib/relay.svelte.ts";
  import { colorOf } from "../lib/timecolors.ts";
  import { work } from "../lib/work.svelte.ts";
  import { clock, duration } from "../../src/shared/work.ts";

  /**
   * The timer: what you're on, a big clock while it runs, Start and Stop. When Ferry sees you've
   * been saving for a while with no timer, it offers to start one from when that sitting began.
   */
  const running = $derived(work.timer?.running ?? null);
  const elapsed = $derived(running ? work.now - running.start : 0);

  let task = $state("");
  let project = $state(localStorage.getItem("ferry-timer-project") || "");
  let billable = $state<boolean | null>(null);
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
    const ok = await work.act("start", { project: p, task, billable: billNow, ...(from ? { start: from } : {}) });
    if (ok) {
      task = "";
      billable = null;
      relay.react("focused", 900, { jump: true });
    }
  }
  async function stop() {
    if (await work.act("stop")) relay.react("happy", 900, { jump: true });
  }
  const since = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
</script>

<section class="card timer" class:on={!!running} aria-label="Timer">
  <img
    src={face(running ? "focused" : work.suggestion ? "wink" : "happy")}
    alt=""
    class="relay"
    class:bob={!!running}
  />
  {#if running}
    <div class="label">On the clock</div>
    <div class="clock mono" role="timer" aria-live="off">{clock(elapsed)}</div>
    <div class="what">
      <span class="dot" style:background={colorOf(running.project)}></span>
      <b>{running.task || "No task"}</b>
      <span class="muted">· {running.project} · since {since(running.start)}</span>
      {#if running.billable}<span class="pill green">$ billable</span>{/if}
    </div>
    <div class="row">
      <input
        type="text"
        placeholder="What are you working on?"
        aria-label="Task"
        value={running.task}
        onchange={(e) => work.act("edit", { id: "running", task: e.currentTarget.value })}
      />
      <button type="button" class="btn stop" disabled={work.busy} onclick={stop}
        ><Icon name="stop" size={15} />Stop</button
      >
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
      <input type="text" placeholder="Fixing the login bug" aria-label="Task" bind:value={task} />
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
          ><Icon name="play" size={15} />Start</button
        >
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
</style>
