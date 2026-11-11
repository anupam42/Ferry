<script lang="ts">
  import Drawer from "../components/Drawer.svelte";
  import { face } from "../lib/api.ts";
  import { ago, plural } from "../lib/format.ts";
  import { notes } from "../lib/notes.svelte.ts";
  import { CAT, noteList, type Filter } from "../lib/notes.ts";
  import { sync } from "../lib/sync.svelte.ts";

  /** What Ferry did, and anything that needs you: needs-you first, then newest first, by day. */
  const seenBefore = notes.lastRead; // what was new when the drawer opened stays marked as new while it's open
  const list = $derived(noteList(notes.list, notes.filter, notes.prefs.routine));
  const fresh = (iso: string | undefined) => Date.parse(iso ?? "") > seenBefore;
  const needsNow = $derived(list.all.filter((x) => x.d.cat === "needs" && fresh(x.ev.time)).length);
  const errorsNow = $derived(list.all.filter((x) => x.d.cat === "errors" && fresh(x.ev.time)).length);
  const open = $derived(sync.pairs.reduce((n, p) => n + p.conflicts.length, 0));
  const mood = $derived(open || needsNow ? "worried" : errorsNow ? "sad" : list.all.length ? "happy" : "sleepy");
  const say = $derived(
    open
      ? `${plural(open, "conflict")} still ${open === 1 ? "needs" : "need"} your decision.`
      : needsNow
        ? `${plural(needsNow, "thing")} ${needsNow === 1 ? "needs" : "need"} you.`
        : errorsNow
          ? `${plural(errorsNow, "problem")} since you last looked.`
          : list.all.length
            ? "You're all caught up!"
            : "It's quiet here.",
  );
  const hint = $derived(
    open || needsNow
      ? "They're at the top of the list."
      : list.all.length
        ? "Everything below is just so you know."
        : "Notifications appear here as Ferry syncs, commits and pushes.",
  );
  const FILTERS: Filter[] = ["all", "needs", "errors", "commits", "sync"];
  /** Today: "5 min ago"; earlier days sit under their own heading, so just the time. */
  const when = (iso: string) =>
    new Date(iso).toDateString() === new Date().toDateString()
      ? ago(iso)
      : new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
</script>

<Drawer title="Notifications" sub="What Ferry did, and anything that needs you" onclose={() => notes.close()}>
  <div class="narrator">
    <img src={face(mood)} alt="" />
    <div class="bubble" role="status">
      <div class="say">{say}</div>
      <div class="hint">{hint}</div>
    </div>
  </div>
  <div class="filters" role="radiogroup" aria-label="Show">
    {#each FILTERS as f (f)}
      <button
        role="radio"
        class:on={notes.filter === f}
        aria-checked={notes.filter === f}
        onclick={() => (notes.filter = f)}
      >
        {f === "all" ? "All" : CAT[f]}{#if list.counts[f]}<span class="n">{list.counts[f]}</span>{/if}
      </button>
    {/each}
  </div>
  <div role="list">
    {#each list.rows as r, i (i)}
      {#if i === 0 || list.rows[i - 1]!.group !== r.group}<div class="group" role="presentation">{r.group}</div>{/if}
      <div class="note" class:unread={fresh(r.ev.time)} role="listitem">
        <img src={face(r.d.mood)} alt="" />
        <div class="main">
          <div class="t">{r.d.title}</div>
          {#if r.d.detail}<div class="d">{r.d.detail}</div>{/if}
          <div class="meta">
            {#if r.ev.pair}<span class="pill">{r.ev.pair}</span>{/if}<span
              title={new Date(r.ev.time ?? "").toLocaleString()}>{when(r.ev.time ?? "")}</span
            ><span>· {CAT[r.d.cat]}</span>
          </div>
        </div>
        {#if r.d.action}{@const a = r.d.action}<button
            class="btn small"
            class:brand={r.d.cat === "needs"}
            onclick={() => notes.run(a)}>{a.label}</button
          >{/if}
      </div>
    {:else}
      <div class="empty-row center">
        {notes.filter === "all" && list.counts.sync && !notes.prefs.routine
          ? `Nothing important. ${plural(list.counts.sync, "routine sync")} hidden: see “Syncs”.`
          : "Nothing here."}
      </div>
    {/each}
  </div>
  {#snippet foot()}
    <div class="prefs left">
      <label class="check"
        ><input
          type="checkbox"
          checked={notes.prefs.desktop}
          onchange={async (e) => {
            const el = e.currentTarget;
            if (!(await notes.setDesktop(el.checked))) el.checked = false;
          }}
        />
        <span
          >Pop up on my desktop when something needs me<small class="hint"
            >Only while this tab is in the background.</small
          ></span
        ></label
      >
      <label class="check"
        ><input
          type="checkbox"
          checked={notes.prefs.routine}
          onchange={(e) => notes.setPrefs({ routine: e.currentTarget.checked })}
        /><span>Include routine syncs under “All”</span></label
      >
    </div>
    <button class="btn small" onclick={() => notes.markAllRead()}>Mark all as read</button>
  {/snippet}
</Drawer>

<style lang="scss">
  @use "tokens" as *;
  .filters {
    display: flex;
    gap: space(2);
    flex-wrap: wrap;
    margin-bottom: space(1) + 2;
    button {
      border: 0;
      border-radius: $radius-pill;
      padding: space(1) + 2 space(3) + 2;
      background: var(--card2);
      color: var(--text);
      cursor: pointer;
      font-weight: $weight-semibold;
      display: inline-flex;
      gap: space(1) + 2;
      align-items: center;
      &.on {
        background: var(--text);
        color: var(--card-solid);
      }
    }
    .n {
      font-size: 11px;
      min-width: 18px;
      height: 18px;
      padding: 0 5px;
      border-radius: $radius-pill;
      background: var(--card-solid);
      color: var(--text);
      display: inline-grid;
      place-items: center;
    }
  }
  .group {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
    margin: space(4) space(1) space(1) + 2;
    font-weight: $weight-bold;
  }
  .note {
    display: grid;
    grid-template-columns: 50px minmax(0, 1fr) auto;
    gap: space(3);
    align-items: center;
    padding: space(2) + 2 space(3);
    border-radius: $radius-lg;
    position: relative;
    &:hover {
      background: var(--accent-soft);
    }
    &.unread {
      background: var(--card2);
      .t {
        font-weight: 750;
      }
      &::before {
        content: "";
        position: absolute;
        left: -2px;
        top: 50%;
        margin-top: -4px;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--accent);
      }
    }
    img {
      width: 50px;
      height: 37px;
    }
  }
  .t {
    font-weight: 550;
    overflow-wrap: anywhere;
  }
  .d {
    font-size: 12.5px;
    color: var(--muted);
    overflow-wrap: anywhere;
    margin-top: 1px;
  }
  .meta {
    display: flex;
    gap: space(1) + 2;
    align-items: center;
    flex-wrap: wrap;
    margin-top: space(1);
    font-size: 12px;
    color: var(--faint);
  }
  .center {
    text-align: center;
  }
  .prefs {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 13px;
  }
  .check {
    display: flex;
    gap: space(2);
    align-items: flex-start;
    cursor: pointer;
    margin: 2px 0;
    input {
      margin-top: 3px;
      accent-color: var(--accent);
    }
    small {
      display: block;
      color: var(--muted);
      font-size: 12px;
    }
  }
</style>
