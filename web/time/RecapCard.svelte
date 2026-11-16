<script lang="ts">
  import { face } from "../lib/api.ts";
  import { colorOf } from "../lib/timecolors.ts";
  import { today } from "../lib/todo.ts";
  import { work } from "../lib/work.svelte.ts";
  import { dayOf, duration, weekStart, weeklyRecap } from "../../src/shared/work.ts";
  import { fade } from "svelte/transition";
  import { ms } from "../lib/look.svelte.ts";

  /**
   * Relay's weekly recap: on the first visit of a new week, last week in numbers (hours, against the
   * week before, the busiest day, where the time went, the issues worked on), until it's put away.
   * "Last week" in the page header brings it back.
   */
  let { open = $bindable(false) }: { open?: boolean } = $props();
  const KEY = "ferry-recap-seen";
  const lastMonday = $derived(weekStart(dayOf(Date.parse(weekStart(today()) + "T12:00:00") - 3 * 86_400_000)));
  const r = $derived(weeklyRecap(work.days, lastMonday));
  // shown by itself once a week, when there's something to say
  $effect(() => {
    if (r.minutes > 0 && localStorage.getItem(KEY) !== lastMonday) open = true;
  });
  function close() {
    localStorage.setItem(KEY, lastMonday);
    open = false;
  }
  const change = $derived(r.before ? Math.round(((r.minutes - r.before) / r.before) * 100) : null);
  const say = $derived(
    !r.minutes
      ? "Nothing counted last week."
      : change === null
        ? `${duration(r.minutes)} last week. The first week I counted!`
        : change >= 10
          ? `${duration(r.minutes)} last week, ${change}% more than the week before.`
          : change <= -10
            ? `${duration(r.minutes)} last week, ${-change}% less than the week before.`
            : `${duration(r.minutes)} last week, about the same as the week before.`,
  );
  const weekday = (d: string) => new Date(d + "T12:00:00").toLocaleDateString(undefined, { weekday: "long" });
  const range = $derived(
    `${new Date(lastMonday + "T12:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" })} – ${new Date(
      Date.parse(lastMonday + "T12:00:00") + 6 * 86_400_000,
    ).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`,
  );
  const top = $derived(Math.max(1, ...r.projects.map((p) => p.minutes)));
</script>

{#if open}
  <section class="card recap" aria-label="Last week" transition:fade={{ duration: ms(200) }}>
    <img src={face(change !== null && change < -10 ? "thinking" : "party")} alt="" class="relay" />
    <div class="body">
      <div class="label">Your week · {range}</div>
      <h2>{say}</h2>
      <div class="facts">
        <span><b>{r.worked}</b> {r.worked === 1 ? "day" : "days"} worked</span>
        {#if r.best}<span>busiest <b>{weekday(r.best.day)}</b> ({duration(r.best.minutes)})</span>{/if}
        {#if r.billable}<span><b>{duration(r.billable)}</b> billable</span>{/if}
        {#if r.issues.length}<span>most on <b>{r.issues.map((i) => i.key).join(", ")}</b></span>{/if}
      </div>
      {#if r.projects.length}
        <ul class="bars">
          {#each r.projects as p (p.name)}
            <li>
              <span class="n">{p.name}</span>
              <span class="b"><i style:width="{(p.minutes / top) * 100}%" style:background={colorOf(p.name)}></i></span>
              <span class="v">{duration(p.minutes)}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
    <button type="button" class="btn small ghost close" onclick={close}>Got it</button>
  </section>
{/if}

<style lang="scss">
  @use "tokens" as *;
  @use "mixins" as *;

  .recap {
    position: relative;
    display: flex;
    gap: space(4);
    padding: space(4) space(5);
    background:
      radial-gradient(90% 120% at 0% 0%, color-mix(in srgb, var(--amber) 18%, transparent), transparent 60%),
      var(--card-solid);
    border: 1px solid color-mix(in srgb, var(--amber) 30%, var(--line));
  }
  .relay {
    width: 84px;
    height: 64px;
    flex: none;
  }
  .body {
    flex: 1;
    min-width: 0;
  }
  .label {
    font-size: 11.5px;
    font-weight: $weight-bold;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
  }
  h2 {
    font-size: 18px;
    margin: 4px 0 space(2);
  }
  .facts {
    display: flex;
    flex-wrap: wrap;
    gap: space(1) space(4);
    font-size: 13px;
    color: var(--muted);
    b {
      color: var(--text);
    }
  }
  .bars {
    list-style: none;
    margin: space(3) 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-width: 520px;
    li {
      display: grid;
      grid-template-columns: 120px 1fr 64px;
      align-items: center;
      gap: space(2);
      font-size: 12.5px;
    }
    .n {
      @include ellipsis;
    }
    .b {
      height: 8px;
      border-radius: 4px;
      background: var(--card2);
      overflow: hidden;
      i {
        display: block;
        height: 100%;
        border-radius: 4px;
      }
    }
    .v {
      text-align: right;
      color: var(--muted);
      font-variant-numeric: tabular-nums;
    }
  }
  .close {
    position: absolute;
    top: space(3);
    right: space(3);
  }
</style>
