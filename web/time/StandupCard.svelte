<script lang="ts">
  import Icon from "../components/Icon.svelte";
  import { toast } from "../lib/app.svelte.ts";
  import { colorOf } from "../lib/timecolors.ts";
  import { today } from "../lib/todo.ts";
  import { work } from "../lib/work.svelte.ts";
  import { duration, lineName, standupText, type WorkDay } from "../../src/shared/work.ts";

  /** The standup: the last day you worked and today so far, ready to paste into a chat. */
  const now = $derived(today());
  const todayWork = $derived(work.days.find((d) => d.day === now));
  const lastWork = $derived(work.days.find((d) => d.day < now));
  const text = $derived(standupText(work.days, now));

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      toast("Standup copied", { mood: "wink" });
    } catch {
      toast("Couldn't copy: open “As text” and copy it yourself", { error: true });
    }
  }
  const dayTitle = (day: string) =>
    new Date(day + "T12:00:00").toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });
</script>

{#snippet day(d: WorkDay, title: string)}
  <div class="day">
    <div class="dh"><span>{title}</span><b>{duration(d.minutes)}</b></div>
    <ul>
      {#each d.lines.slice(0, 4) as l (l.repo + l.branch + l.task)}
        <li>
          <span class="sw" style:background={colorOf(l.repo)}></span>
          <span class="n">{lineName(l)}</span>
          <span class="v">{duration(l.minutes)}</span>
        </li>
      {/each}
      {#if d.lines.length > 4}<li class="more">and {d.lines.length - 4} more</li>{/if}
    </ul>
  </div>
{/snippet}

<section class="card standup" aria-label="Standup">
  <div class="head">
    <h2>Standup</h2>
    <button type="button" class="btn small brand" disabled={!lastWork && !todayWork} onclick={copy}
      ><Icon name="copy" size={14} />Copy</button
    >
  </div>
  {#if !lastWork && !todayWork}
    <p class="muted empty">Nothing to report yet.</p>
  {:else}
    {#if lastWork}{@render day(lastWork, `Last time · ${dayTitle(lastWork.day)}`)}{/if}
    {#if todayWork}{@render day(todayWork, "Today so far")}{/if}
    <details>
      <summary>As text</summary>
      <pre>{text}</pre>
    </details>
  {/if}
</section>

<style lang="scss">
  @use "tokens" as *;
  @use "mixins" as *;

  .standup {
    padding: space(4);
  }
  .head {
    display: flex;
    align-items: center;
    margin-bottom: space(2);
    h2 {
      font-size: fs(lg);
      flex: 1;
    }
    .btn :global(svg) {
      margin-right: 4px;
    }
  }
  .empty {
    margin: 0;
    font-size: 13px;
  }
  .day + .day {
    margin-top: space(3);
  }
  .dh {
    display: flex;
    font-size: 12px;
    color: var(--muted);
    margin-bottom: 4px;
    span {
      flex: 1;
    }
    b {
      color: var(--text);
      font-variant-numeric: tabular-nums;
    }
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    display: flex;
    align-items: center;
    gap: space(2);
    font-size: 13px;
    padding: 3px 0;
    &.more {
      color: var(--faint);
      font-size: 12px;
    }
  }
  .sw {
    width: 8px;
    height: 8px;
    border-radius: 2px;
    flex: none;
  }
  .n {
    flex: 1;
    min-width: 0;
    @include ellipsis;
  }
  .v {
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  details {
    margin-top: space(3);
    summary {
      cursor: pointer;
      font-size: 12.5px;
      color: var(--muted);
    }
    pre {
      margin: space(2) 0 0;
      padding: space(3);
      border-radius: $radius-md;
      background: var(--card2);
      font-family: $font-mono;
      font-size: 12px;
      white-space: pre-wrap;
      user-select: all;
    }
  }
</style>
