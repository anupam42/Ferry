<script lang="ts">
  import Icon from "../components/Icon.svelte";
  import RelayLoading from "../components/RelayLoading.svelte";
  import Section from "../components/Section.svelte";
  import { api } from "../lib/api.ts";
  import { act, ask, toast } from "../lib/app.svelte.ts";
  import { plural } from "../lib/format.ts";
  import { pairURL, sync } from "../lib/sync.svelte.ts";
  import type { Batch, PairStatus, RestoreResult } from "../lib/types.ts";

  let { p }: { p: PairStatus } = $props();
  let batches = $state<Batch[] | null>(null);
  $effect(() => { act(null, () => api<Batch[]>("GET", pairURL(p.name, "history"))).then((b) => (batches = b ?? [])); });

  const remote = $derived(!!p.remote);
  const WHEN = [["15m ago", "15 minutes ago"], ["1h ago", "1 hour ago"], ["3h ago", "3 hours ago"], ["today", "the start of today"], ["24h ago", "24 hours ago"], ["7d ago", "a week ago"], ["custom", "a specific time…"]] as const;
  let when = $state("15m ago");
  let custom = $state("");
  const q = $derived(sync.query.trim().toLowerCase());
  const shown = $derived((batches ?? []).slice(0, 100).filter((b) => !q || b.entries.some((e) => e.path.toLowerCase().includes(q))));
  const newest = $derived((batches ?? []).find((b) => !b.undone));
  const again = () => sync.bump++;

  async function goBack() {
    const at = when === "custom" ? custom.trim() : when;
    if (!at) return toast("Enter a time", { error: true });
    const pre = await act(null, () => api<RestoreResult>("POST", pairURL(p.name, "restore"), { at, dry_run: true }));
    if (!pre) return;
    if (pre.batches === 0) return toast("Nothing to undo after " + new Date(pre.restored_to).toLocaleString(), { mood: "thinking" });
    const files = pre.files ?? [];
    const list = files.slice(0, 6).join(", ") + (files.length > 6 ? ` and ${files.length - 6} more` : "");
    const ok = await ask({ mood: "thinking", title: `Go back to ${new Date(pre.restored_to).toLocaleString()}?`, yes: "Go back", no: "Not now", yesMood: "wink",
      text: `I'll undo ${plural(pre.batches, "sync")} touching ${plural(files.length, "file")} (${list}). I back up the current versions first, so you can change your mind.` });
    if (!ok) return;
    const r = await act(null, () => api<RestoreResult>("POST", pairURL(p.name, "restore"), { at }));
    const problems = r?.problems ?? [];
    if (r) toast(`Went back in time: reverted ${plural(r.reverted ?? 0, "change")}` + (problems.length ? `, ${problems.length} problem(s)` : ""), { error: problems.length > 0, mood: "wink" });
    again();
  }
  async function undo() {
    const ok = await ask({ mood: "thinking", title: "Undo the last sync?", text: "I'll put those files back the way they were. Current versions are backed up first.", yes: "Undo it", no: "Keep it", yesMood: "wink" });
    if (!ok) return;
    const r = await act(null, () => api<{ problems: string[] }>("POST", pairURL(p.name, "undo")));
    if (r) toast("Undone" + (r.problems.length ? ` with ${r.problems.length} problem(s): ${r.problems[0]}` : ""), { error: r.problems.length > 0, mood: "wink" });
    again();
  }
  const counts = (b: Batch) => {
    const n: Record<string, number> = { add: 0, update: 0, delete: 0, rename: 0 };
    for (const e of b.entries) n[e.op] = (n[e.op] || 0) + 1;
    return n;
  };
</script>

{#if !batches}
  <RelayLoading say="Reading the history" mood="thinking" />
{:else}
  <Section id="timemachine" title="Time machine">
    <div class="callout amber">
      {#if remote}<span class="grow">Going back isn't available for ssh or cloud targets.</span>
      {:else}
        <span class="grow">Go back to how Ferry left things at</span>
        <select class="auto" bind:value={when}>{#each WHEN as [v, l] (v)}<option value={v}>{l}</option>{/each}</select>
        {#if when === "custom"}<input type="text" class="custom" placeholder="e.g. 14:30 or 2026-11-07 09:00" bind:value={custom} />{/if}
        <button class="btn primary" onclick={goBack}><Icon name="clock" size={16} />Go back</button>
      {/if}
    </div>
  </Section>
  <Section id="batches" title="Every sync" count={batches.length}>
    {#snippet extra()}
      {#if newest && !remote}<button class="btn small" onclick={undo}>↶ Undo the last sync</button>{/if}
    {/snippet}
    {#if shown.length}
      <table class="table"><tbody>
        {#each shown as b (b.id)}
          {@const n = counts(b)}
          <tr class:undone={b.undone}>
            <td class="muted mono">{new Date(b.time).toLocaleString()}</td>
            <td>{b.entries.slice(0, 3).map((e) => e.path.split("/").pop()).join(", ")}{b.entries.length > 3 ? ` +${b.entries.length - 3} more` : ""}</td>
            <td class="opt">
              {#if n.add}<span class="pill green">+{n.add}</span>{/if}
              {#if n.update}<span class="pill blue">~{n.update}</span>{/if}
              {#if n.delete}<span class="pill red">−{n.delete}</span>{/if}
              {#if n.rename}<span class="pill violet">↻{n.rename}</span>{/if}
            </td>
            <td class="end">{#if b.undone}<span class="pill">undone</span>{/if}</td>
          </tr>
        {/each}
      </tbody></table>
    {:else}<div class="empty-row">No history yet. Every sync is recorded here so it can be undone.</div>{/if}
  </Section>
{/if}

<style lang="scss">
  @use "tokens" as *;
  .auto { width: auto; }
  .custom { width: 220px; }
  tr.undone { opacity: .55; }
  .opt .pill { margin-right: space(1); }
</style>
