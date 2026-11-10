<script lang="ts">
  import { plural } from "../../lib/format.ts";
  import { splitPath } from "../../lib/insights.ts";
  import type { InsightsResponse } from "../../lib/types.ts";

  /** Pairs of files that keep landing in the same commits. */
  let { together }: { together: InsightsResponse["together"] } = $props();
</script>

{#if !together.length}
  <div class="empty-row">No two files have changed together often enough yet (3 commits or more).</div>
{:else}
  <div class="wrap">
    <p class="muted">When one of these changes, the other usually does too. That's fine for a component and its test; if it surprises you, they may depend on each other more than they should.</p>
    <div class="list">
      {#each together as t (t.a + "|" + t.b)}
        {@const a = splitPath(t.a)}
        {@const b = splitPath(t.b)}
        {@const pct = Math.round(t.share * 100)}
        <div class="row">
          <span class="files" title="{t.a}\n{t.b}"><b>{a.name}</b><span class="link" aria-label="and">⇄</span><b>{b.name}</b>
            <small>{a.dir === b.dir ? a.dir || "top folder" : `${a.dir || "./"} · ${b.dir || "./"}`}</small></span>
          <span class="share" role="img" aria-label="{pct}% of the time"><i style:width="{pct}%"></i></span>
          <span class="n"><b>{plural(t.count, "commit")}</b><small>{pct}% of the time</small></span>
        </div>
      {/each}
    </div>
  </div>
{/if}

<style lang="scss">
  @use "tokens" as *;
  @use "mixins" as *;
  .wrap { padding: space(1) + 2 space(4) space(3) + 2; p { margin: 0 0 space(2) + 2; font-size: 13px; } }
  .list { display: flex; flex-direction: column; gap: space(1) + 2; }
  .row { display: grid; grid-template-columns: minmax(0, 1fr) 160px 110px; gap: space(3) + 2; align-items: center; padding: space(2) space(3); border-radius: $radius-md; background: var(--card2); }
  .files { min-width: 0; display: flex; flex-wrap: wrap; align-items: baseline; gap: 0 space(2); font-size: 13.5px;
    small { flex-basis: 100%; color: var(--muted); font-size: 11.5px; @include ellipsis; } .link { color: var(--muted); } }
  .share { height: 8px; border-radius: 99px; background: var(--heat-0); overflow: hidden; i { display: block; height: 100%; border-radius: 99px; background: var(--chart-bar); } }
  .n { text-align: right; font-size: 13px; b { display: block; } small { color: var(--muted); font-size: 11.5px; } }
  @include below(tablet) { .row { grid-template-columns: minmax(0, 1fr) 90px; .share { display: none; } } }
</style>
