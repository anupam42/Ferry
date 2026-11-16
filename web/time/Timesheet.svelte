<script lang="ts">
  import Icon from "../components/Icon.svelte";
  import Section from "../components/Section.svelte";
  import { today } from "../lib/todo.ts";
  import { work } from "../lib/work.svelte.ts";
  import { dayOf, duration, timesheet, timesheetCsv, weekStart } from "../../src/shared/work.ts";

  /** A week as a timesheet: a row per thing worked on, hours per day, billable hours, and a CSV. */
  const now = $derived(today());
  let monday = $state(weekStart(today()));
  const sheet = $derived(timesheet(work.days, monday));
  const weekTotal = $derived(sheet.totals.reduce((a, b) => a + b, 0));
  const billTotal = $derived(sheet.rows.reduce((n, r) => n + r.billable, 0));
  const thisWeek = $derived(weekStart(now));
  function moveWeek(n: number) {
    // from noon, so a daylight-saving change can't move it to another day
    const next = weekStart(dayOf(Date.parse(monday + "T12:00:00") + n * 7 * 86_400_000));
    if (next > thisWeek) return;
    monday = next;
    // reach back far enough for the week on screen
    const back = Math.ceil((Date.now() - Date.parse(next + "T00:00:00")) / 86_400_000) + 1;
    if (back > work.span) void work.load(Math.min(back, 120));
  }
  const tooOld = $derived(Math.ceil((Date.now() - Date.parse(monday + "T00:00:00")) / 86_400_000) > 120);
  const short = (d: string) =>
    new Date(d + "T12:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const weekLabel = $derived(monday === thisWeek ? "This week" : `${short(monday)} – ${short(sheet.days[6]!)}`);
  const cellText = (m: number) => (m ? (m / 60).toFixed(m < 60 ? 2 : 1).replace(/\.?0+$/, "") : "");
  function download() {
    const blob = new Blob([timesheetCsv(sheet)], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `timesheet-${monday}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
</script>

<Section id="time-sheet" title="Timesheet" count={null}>
  {#snippet extra()}
    <div class="week">
      <button type="button" class="btn small ghost" aria-label="The week before" onclick={() => moveWeek(-1)}>‹</button>
      <span class="wk">{weekLabel}</span>
      <button
        type="button"
        class="btn small ghost"
        aria-label="The week after"
        disabled={monday >= thisWeek}
        onclick={() => moveWeek(1)}>›</button
      >
      <button type="button" class="btn small ghost" disabled={!sheet.rows.length} onclick={download}
        ><Icon name="down" size={14} />CSV</button
      >
    </div>
  {/snippet}
  {#if tooOld}
    <p class="pad muted">Ferry keeps 120 days of work; this week is older than that.</p>
  {:else if !sheet.rows.length}
    <p class="pad muted">{work.loading ? "Reading…" : "No work recorded this week."}</p>
  {:else}
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th scope="col">Hours</th>
            {#each sheet.days as d (d)}
              <th scope="col" class:today={d === now}
                >{new Date(d + "T12:00:00").toLocaleDateString(undefined, { weekday: "short" })}<small
                  >{+d.slice(8)}</small
                ></th
              >
            {/each}
            <th scope="col">Total</th>
            <th scope="col">Billable</th>
          </tr>
        </thead>
        <tbody>
          {#each sheet.rows as r (r.name)}
            <tr>
              <th scope="row">{r.name}</th>
              {#each r.minutes as m, i (i)}<td class:today={sheet.days[i] === now} title={m ? duration(m) : ""}
                  >{cellText(m)}</td
                >{/each}
              <td class="total">{cellText(r.total)}</td>
              <td class="bill">{cellText(r.billable)}</td>
            </tr>
          {/each}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Total</th>
            {#each sheet.totals as m, i (i)}<td class:today={sheet.days[i] === now}>{cellText(m)}</td>{/each}
            <td class="total">{cellText(weekTotal)}</td>
            <td class="bill">{cellText(billTotal)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
    <p class="note muted">In hours. The CSV has two decimals, for pasting into a timesheet tool.</p>
  {/if}
</Section>

<style lang="scss">
  @use "tokens" as *;
  @use "mixins" as *;

  .pad {
    padding: space(4) space(5);
  }
  .week {
    display: inline-flex;
    align-items: center;
    gap: space(1);
    .wk {
      font-size: 12.5px;
      min-width: 108px;
      text-align: center;
    }
    :global(svg) {
      margin-right: 4px;
    }
  }
  .table-wrap {
    overflow-x: auto;
    padding: 0 space(3) space(1);
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
    th,
    td {
      padding: space(2) space(2) + 2;
      border-top: 1px solid var(--line);
      text-align: right;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    th[scope="row"],
    thead th:first-child {
      text-align: left;
      font-weight: $weight-semibold;
      white-space: normal;
      min-width: 160px;
    }
    thead th {
      border-top: 0;
      color: var(--muted);
      font-weight: $weight-semibold;
      font-size: 12px;
      small {
        display: block;
        font-weight: 400;
      }
    }
    .today {
      background: var(--accent-soft);
    }
    .total,
    tfoot td,
    tfoot th {
      font-weight: $weight-bold;
    }
    .bill {
      color: var(--green);
    }
  }
  .note {
    padding: space(2) space(4) space(3);
    font-size: 12px;
    margin: 0;
  }
</style>
