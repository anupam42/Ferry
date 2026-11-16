<script lang="ts">
  import Icon from "../components/Icon.svelte";
  import { ask } from "../lib/app.svelte.ts";
  import { colorOf } from "../lib/timecolors.ts";
  import { today } from "../lib/todo.ts";
  import { work } from "../lib/work.svelte.ts";
  import { blockTitle, clock, dayOf, duration, type Block } from "../../src/shared/work.ts";
  import { slide } from "svelte/transition";
  import { ms } from "../lib/look.svelte.ts";

  /**
   * One day's work, block by block, newest first: what Ferry counted from saves and commits, and
   * what timers counted. Mark a project billable, carry on with something (start a timer for it),
   * or remove a timer entry.
   */
  let day = $state(today());
  const isToday = $derived(day === today());
  const list = $derived(
    work.blocks
      .filter((b) => dayOf(b.start) === day)
      .slice()
      .reverse(),
  );
  const total = $derived(list.reduce((n, b) => n + b.minutes, 0));
  function move(n: number) {
    const next = dayOf(Date.parse(day + "T12:00:00") + n * 86_400_000);
    if (next > today()) return;
    day = next;
    const back = Math.ceil((Date.now() - Date.parse(next + "T00:00:00")) / 86_400_000) + 1;
    if (back > work.span) void work.load(Math.min(back, 120));
  }
  const title = $derived(
    isToday
      ? "Today"
      : new Date(day + "T12:00:00").toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" }),
  );

  // the day ribbon: 8 to 6 at least, stretched to fit early starts and late finishes
  const ribbon = $derived.by(() => {
    const dayStart = Date.parse(day + "T00:00:00");
    const hourOf = (t: number) => (t - dayStart) / 3_600_000;
    const from = Math.min(8, ...list.map((b) => Math.floor(hourOf(b.start))));
    const to = Math.max(18, ...list.map((b) => Math.ceil(hourOf(b.end))));
    const span = Math.max(1, to - from);
    const pos = (t: number) => ((hourOf(t) - from) / span) * 100;
    const nowAt = isToday ? pos(work.now) : null;
    return {
      hours: Array.from({ length: Math.floor(span / 2) + 1 }, (_, i) => from + i * 2).filter((h) => h <= to),
      at: (h: number) => ((h - from) / span) * 100,
      items: list.map((b) => ({ b, left: pos(b.start), width: Math.max(0.6, pos(b.end) - pos(b.start)) })),
      now: nowAt !== null && nowAt >= 0 && nowAt <= 100 ? nowAt : null,
    };
  });
  const hourLabel = (h: number) =>
    new Date(2000, 0, 1, h % 24).toLocaleTimeString(undefined, { hour: "numeric" }).replace(/:00/, "");

  const hm = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const initial = (s: string) => (s.match(/[a-z0-9]/i)?.[0] ?? "•").toUpperCase();

  function toggleBill(b: Block) {
    if (b.kind === "timer") void work.act("edit", { id: b.id, billable: !b.billable });
    // automatic time is billable by project
    else void work.act("billable", { project: b.repo, on: !b.billable });
  }
  function again(b: Block) {
    void work.act("start", { project: b.repo, task: b.task || (b.issue ? b.issue : ""), billable: b.billable });
  }
  async function remove(b: Block) {
    const ok = await ask({
      mood: "thinking",
      title: "Remove this timer entry?",
      text: `${duration(b.minutes)} on ${b.task || b.repo}. Ferry's own count from your saves stays as it is.`,
      yes: "Remove it",
      no: "Keep it",
    });
    if (ok) void work.act("delete", { id: b.id });
  }
</script>

