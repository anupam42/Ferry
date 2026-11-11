<script lang="ts">
  import Drawer from "../components/Drawer.svelte";
  import { git } from "../lib/git.svelte.ts";

  const p = git.checks!;
  const ORDER: Record<string, number> = { failed: 0, pending: 1, passed: 2 };
  const items = [...p.checks.items].sort((a, b) => (ORDER[a.state] ?? 3) - (ORDER[b.state] ?? 3));
</script>

<Drawer title="Checks for #{p.number}" sub={p.title} onclose={() => (git.checks = null)}>
  <div class="list">
    {#each items as c (c.name)}
      <div class="row">
        <span
          class="pill"
          class:red={c.state === "failed"}
          class:amber={c.state !== "failed" && c.state !== "passed"}
          class:green={c.state === "passed"}
        >
          {c.state === "failed" ? "✗ failed" : c.state === "passed" ? "✓ passed" : "… running"}</span
        >
        <span class="grow">{c.name}</span>
        {#if c.url}<a class="btn small" href={c.url} target="_blank" rel="noopener noreferrer">Details</a>{/if}
      </div>
    {/each}
  </div>
</Drawer>

<style lang="scss">
  @use "tokens" as *;
  .list {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: space(3);
    padding: space(2) space(3);
    border-radius: $radius-md;
    &:hover {
      background: var(--card2);
    }
    .grow {
      flex: 1;
    }
  }
</style>
