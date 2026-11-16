<script lang="ts">
  import Icon from "../components/Icon.svelte";
  import RelayLoading from "../components/RelayLoading.svelte";
  import Seg from "../components/Seg.svelte";
  import { assign } from "../lib/timecolors.ts";
  import { today } from "../lib/todo.ts";
  import { work } from "../lib/work.svelte.ts";
  import { byProject, duration, lastDays, weekDays, weekStart } from "../../src/shared/work.ts";
  import Donut from "./Donut.svelte";
  import ProjectBars from "./ProjectBars.svelte";
  import StandupCard from "./StandupCard.svelte";
  import TimerCard from "./TimerCard.svelte";
  import Timesheet from "./Timesheet.svelte";
  import Tracker from "./Tracker.svelte";
  import CalendarCard from "./CalendarCard.svelte";
  import Invoice from "./Invoice.svelte";
  import RecapCard from "./RecapCard.svelte";
  import { askFields } from "../lib/app.svelte.ts";

  /**
   * Time: how long you worked on what. Ferry counts it from your saves and commits without being
   * asked; a timer counts exactly when you want it to. Charts for the last days, today's work as a
   * list, a standup to paste, and the week as a timesheet.
   */
  $effect(() => {
    void work.load();
    const tick = setInterval(() => (work.now = Date.now()), 1000);
    // new saves and commits show up every minute, and when you come back to the page
    const poll = setInterval(() => void work.load(work.span || 42, true), 60_000);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  });
  function refocus() {
    if (document.visibilityState === "visible") void work.load(work.span || 42, true);
  }

  type Range = "7" | "14" | "30";
  let range = $state<Range>((localStorage.getItem("ferry-time-range") as Range) || "7");
  const RANGES = [
    ["7", "7 days"],
    ["14", "14 days"],
    ["30", "30 days"],
  ] as const;

  const now = $derived(today());
  const span = $derived(lastDays(now, +range));
  const chart = $derived(byProject(work.days, span));
  // colours are handed out busiest first, once, and then stay with each project
  $effect(() => assign(chart.projects.map((p) => p.name)));

  const dayMin = (d: string) => work.days.find((x) => x.day === d)?.minutes ?? 0;
  const week = $derived(weekDays(weekStart(now)));
  const weekMin = $derived(week.reduce((n, d) => n + dayMin(d), 0));
  const weekBill = $derived(week.reduce((n, d) => n + (work.days.find((x) => x.day === d)?.billable ?? 0), 0));
  // last week up to the same weekday, so a Tuesday isn't compared with a whole week
  const lastWeekMin = $derived(
    lastDays(week[0]!, 8)
      .slice(0, Math.max(1, week.indexOf(now) + 1))
      .reduce((n, d) => n + dayMin(d), 0),
  );
  // days in a row with some work; a weekend you took off doesn't break it
  const streak = $derived.by(() => {
    let n = 0;
    for (const d of lastDays(now, 120).reverse()) {
      const off = [0, 6].includes(new Date(d + "T12:00:00").getDay());
      if (dayMin(d) > 0) n++;
      else if (d === now || off) continue;
      else break;
    }
    return n;
  });
  const goals = $derived(work.timer?.goals ?? { day: 0, week: 0 });
  let recapOpen = $state(false);
  async function setGoals() {
    const v = await askFields({
      mood: "excited",
      title: "Set your goals",
      text: "Hours you'd like to work. Leave one empty for no goal.",
      yes: "Save goals",
      no: "Cancel",
      primary: "yes",
      fields: [
        { name: "day", label: "A day (hours)", value: goals.day ? String(goals.day / 60) : "", placeholder: "6" },
        { name: "week", label: "A week (hours)", value: goals.week ? String(goals.week / 60) : "", placeholder: "30" },
      ],
    });
    if (!v) return;
    const h = (x: unknown) => Math.round((parseFloat(String(x ?? "").replace(",", ".")) || 0) * 60);
    await work.act("goals", { day: h(v.day), week: h(v.week) });
  }
  const dateLine = $derived(
    new Date(now + "T12:00:00").toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" }),
  );
</script>

<svelte:document onvisibilitychange={refocus} />

