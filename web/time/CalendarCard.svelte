<script lang="ts">
  import Icon from "../components/Icon.svelte";
  import { ask } from "../lib/app.svelte.ts";
  import { work } from "../lib/work.svelte.ts";
  import { dayOf, duration } from "../../src/shared/work.ts";
  import { today } from "../lib/todo.ts";

  /**
   * Meetings next to your work: paste a calendar's ICS address and its meetings show on the day's
   * ribbon and in the list, ready to log as time. Ferry only reads that address; it's kept in the
   * data folder and never shown again in full (it can hold a private token).
   */
  const set = $derived(!!work.timer?.calendar);
  let url = $state("");
  let editing = $state(false);
  const todays = $derived(work.meetings.filter((m) => dayOf(m.start) === today()));
  const next = $derived(work.meetings.find((m) => m.start > work.now));

  async function save() {
    if (await work.act("calendar", { url: url.trim() })) {
      url = "";
      editing = false;
    }
  }
  async function remove() {
    const ok = await ask({
      mood: "thinking",
      title: "Stop showing your calendar?",
      text: "Meetings you already logged stay as entries.",
      yes: "Stop showing it",
      no: "Keep it",
    });
    if (ok) await work.act("calendar", { url: "" });
  }
  const hm = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
</script>

<section class="card cal" aria-label="Calendar">
  <div class="head">
    <h2><Icon name="calendar" size={17} />Meetings</h2>
    {#if set && !editing}
      <button type="button" class="btn small ghost" onclick={() => (editing = true)}>Change</button>
      <button type="button" class="btn small ghost danger" onclick={remove}>Remove</button>
    {/if}
  </div>
  {#if set && !editing}
    {#if work.data?.calendarError}
      <p class="muted">Couldn't read it: {work.data.calendarError}</p>
    {:else}
      <p class="muted">
        From {work.timer?.calendar}. Today: {todays.length
          ? `${todays.length} ${todays.length === 1 ? "meeting" : "meetings"}, ${duration(todays.reduce((n, m) => n + (m.end - m.start) / 60_000, 0))}`
          : "no meetings"}.
      </p>
      {#if next}<p class="next">Next: <b>{next.title}</b> at {hm(next.start)}</p>{/if}
    {/if}
  {:else}
    <p class="muted">
      Paste your calendar's ICS address: in Google Calendar, Settings → your calendar → “Secret address in iCal format”;
      in Outlook, Settings → Calendar → Shared calendars → Publish. Meetings then show next to your work, to log as
      time.
    </p>
    <form
      class="row"
      onsubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <input
        type="text"
        inputmode="url"
        placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
        aria-label="ICS address"
        bind:value={url}
      />
      <button type="submit" class="btn small brand" disabled={work.busy || !url.trim()}>Show meetings</button>
      {#if editing}<button type="button" class="btn small ghost" onclick={() => (editing = false)}>Cancel</button>{/if}
    </form>
  {/if}
</section>

<style lang="scss">
  @use "tokens" as *;
  @use "mixins" as *;

  .cal {
    padding: space(4);
    p {
      font-size: 12.5px;
      margin: 0 0 space(2);
    }
  }
  .head {
    display: flex;
    align-items: center;
    gap: space(1);
    margin-bottom: space(2);
    h2 {
      font-size: fs(lg);
      flex: 1;
      display: flex;
      align-items: center;
      gap: space(2);
    }
  }
  .next {
    font-size: 13px;
  }
  .row {
    display: flex;
    gap: space(2);
    input {
      flex: 1;
      min-width: 0;
      font-size: 12.5px;
    }
  }
</style>
