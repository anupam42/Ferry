<script lang="ts">
  import Icon from "../components/Icon.svelte";
  import Section from "../components/Section.svelte";
  import { toast } from "../lib/app.svelte.ts";
  import { colorOf } from "../lib/timecolors.ts";
  import { today } from "../lib/todo.ts";
  import { work } from "../lib/work.svelte.ts";
  import { dayOf, duration, invoice, invoiceCsv } from "../../src/shared/work.ts";

  /**
   * Rates and invoices: an hourly rate, currency and client per project (a project with a rate is
   * billable), then an invoice for a client and a month: billable hours per project, priced, with a
   * CSV and a page to print or save as PDF.
   */
  const rates = $derived(work.timer?.rates ?? {});
  const clients = $derived(
    [
      ...new Set(
        Object.values(rates)
          .map((r) => r.client)
          .filter(Boolean),
      ),
    ].sort(),
  );
  let client = $state(localStorage.getItem("ferry-invoice-client") || "");

  type Period = "this" | "last";
  let period = $state<Period>("this");
  const span = $derived.by(() => {
    const d = new Date(today() + "T12:00:00");
    const first = new Date(d.getFullYear(), d.getMonth() - (period === "last" ? 1 : 0), 1, 12);
    const last = new Date(first.getFullYear(), first.getMonth() + 1, 0, 12);
    return {
      from: dayOf(first.getTime()),
      to: dayOf(last.getTime()),
      label: first.toLocaleDateString(undefined, { month: "long", year: "numeric" }),
    };
  });
  // a month back and this one: up to 62 days of data
  $effect(() => {
    void work.load(64);
  });
  const inv = $derived(invoice(work.days, rates, { from: span.from, to: span.to, client }));
  // more than one currency: each total says which
  const many = $derived(Object.keys(inv.totals).length > 1);
  const money = (v: number, c: string) => {
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency: c }).format(v);
    } catch {
      return `${c} ${v.toFixed(2)}`;
    }
  };
  const hours = (m: number) => (Math.round((m / 60) * 4) / 4).toFixed(2);

  // the currencies offered; the default follows the browser's region, then whichever was used last
  const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AUD", "CAD", "SGD", "AED", "JPY", "CHF", "NZD", "ZAR"];
  const REGION: Record<string, string> = {
    IN: "INR",
    GB: "GBP",
    AU: "AUD",
    CA: "CAD",
    SG: "SGD",
    AE: "AED",
    JP: "JPY",
    CH: "CHF",
    NZ: "NZD",
    ZA: "ZAR",
    DE: "EUR",
    FR: "EUR",
    ES: "EUR",
    IT: "EUR",
    NL: "EUR",
    IE: "EUR",
  };
  const region = (navigator.language.split("-")[1] ?? "").toUpperCase();
  const defaultCurrency = localStorage.getItem("ferry-currency") || REGION[region] || "USD";
  // a project's currency and client before it has a rate: kept here, and saved with the rate
  let drafts = $state<Record<string, { currency: string; client: string }>>({});
  const shown = (p: string) => ({
    currency: rates[p]?.currency ?? drafts[p]?.currency ?? defaultCurrency,
    client: rates[p]?.client ?? drafts[p]?.client ?? "",
  });
  const symbol = (c: string) => {
    try {
      return (
        new Intl.NumberFormat(undefined, { style: "currency", currency: c, currencyDisplay: "narrowSymbol" })
          .formatToParts(0)
          .find((x) => x.type === "currency")?.value ?? c
      );
    } catch {
      return c;
    }
  };

  async function setRate(project: string, patch: { rate?: number; currency?: string; client?: string }) {
    const cur = rates[project];
    const now = shown(project);
    const next = { currency: patch.currency ?? now.currency, client: patch.client ?? now.client };
    if (patch.currency) localStorage.setItem("ferry-currency", patch.currency);
    const rate = patch.rate ?? cur?.rate ?? 0;
    // no rate yet: just remember the choices for when one is typed
    if (!rate && !cur) {
      drafts[project] = next;
      return;
    }
    if (await work.act("rate", { project, rate, ...next })) delete drafts[project];
  }

  function csv() {
    const blob = new Blob([invoiceCsv(inv)], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `invoice-${client || "all"}-${span.from.slice(0, 7)}.csv`.replace(/[^\w.-]+/g, "-");
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  const esc = (s: string) =>
    s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  /** A clean page with the invoice, for the browser's print (or "save as PDF"). */
  function print() {
    const w = window.open("", "_blank");
    if (!w) {
      toast("Your browser blocked the new window. Allow pop-ups for Ferry to print.", { error: true });
      return;
    }
    const rows = inv.rows
      .map(
        (r) =>
          `<tr><td>${esc(r.project)}</td><td>${hours(r.minutes)}</td><td>${money(r.rate, r.currency)}</td><td>${money(r.amount, r.currency)}</td></tr>`,
      )
      .join("");
    const totals = Object.entries(inv.totals)
      .map(([c, v]) => `<tr class="t"><td colspan="3">Total${many ? ` (${c})` : ""}</td><td>${money(v, c)}</td></tr>`)
      .join("");
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Invoice ${esc(span.label)}</title>
<style>body{font:14px/1.5 system-ui,sans-serif;color:#111;margin:48px;max-width:760px}h1{font-size:28px;margin:0 0 4px}
.m{color:#666;margin-bottom:32px}table{width:100%;border-collapse:collapse}th,td{padding:10px 8px;border-bottom:1px solid #ddd;text-align:right}
th:first-child,td:first-child{text-align:left}th{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#666}
.t td{font-weight:700;border-bottom:0;border-top:2px solid #111}.n{margin-top:32px;color:#666;font-size:12px}</style></head>
<body><h1>Invoice</h1><div class="m">${esc(client || "All clients")} · ${esc(span.label)} (${span.from} to ${span.to})</div>
<table><thead><tr><th>Project</th><th>Hours</th><th>Rate</th><th>Amount</th></tr></thead><tbody>${rows}${totals}</tbody></table>
<div class="n">Billable time, rounded to the quarter hour.</div></body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 250);
  }
</script>

<Section id="time-invoice" title="Rates & invoices" count={null}>
  <div class="wrap">
    <div class="rates">
      <h3>Rates</h3>
      <p class="muted hint">A project with a rate counts as billable. Leave it empty for one you don't charge for.</p>
      <table>
        <thead><tr><th>Project</th><th>Rate per hour</th><th>Client</th></tr></thead>
        <tbody>
          {#each work.projects as p (p)}
            {@const r = rates[p]}
            {@const s = shown(p)}
            <tr class:priced={!!r}>
              <th scope="row"><span class="sw" style:background={colorOf(p)}></span>{p}</th>
              <td>
                <div class="money">
                  <span class="sym" aria-hidden="true">{symbol(s.currency)}</span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    inputmode="decimal"
                    placeholder="none"
                    aria-label="Rate per hour for {p}"
                    value={r?.rate ?? ""}
                    onchange={(e) => setRate(p, { rate: +e.currentTarget.value || 0 })}
                  />
                  <select
                    aria-label="Currency for {p}"
                    value={s.currency}
                    onchange={(e) => setRate(p, { currency: e.currentTarget.value })}
                  >
                    {#each CURRENCIES.includes(s.currency) ? CURRENCIES : [s.currency, ...CURRENCIES] as c (c)}
                      <option value={c}>{c}</option>
                    {/each}
                  </select>
                </div>
              </td>
              <td>
                <input
                  type="text"
                  list="time-clients"
                  placeholder="Client (optional)"
                  aria-label="Client for {p}"
                  value={s.client}
                  onchange={(e) => setRate(p, { client: e.currentTarget.value })}
                />
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
      <datalist id="time-clients"
        >{#each clients as c (c)}<option value={c}></option>{/each}</datalist
      >
    </div>

    <div class="invoice">
      <div class="ihead">
        <h3>Invoice</h3>
        <select
          aria-label="Client"
          bind:value={client}
          onchange={() => localStorage.setItem("ferry-invoice-client", client)}
        >
          <option value="">All clients</option>
          {#each clients as c (c)}<option value={c}>{c}</option>{/each}
        </select>
        <select aria-label="Month" bind:value={period}>
          <option value="this">This month</option>
          <option value="last">Last month</option>
        </select>
      </div>
      {#if !Object.keys(rates).length}
        <p class="muted hint">Give a project a rate and its billable time shows up here, priced.</p>
      {:else if !inv.rows.length}
        <p class="muted hint">No billable time with a rate in {span.label}{client ? ` for ${client}` : ""}.</p>
      {:else}
        <table class="lines">
          <thead><tr><th>Project</th><th>Hours</th><th>Rate</th><th>Amount</th></tr></thead>
          <tbody>
            {#each inv.rows as r (r.project)}
              <tr>
                <th scope="row">{r.project}</th>
                <td title={duration(r.minutes)}>{hours(r.minutes)}</td>
                <td>{money(r.rate, r.currency)}</td>
                <td>{money(r.amount, r.currency)}</td>
              </tr>
            {/each}
          </tbody>
          <tfoot>
            {#each Object.entries(inv.totals) as [c, v] (c)}
              <tr><th scope="row" colspan="3">Total{many ? ` (${c})` : ""}</th><td>{money(v, c)}</td></tr>
            {/each}
          </tfoot>
        </table>
        <div class="iacts">
          <button type="button" class="btn small ghost" onclick={csv}><Icon name="down" size={14} />CSV</button>
          <button type="button" class="btn small brand" onclick={print}>Print or save as PDF</button>
        </div>
      {/if}
    </div>
  </div>
</Section>

<style lang="scss">
  @use "tokens" as *;
  @use "mixins" as *;

  .wrap {
    display: grid;
    grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
    gap: space(5);
    padding: 0 space(4) space(4);
  }
  h3 {
    font-size: 14px;
    margin: 0;
  }
  .hint {
    font-size: 12.5px;
    margin: 4px 0 space(3);
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
    th,
    td {
      padding: space(1) + 2 space(2);
      border-top: 1px solid var(--line);
      text-align: left;
    }
    thead th {
      border-top: 0;
      font-size: 11.5px;
      color: var(--muted);
      font-weight: $weight-semibold;
    }
    th[scope="row"] {
      font-weight: $weight-semibold;
      white-space: nowrap;
    }
    input {
      width: 100%;
      padding: space(1) + 2 space(2) + 2;
      font-size: 13px;
    }
    td {
      vertical-align: middle;
    }
    tr:not(.priced) th[scope="row"] {
      color: var(--muted);
      font-weight: $weight-medium;
    }
  }
  // the rate: currency symbol, amount and currency in one field
  .money {
    display: flex;
    align-items: center;
    min-width: 190px;
    border: 1px solid var(--line);
    border-radius: $radius-md + 2;
    background: var(--card-solid);
    overflow: hidden;
    @include motion {
      transition:
        border-color 0.15s,
        box-shadow 0.15s;
    }
    &:focus-within {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px var(--accent-soft);
    }
    .sym {
      padding-left: space(2) + 2;
      color: var(--muted);
      font-size: 13px;
      min-width: 1.4em;
    }
    input,
    select {
      border: 0;
      border-radius: 0;
      background: transparent;
      box-shadow: none;
      outline: none;
    }
    input {
      flex: 1;
      min-width: 0;
      padding-left: space(1);
      font-variant-numeric: tabular-nums;
      // no spinner arrows: the field is for typing a rate
      appearance: textfield;
      -moz-appearance: textfield;
      &::-webkit-inner-spin-button,
      &::-webkit-outer-spin-button {
        -webkit-appearance: none;
        margin: 0;
      }
    }
    select {
      width: auto;
      flex: none;
      padding: space(1) + 2 space(2);
      border-left: 1px solid var(--line);
      font-size: 12.5px;
      font-weight: $weight-semibold;
      color: var(--muted);
      cursor: pointer;
    }
  }
  .sw {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 2px;
    margin-right: 6px;
  }
  .ihead {
    display: flex;
    align-items: center;
    gap: space(2);
    margin-bottom: space(2);
    h3 {
      flex: 1;
    }
    select {
      width: auto;
      padding: 4px space(2);
      font-size: 12.5px;
    }
  }
  .lines {
    td,
    thead th:not(:first-child) {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    tfoot td,
    tfoot th {
      font-weight: $weight-bold;
      border-top: 2px solid var(--text);
    }
  }
  .iacts {
    display: flex;
    justify-content: flex-end;
    gap: space(2);
    margin-top: space(3);
    :global(svg) {
      margin-right: 4px;
    }
  }
  @include below(laptop) {
    .wrap {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
