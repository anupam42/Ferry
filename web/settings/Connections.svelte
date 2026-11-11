<script lang="ts">
  import { app } from "../lib/app.svelte.ts";
  import Row from "./Row.svelte";

  const SERVICES = [
    { id: "gitlab", name: "GitLab", what: "Merge requests, pipelines and approvals" },
    { id: "azure", name: "Azure DevOps", what: "Pull requests, votes and builds" },
    { id: "jira", name: "Jira", what: "Your issues, and branches named after them" },
  ] as const;
</script>

<Row label="GitHub" hint="Pull requests come from the GitHub CLI (gh). Sign in with “gh auth login” in a terminal">
  <span class="pill">Uses gh</span>
</Row>
{#each SERVICES as s (s.id)}
  {@const c = app.conns?.[s.id]}
  <Row
    label={s.name}
    hint={c?.connected ? `Connected as ${c.user}${c.fromEnv ? " (from an environment variable)" : ""}` : s.what}
  >
    <div class="inline">
      <span class="pill" class:green={c?.connected}>{c?.connected ? "Connected" : "Not connected"}</span>
      <button class="btn small" onclick={() => (app.connectionsOpen = true)}
        >{c?.connected ? "Manage" : "Connect"}</button
      >
    </div>
  </Row>
{/each}

<style lang="scss">
  @use "tokens" as *;
  .inline {
    display: flex;
    align-items: center;
    gap: space(2) + 2;
  }
</style>