{#snippet ring(p: number, label: string)}
  {@const R = 20}
  {@const C = 2 * Math.PI * R}
  <svg class="goal" class:done={p >= 1} viewBox="0 0 50 50" width="50" height="50" role="img" aria-label={label}>
    <circle cx="25" cy="25" r={R} class="g-track" />
    <circle
      cx="25"
      cy="25"
      r={R}
      class="g-fill"
      stroke-dasharray="{C * Math.min(1, p)} {C}"
      transform="rotate(-90 25 25)"
    />
    <text x="25" y="29" text-anchor="middle">{Math.min(999, Math.round(p * 100))}%</text>
  </svg>
{/snippet}

<div class="time">
  <header class="top">
    <div>
      <h1>Time</h1>
      <p class="muted">{dateLine} · counted from your saves and commits, or a timer</p>
    </div>
    <div class="grow"></div>
    {#if work.data}
      <div class="tools" role="toolbar" aria-label="Time">
        <button
          type="button"
          class="tool"
          class:on={recapOpen}
          aria-pressed={recapOpen}
          title="Relay's recap of last week"
          onclick={() => (recapOpen = !recapOpen)}><Icon name="chart" size={16} /><span>Last week</span></button
        >
        <button
          type="button"
          class="tool"
          class:set={!!(goals.day || goals.week)}
          title={goals.day || goals.week ? "Change your goals" : "Set a daily or weekly goal"}
          onclick={setGoals}
          ><Icon name="target" size={16} /><span
            >{goals.day
              ? `${duration(goals.day)} a day`
              : goals.week
                ? `${duration(goals.week)} a week`
                : "Set goals"}</span
          ></button
        >
      </div>
    {/if}
    <Seg
      options={RANGES}
      value={range}
      label="Days shown"
      onchange={(v) => {
        range = v;
        localStorage.setItem("ferry-time-range", v);
        if (+v + 7 > work.span) void work.load(+v + 7);
      }}
    />
  </header>

  {#if !work.data && !work.error}
    <RelayLoading say="Adding up your time" />
  {:else if work.error && !work.data}
    <div class="card pad muted">Couldn't read your time: {work.error}</div>
  {:else}
    <RecapCard bind:open={recapOpen} />
    <section class="stats" aria-label="Totals">
      <div class="card stat" class:has-goal={!!goals.day}>
        <div class="txt">
          <span class="k">Today</span><b>{duration(dayMin(now))}</b>
          <small
            >{goals.day
              ? dayMin(now) >= goals.day
                ? "goal reached 🎉"
                : `${duration(goals.day - dayMin(now))} to your goal`
              : work.timer?.running
                ? "a timer is running"
                : "so far"}</small
          >
        </div>
        {#if goals.day}{@render ring(
            dayMin(now) / goals.day,
            `${Math.round((dayMin(now) / goals.day) * 100)}% of today's goal`,
          )}{/if}
      </div>
      <div class="card stat" class:has-goal={!!goals.week}>
        <div class="txt">
          <span class="k">This week</span><b>{duration(weekMin)}</b>
          <small
            >{goals.week
              ? weekMin >= goals.week
                ? "weekly goal reached"
                : `${duration(goals.week - weekMin)} to go this week`
              : lastWeekMin
                ? `${weekMin >= lastWeekMin ? "▲" : "▼"} ${duration(Math.abs(weekMin - lastWeekMin))} vs this time last week`
                : "the first week Ferry counted"}</small
          >
        </div>
        {#if goals.week}{@render ring(
            weekMin / goals.week,
            `${Math.round((weekMin / goals.week) * 100)}% of this week's goal`,
          )}{/if}
      </div>
      <div class="card stat">
        <span class="k">Billable this week</span><b>{duration(weekBill)}</b>
        <small>{weekMin ? `${Math.round((weekBill / weekMin) * 100)}% of it` : "mark a project billable below"}</small>
      </div>
      <div class="card stat">
        <span class="k">Streak</span><b>{streak} {streak === 1 ? "day" : "days"}</b>
        <small>{streak > 1 ? "weekends off don't count against it" : "work today to keep it going"}</small>
      </div>
    </section>

    <div class="grid">
      <div class="col">
        <ProjectBars days={chart.days} projects={chart.projects} {now} />
        <Tracker />
        <CalendarCard />
      </div>
      <div class="col">
        <TimerCard />
        <Donut projects={chart.projects} label="the last {range} days" />
        <StandupCard />
      </div>
    </div>
    <Timesheet />
    <Invoice />
  {/if}
</div>

<style lang="scss">
  @use "tokens" as *;
  @use "mixins" as *;

  // the categorical palette, in its validated order (checked against Ferry's cards, light and dark)
  .time {
    --series-1: #2a78d6;
    --series-2: #eb6834;
    --series-3: #1baf7a;
    --series-4: #eda100;
    --series-5: #e87ba4;
    --series-6: #008300;
    --series-7: #6250d6;
    --series-8: #e34948;
    --series-other: #a6aab3;
    display: flex;
    flex-direction: column;
    gap: space(4);
    min-width: 0;
  }
  :global([data-theme="dark"]) .time {
    --series-1: #3987e5;
    --series-2: #d95926;
    --series-3: #199e70;
    --series-4: #c98500;
    --series-5: #d55181;
    --series-6: #0ca30c;
    --series-7: #9085e9;
    --series-8: #e66767;
    --series-other: #6b7385;
  }
  .top {
    display: flex;
    align-items: flex-end;
    justify-content: flex-start;
    gap: space(3);
    flex-wrap: wrap;
    h1 {
      font-size: fs(xl);
    }
    p {
      margin: 2px 0 0;
      font-size: 13px;
    }
  }
  .pad {
    padding: space(4) space(5);
  }
  .stats {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: space(3);
  }
  .stat {
    padding: space(3) + 2 space(4);
    display: flex;
    flex-direction: column;
    gap: 2px;
    .k {
      font-size: 12px;
      color: var(--muted);
      font-weight: $weight-semibold;
    }
    b {
      font-size: 22px;
      font-weight: $weight-bold;
      font-variant-numeric: tabular-nums;
      letter-spacing: -0.01em;
    }
    small {
      font-size: 12px;
      color: var(--faint);
    }
    .txt {
      display: flex;
      flex-direction: column;
      gap: 2px;
      flex: 1;
      min-width: 0;
    }
    &.has-goal {
      flex-direction: row;
      align-items: center;
      gap: space(3);
    }
  }
  // a goal's progress ring
  .goal {
    flex: none;
    text {
      font-size: 11px;
      font-weight: $weight-bold;
      fill: var(--text);
    }
  }
  .g-track {
    fill: none;
    stroke: var(--card2);
    stroke-width: 5;
  }
  .g-fill {
    fill: none;
    stroke: var(--accent);
    stroke-width: 5;
    stroke-linecap: round;
    @include motion {
      transition: stroke-dasharray $duration-slow $ease-out;
    }
  }
  .goal.done .g-fill {
    stroke: var(--green);
  }
  .grow {
    flex: 1;
  }
  .grid {
    display: grid;
    grid-template-columns: minmax(0, 1.75fr) minmax(300px, 1fr);
    gap: space(4);
    // both columns end on the same line: the last card in each grows to fill what's left
    align-items: stretch;
  }
  .col {
    display: flex;
    flex-direction: column;
    gap: space(4);
    min-width: 0;
    > :global(:last-child) {
      flex: 1;
    }
  }
  // Last week and Goals, as pill buttons that sit with the day picker
  .tools {
    display: inline-flex;
    gap: space(1) + 2;
  }
  .tool {
    display: inline-flex;
    align-items: center;
    gap: space(1) + 2;
    height: 38px;
    padding: 0 space(3) + 2 0 space(3);
    border-radius: $radius-pill;
    border: 1px solid var(--line);
    background: var(--card-solid);
    color: var(--text);
    font: inherit;
    font-size: 13px;
    font-weight: $weight-semibold;
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(9, 35, 72, 0.05);
    :global(svg) {
      color: var(--accent);
    }
    @include motion {
      transition:
        transform 0.15s,
        box-shadow 0.15s,
        background 0.15s;
    }
    &:hover {
      transform: translateY(-1px);
      box-shadow: 0 6px 16px rgba(9, 35, 72, 0.1);
    }
    &:focus-visible {
      outline: none;
      box-shadow: 0 0 0 3px var(--accent-soft);
      border-color: var(--accent);
    }
    &.on {
      background: var(--accent-soft);
      border-color: color-mix(in srgb, var(--accent) 40%, transparent);
    }
    &.set :global(svg) {
      color: var(--green);
    }
  }
  @include below(laptop) {
    .tool span {
      display: none;
    }
    .tool {
      padding: 0 space(2) + 2;
    }
  }
  @include below(laptop) {
    .grid {
      grid-template-columns: minmax(0, 1fr);
    }
    .stats {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
</style>