<section class="card tracker" aria-label="Time tracker">
  <div class="head">
    <h2>{title}</h2>
    <span class="pill blue">{duration(total)}</span>
    <div class="grow"></div>
    <button type="button" class="nav" aria-label="The day before" onclick={() => move(-1)}>‹</button>
    <button type="button" class="nav" aria-label="The day after" disabled={isToday} onclick={() => move(1)}>›</button>
  </div>
  {#if !list.length}
    <p class="empty muted">
      {isToday
        ? "Nothing yet today. Save something in a folder pair, commit, or start the timer."
        : "No work this day."}
    </p>
  {:else}
    <div class="ribbon" role="img" aria-label="The day's work along the hours">
      <div class="track">
        {#each ribbon.items as r (r.b.kind + r.b.id + r.b.start)}
          <span
            class="seg"
            class:timer={r.b.kind === "timer"}
            style:left="{r.left}%"
            style:width="{r.width}%"
            style:--c={colorOf(r.b.repo)}
            title="{blockTitle(r.b)} · {r.b.repo} · {hm(r.b.start)}–{r.b.id === 'running' ? 'now' : hm(r.b.end)}"
          ></span>
        {/each}
        {#if ribbon.now !== null}<span class="now" style:left="{ribbon.now}%" title="Now"></span>{/if}
      </div>
      <div class="hours" aria-hidden="true">
        {#each ribbon.hours as h (h)}<span style:left="{ribbon.at(h)}%">{hourLabel(h)}</span>{/each}
      </div>
      <div class="key muted"><i class="sw auto"></i>from saves &amp; commits <i class="sw timer"></i>timer</div>
    </div>
    <ul>
      {#each list as b (b.kind + b.id + b.start)}
        {@const live = b.id === "running"}
        <li class:live transition:slide={{ duration: ms(200) }}>
          <span class="ic" style:--c={colorOf(b.repo)} aria-hidden="true">{initial(b.repo)}</span>
          <div class="what">
            <div class="t">{blockTitle(b)}</div>
            <div class="s">
              {b.repo}{#if b.kind === "auto" && b.branch && !b.task}<span class="mono"> · {b.branch}</span>{/if}
              <span class="kind" title={b.kind === "timer" ? "Counted by a timer" : "Counted from saves and commits"}
                >{b.kind === "timer" ? "timer" : "auto"}</span
              >
            </div>
          </div>
          <button
            type="button"
            class="bill"
            class:yes={b.billable}
            aria-pressed={b.billable}
            disabled={live || work.busy}
            title={b.kind === "timer"
              ? b.billable
                ? "Billable: click to make it not billable"
                : "Not billable: click to bill it"
              : b.billable
                ? `${b.repo} is billable: click to stop billing its automatic time`
                : `Bill ${b.repo}'s automatic time`}
            onclick={() => toggleBill(b)}>$ <span>{b.billable ? "Billable" : "Non-billable"}</span></button
          >
          <span class="when mono">{hm(b.start)} – {live ? "now" : hm(b.end)}</span>
          <span class="dur mono">{live ? clock(work.now - b.start) : duration(b.minutes)}</span>
          <div class="acts">
            {#if !live}
              <button
                type="button"
                class="ib"
                aria-label="Carry on with this: start a timer"
                title="Carry on with this"
                disabled={work.busy}
                onclick={() => again(b)}><Icon name="play" size={14} /></button
              >
            {/if}
            {#if b.kind === "timer" && !live}
              <button
                type="button"
                class="ib"
                aria-label="Remove this entry"
                title="Remove"
                disabled={work.busy}
                onclick={() => remove(b)}><Icon name="trash" size={14} /></button
              >
            {:else if live}
              <button
                type="button"
                class="ib stop"
                aria-label="Stop the timer"
                disabled={work.busy}
                onclick={() => work.act("stop")}><Icon name="stop" size={13} /></button
              >
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style lang="scss">
  @use "tokens" as *;
  @use "mixins" as *;

  .tracker {
    padding: space(4);
  }
  .head {
    display: flex;
    align-items: center;
    gap: space(2);
    margin-bottom: space(3);
    h2 {
      font-size: fs(lg);
    }
    .grow {
      flex: 1;
    }
  }
  .nav {
    width: 30px;
    height: 30px;
    border-radius: 50%;
    border: 1px solid var(--line);
    background: var(--card-solid);
    color: var(--text);
    cursor: pointer;
    &:disabled {
      opacity: 0.4;
      cursor: default;
    }
  }
  .empty {
    font-size: 13px;
    margin: 0;
  }
  // the day ribbon
  .ribbon {
    margin-bottom: space(4);
  }
  .track {
    position: relative;
    height: 22px;
    border-radius: $radius-pill;
    background: var(--card2);
    overflow: hidden;
  }
  .seg {
    position: absolute;
    top: 3px;
    bottom: 3px;
    border-radius: 6px;
    background: var(--c);
    box-shadow: 0 0 0 1px var(--card-solid);
    // a timer's time carries a texture as well as its colour
    &.timer {
      background:
        repeating-linear-gradient(135deg, color-mix(in srgb, #fff 38%, transparent) 0 3px, transparent 3px 7px),
        var(--c);
    }
  }
  .now {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    margin-left: -1px;
    background: var(--text);
    border-radius: 1px;
    @include motion {
      animation: pulse-now 2s ease-in-out infinite;
    }
  }
  @keyframes pulse-now {
    50% {
      opacity: 0.35;
    }
  }
  .hours {
    position: relative;
    height: 16px;
    margin-top: 3px;
    span {
      position: absolute;
      transform: translateX(-50%);
      font-size: 10.5px;
      white-space: nowrap;
      color: var(--faint);
      font-variant-numeric: tabular-nums;
      &:first-child {
        transform: none;
      }
      &:last-child {
        transform: translateX(-100%);
      }
    }
  }
  .key {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11.5px;
    margin-top: 2px;
    .sw {
      width: 14px;
      height: 8px;
      border-radius: 3px;
      background: var(--muted);
      &.timer {
        margin-left: space(2);
        background:
          repeating-linear-gradient(135deg, color-mix(in srgb, #fff 45%, transparent) 0 2px, transparent 2px 5px),
          var(--muted);
      }
    }
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: space(2);
  }
  li {
    display: grid;
    grid-template-columns: 36px minmax(0, 1fr) auto 128px 64px 64px;
    align-items: center;
    gap: space(3);
    padding: space(2) + 2 space(3);
    border-radius: $radius-lg;
    background: var(--card-solid);
    border: 1px solid var(--line);
    @include motion {
      transition:
        box-shadow 0.15s,
        transform 0.15s;
    }
    &:hover {
      box-shadow: 0 8px 22px rgba(9, 35, 72, 0.08);
      transform: translateY(-1px);
    }
    &.live {
      border-color: color-mix(in srgb, var(--green) 45%, var(--line));
      background: color-mix(in srgb, var(--green) 6%, var(--card-solid));
    }
  }
  .ic {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-weight: $weight-bold;
    font-size: 14px;
    color: var(--text);
    background: color-mix(in srgb, var(--c) 22%, var(--card-solid));
    box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--c) 55%, transparent);
  }
  .what {
    min-width: 0;
    .t {
      font-weight: $weight-semibold;
      font-size: 13.5px;
      @include ellipsis;
    }
    .s {
      font-size: 12px;
      color: var(--muted);
      @include ellipsis;
    }
  }
  .kind {
    margin-left: space(2);
    padding: 0 6px;
    border-radius: $radius-pill;
    background: var(--card2);
    font-size: 10.5px;
    color: var(--faint);
  }
  .bill {
    border: 0;
    background: none;
    padding: 4px 8px;
    border-radius: $radius-pill;
    font: inherit;
    font-size: 12px;
    color: var(--faint);
    cursor: pointer;
    white-space: nowrap;
    &.yes {
      color: var(--green);
      background: var(--green-soft);
    }
    &:hover:not(:disabled) {
      background: var(--card2);
    }
    &.yes:hover:not(:disabled) {
      background: var(--green-soft);
    }
  }
  .when {
    font-size: 12px;
    color: var(--muted);
    white-space: nowrap;
  }
  .dur {
    font-size: 13px;
    font-weight: $weight-semibold;
    text-align: right;
    white-space: nowrap;
  }
  .acts {
    display: flex;
    justify-content: flex-end;
    gap: 4px;
  }
  .ib {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: 0;
    display: grid;
    place-items: center;
    background: var(--text);
    color: var(--card-solid);
    cursor: pointer;
    &:disabled {
      opacity: 0.4;
      cursor: default;
    }
    &.stop {
      background: var(--red);
      color: #fff;
    }
  }
  .ib + .ib {
    background: var(--card2);
    color: var(--muted);
  }
  @include below(laptop) {
    li {
      grid-template-columns: 36px minmax(0, 1fr) auto auto auto;
      .when,
      .bill span {
        display: none;
      }
    }
  }
</style>
