<script lang="ts">
  import Icon from "../components/Icon.svelte";
  import Section from "../components/Section.svelte";
  import { api, enc } from "../lib/api.ts";
  import { act } from "../lib/app.svelte.ts";
  import { pairURL, sync } from "../lib/sync.svelte.ts";
  import type { PairStatus } from "../lib/types.ts";

  let { p }: { p: PairStatus } = $props();
  const KIND: Record<string, [string, string]> = {
    add: ["Added", "green"],
    update: ["Updated", "blue"],
    delete: ["Deleted", "red"],
    rename: ["Renamed", "violet"],
  };
  const q = $derived(sync.query.trim().toLowerCase());
  const lines = $derived(p.git_status || []);
  const rows = $derived(
    lines
      .filter((l) => !q || l.slice(3).toLowerCase().includes(q))
      .slice(0, 300)
      .map((l) => {
        const code = l.slice(0, 2),
          file = l.slice(3);
        const kind =
          code.includes("?") || code.includes("A")
            ? "add"
            : code.includes("D")
              ? "delete"
              : code.includes("R")
                ? "rename"
                : "update";
        return { file, kind };
      }),
  );
  let message = $state("");
  let useAI = $state(false);
  let push = $state(false);

  async function commit() {
    const m = useAI ? "{ai}" : message.trim() || "sync: {summary}";
    const r = await act(
      useAI ? "Asking Claude for a message and committing…" : "Committing…",
      () => api("POST", pairURL(p.name, "commit") + "?message=" + enc(m) + (push ? "&push=1" : "")),
      "focused",
    );
    if (r !== null) message = "";
    sync.soon();
  }
</script>

<Section id="uncommitted" title="Not committed yet" count={lines.length} tone="blue">
  {#if rows.length}
    <table class="table">
      <tbody>
        {#each rows as r (r.file)}
          <tr>
            <td class="file">{r.file}</td>
            <td><span class="pill {KIND[r.kind]![1]}">{KIND[r.kind]![0]}</span></td>
            <td class="end">
              {#if r.kind !== "delete" && r.kind !== "rename"}<button
                  class="btn small"
                  onclick={() => (sync.diff = { pair: p.name, file: r.file, conflict: false })}
                  ><Icon name="eye" size={16} />See changes</button
                >{/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {:else}<div class="empty-row">Nothing to commit: the target matches its last commit.</div>{/if}
</Section>

<Section id="commitform" title="Commit">
  <form
    class="form"
    onsubmit={(e) => {
      e.preventDefault();
      void commit();
    }}
  >
    <label class="field"
      ><span class="label">Commit message</span>
      <input
        type="text"
        placeholder="Describe the change (or leave empty for a summary)"
        bind:value={message}
        disabled={useAI}
      />
    </label>
    <label class="check"
      ><input type="checkbox" bind:checked={useAI} /><span
        >Let Claude write the message from the changes<small class="hint"
          >Needs ANTHROPIC_API_KEY where ferry runs; falls back to an automatic summary.</small
        ></span
      ></label
    >
    <label class="check"><input type="checkbox" bind:checked={push} /><span>Push to the remote afterwards</span></label>
    <button class="btn primary" disabled={lines.length === 0}><Icon name="commit" size={16} />Commit</button>
  </form>
</Section>

<style lang="scss">
  @use "tokens" as *;
  .form {
    padding: space(1) space(4) space(3) + 2;
  }
</style>
