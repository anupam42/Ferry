<script lang="ts">
  import RelayLoading from "../components/RelayLoading.svelte";
  import Section from "../components/Section.svelte";
  import { api } from "../lib/api.ts";
  import { act, ask } from "../lib/app.svelte.ts";
  import { ago } from "../lib/format.ts";
  import { git } from "../lib/git.svelte.ts";
  import type { Stash } from "../lib/types.ts";

  let list = $state<Stash[] | null>(null);
  $effect(() => { void git.bump; act(null, () => api<Stash[]>("GET", git.url("stashes"))).then((r) => { if (r) list = r; }); });

  async function drop(x: Stash) {
    const ok = await ask({ mood: "worried", title: "Throw this stash away?", text: "These changes aren't anywhere else.", yes: "Throw away", no: "Keep it", yesMood: "sad" });
    if (ok) await git.try("stash-drop", { ref: x.ref }, "Stash thrown away", "sleepy");
  }
</script>

{#if !list}
  <RelayLoading say="Looking at your stashes" />
{:else}
  <Section id="g-stash" title="Stashes" count={list.length}>
    {#if list.length}
      <table class="table"><tbody>
        {#each list as x (x.ref)}
          <tr>
            <td class="file">{x.message || "(no note)"}<small>on {x.branch} · {ago(x.when)}</small></td>
            <td class="end">
              <button class="btn small brand" onclick={() => git.try("stash-apply", { ref: x.ref, pop: true }, "Brought them back (and removed the stash)", "happy")}>Bring back</button>
              <button class="btn small" title="Bring back and keep a copy in the list" onclick={() => git.try("stash-apply", { ref: x.ref, pop: false }, "Brought them back (the stash stays too)", "happy")}>Apply, keep copy</button>
              <button class="btn small ghost danger" onclick={() => drop(x)}>Throw away</button>
            </td>
          </tr>
        {/each}
      </tbody></table>
    {:else}<div class="empty-row">Nothing stashed. “Stash all” on the Changes tab tucks your changes away here.</div>{/if}
  </Section>
{/if}

<style lang="scss">
  @use "tokens" as *;
  .end :global(.btn) { margin-left: space(1); }
</style>
