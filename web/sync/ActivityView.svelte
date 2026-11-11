<script lang="ts">
  import Section from "../components/Section.svelte";
  import { sync } from "../lib/sync.svelte.ts";
  import type { PairStatus } from "../lib/types.ts";

  let { p }: { p: PairStatus } = $props();
  const EVK: Record<string, [string, string]> = {
    add: ["+", "#19A974"],
    update: ["~", "#2586E6"],
    delete: ["−", "#E5484D"],
    rename: ["↻", "#8B6CF0"],
    conflict: ["!", "#E5484D"],
    resolved: ["✓", "#19A974"],
    error: ["✗", "#E5484D"],
    warn: ["!", "#E8A120"],
    paused: ["‖", "#E8A120"],
    resumed: ["▶", "#19A974"],
    commit: ["●", "#19A974"],
    synced: ["⇄", "#3CCBB0"],
    skip: ["–", "#94A0B6"],
  };
  const q = $derived(sync.query.trim().toLowerCase());
  const events = $derived(
    (sync.log[p.name] ?? [])
      .filter(
        (e) =>
          e.kind !== "git" &&
          (!q || (e.path || "").toLowerCase().includes(q) || (e.message || "").toLowerCase().includes(q)),
      )
      .slice()
      .reverse(),
  );
  const clock = (iso?: string) =>
    iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
</script>

<Section id="activity" title="Live activity" count={events.length}>
  {#if events.length}
    <div class="log">
      {#each events as e, i (i)}
        {@const k = EVK[e.kind] ?? ["·", "#94A0B6"]}
        <div class="ev">
          <span class="t">{clock(e.time)}</span><span class="k" style:background={k[1]}>{k[0]}</span>
          <span
            >{[e.path, e.to ? "→ " + e.to : "", e.message ? (e.path ? "· " : "") + e.message : ""]
              .filter(Boolean)
              .join(" ")}</span
          >
        </div>
      {/each}
    </div>
  {:else}<div class="empty-row">Live events appear here while this page is open.</div>{/if}
</Section>

<style lang="scss">
  @use "tokens" as *;
  .log {
    padding: 0 space(3) + 2 space(3);
    max-height: 560px;
    overflow: auto;
  }
  .ev {
    display: grid;
    grid-template-columns: 64px 28px 1fr;
    gap: space(1) + 2;
    padding: 7px space(1);
    border-top: 1px solid var(--line);
    font-size: 13px;
    align-items: start;
  }
  .t {
    color: var(--faint);
    font-family: $font-mono;
    font-size: 12px;
  }
  .k {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-size: 11px;
    font-weight: $weight-heavy;
    color: #fff;
  }
</style>
