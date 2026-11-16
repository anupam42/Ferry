<script lang="ts">
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
  const dateLine = $derived(
    new Date(now + "T12:00:00").toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" }),
  );
</script>

<svelte:document onvisibilitychange={refocus} />

<div class="time">
  <header class="top">
    <div>
      <h1>Time</h1>
      <p class="muted">{dateLine} · counted from your saves and commits, or a timer</p>
    </div>
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
    <section class="stats" aria-label="Totals">
      <div class="card stat">
        <span class="k">Today</span><b>{duration(dayMin(now))}</b>
        <small>{work.timer?.running ? "a timer is running" : "so far"}</small>
      </div>
      <div class="card stat">
        <span class="k">This week</span><b>{duration(weekMin)}</b>
        <small
          >{lastWeekMin
            ? `${weekMin >= lastWeekMin ? "▲" : "▼"} ${duration(Math.abs(weekMin - lastWeekMin))} vs this time last week`
            : "the first week Ferry counted"}</small
        >
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
      </div>
      <div class="col">
        <TimerCard />
        <Donut projects={chart.projects} label="the last {range} days" />
        <StandupCard />
      </div>
    </div>
    <Timesheet />
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
    justify-content: space-between;
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
  }
  .grid {
    display: grid;
    grid-template-columns: minmax(0, 1.75fr) minmax(300px, 1fr);
    gap: space(4);
    align-items: start;
  }
  .col {
    display: flex;
    flex-direction: column;
    gap: space(4);
    min-width: 0;
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
