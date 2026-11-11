<script lang="ts">
  import Icon from "../components/Icon.svelte";
  import Section from "../components/Section.svelte";
  import { ago, plural } from "../lib/format.ts";
  import { ignoreFile, resolve, sync } from "../lib/sync.svelte.ts";
  import type { PairStatus } from "../lib/types.ts";

  let { p }: { p: PairStatus } = $props();
  const KIND: Record<string, [string, string]> = {
    add: ["Added", "green"],
    update: ["Updated", "blue"],
    delete: ["Deleted", "red"],
    rename: ["Renamed", "violet"],
    kept: ["Kept", "violet"],
    conflict: ["Conflict", "red"],
  };
  const q = $derived(sync.query.trim().toLowerCase());
  const matches = (path: string) => !q || path.toLowerCase().includes(q);
  const conflicts = $derived(p.conflicts.filter(matches));
  const cleared = $derived(sync.cleared[p.name] ?? 0);
  const files = $derived(
    (p.changed || [])
      .filter((c) => !p.conflicts.includes(c.path) && Date.parse(c.time) > cleared && matches(c.path))
      .sort((a, b) => Date.parse(b.time) - Date.parse(a.time)),
  );
  const folder = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "top folder");
  const where = (d?: string) =>
    d === "←" ? "to your working folder" : d === "⇄" ? "merged both ways" : "to the target";
  const uncommitted = $derived((p.git_status || []).length);
  const see = (file: string, conflict = false) => (sync.diff = { pair: p.name, file, conflict });
</script>

{#if p.conflicts.length}
  <Section id="conflicts" title="Needs your decision" count={p.conflicts.length} tone="red">
    {#if conflicts.length}
      <table class="table">
        <thead><tr><th>File</th><th class="opt">Status</th><th></th></tr></thead>
        <tbody>
          {#each conflicts as c (c)}
            <tr>
              <td class="file">{c}<small>Changed in both folders since the last sync</small></td>
              <td class="opt"><span class="pill red">Needs a decision</span></td>
              <td class="end">
                <button class="btn small brand" onclick={() => see(c, true)}
                  ><Icon name="eye" size={16} />See both versions</button
                >
                <button class="btn small" onclick={() => resolve(p, c, "source", "kept your working folder's version")}
                  >Keep mine</button
                >
                <button class="btn small" onclick={() => resolve(p, c, "target", "kept the target's version")}
                  >Keep target's</button
                >
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {:else}<div class="empty-row">No conflicts match your search.</div>{/if}
  </Section>
{/if}

<Section id="copied" title="Copied since Ferry started" count={files.length}>
  {#snippet extra()}
    {#if files.length}<button class="btn small ghost" onclick={() => (sync.cleared[p.name] = Date.now())}
        >Clear list</button
      >{/if}
  {/snippet}
  {#if files.length}
    <table class="table">
      <thead
        ><tr><th>File</th><th>What happened</th><th class="opt">Where</th><th class="opt">When</th><th></th></tr></thead
      >
      <tbody>
        {#each files.slice(0, 500) as c (c.path + c.time)}
          {@const k = KIND[c.kind] ?? [c.kind, ""]}
          <tr>
            <td class="file">{c.path.split("/").pop()}<small>{folder(c.path)}</small></td>
            <td><span class="pill {k[1]}">{k[0]}</span></td>
            <td class="opt muted">{where(c.direction)}</td>
            <td class="opt muted when">{ago(c.time)}</td>
            <td class="end">
              {#if c.kind !== "delete"}<button class="btn small" onclick={() => see(c.path)}
                  ><Icon name="eye" size={16} />See changes</button
                >{/if}
              <button
                class="btn small ghost"
                title="Stop syncing this file (adds it to .syncignore)"
                onclick={() => ignoreFile(p, c.path)}>Ignore</button
              >
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {:else}
    <div class="empty-row">
      {q
        ? "No copied files match your search."
        : "Nothing copied yet. Edit a file in your working folder and it shows up here."}
    </div>
  {/if}
</Section>

{#if p.is_git}
  <Section id="git" title="Not committed yet" count={uncommitted} tone="blue">
    <div class="empty-row">
      {uncommitted
        ? `${plural(uncommitted, "file")} in the target differ from its last git commit. That's normal after syncing; commit them when you're ready.`
        : "The target matches its last commit."}
      {#if uncommitted}<div class="go">
          <button class="btn small primary" onclick={() => (sync.view = "git")}
            ><Icon name="commit" size={16} />Review and commit</button
          >
        </div>{/if}
    </div>
  </Section>
{/if}

<style lang="scss">
  @use "tokens" as *;
  .go {
    margin-top: space(2) + 2;
  }
  .end :global(.btn) {
    margin-left: space(1);
  }
</style>
