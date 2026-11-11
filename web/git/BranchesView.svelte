<script lang="ts">
  import Icon from "../components/Icon.svelte";
  import RelayLoading from "../components/RelayLoading.svelte";
  import Section from "../components/Section.svelte";
  import { api, ApiError } from "../lib/api.ts";
  import { act, ask, askFields, toast } from "../lib/app.svelte.ts";
  import { ago } from "../lib/format.ts";
  import { git } from "../lib/git.svelte.ts";
  import type { Branch, BranchList, RepoStateResponse } from "../lib/types.ts";

  let { st }: { st: RepoStateResponse } = $props();
  let b = $state<BranchList | null>(null);
  $effect(() => {
    void git.bump;
    act(null, () => api<BranchList>("GET", git.url("branches"))).then((r) => {
      if (r) b = r;
    });
  });

  async function newBranch() {
    const v = await askFields({
      mood: "excited",
      title: "New branch",
      text: `It starts from where you are now (${st.branch || st.head}).`,
      yes: "Create branch",
      no: "Cancel",
      yesMood: "party",
      primary: "yes",
      fields: [
        { name: "name", label: "Branch name", placeholder: "e.g. new-login-page" },
        { name: "checkout", type: "check", label: "Switch to it now", value: true },
      ],
    });
    if (v)
      await git.try<{ branch: string }>(
        "branch-create",
        { name: v.name, checkout: v.checkout },
        (r) => `Created ${r.branch}`,
        "party",
      );
  }
  async function merge(x: Branch) {
    const ok = await ask({
      mood: "thinking",
      title: `Merge ${x.name} into ${st.branch}?`,
      yes: "Merge",
      no: "Cancel",
      yesMood: "excited",
      primary: "yes",
      text: `Everything committed on ${x.name} comes into ${st.branch}. If both changed the same lines, I'll help you choose.`,
    });
    if (ok)
      await git.try<{ conflicts: string[] }>(
        "merge",
        { branch: x.name },
        (r) => (r.conflicts?.length ? "" : `Merged ${x.name} into ${st.branch}`),
        "party",
      );
  }
  async function rename(x: Branch) {
    const v = await askFields({
      primary: "yes",
      mood: "thinking",
      title: `Rename ${x.name}`,
      text: "Only the local name changes; a branch on the remote keeps its old name until you push again.",
      yes: "Rename",
      no: "Cancel",
      fields: [{ name: "to", label: "New name", value: x.name }],
    });
    if (v) await git.try("branch-rename", { from: x.name, to: v.to }, "Renamed to " + v.to, "wink");
  }
  async function remove(x: Branch) {
    const ok = await ask({
      mood: "worried",
      title: `Delete ${x.name}?`,
      text: "Only your local branch goes; a copy on the remote is left alone.",
      yes: "Delete",
      no: "Keep it",
      yesMood: "sad",
    });
    if (!ok) return;
    try {
      await git.act("branch-delete", { name: x.name }, "Deleted " + x.name, "sleepy");
    } catch (e) {
      if (!(e instanceof ApiError && e.code === "unmerged")) return toast((e as Error).message, { error: true });
      const force = await ask({
        mood: "worried",
        hold: true,
        title: `${x.name} has unmerged commits.`,
        text: "Those commits aren't on any other branch. Deleting the branch could lose them.",
        yes: "Delete anyway",
        no: "Keep it",
      });
      if (force) await git.try("branch-delete", { name: x.name, force: true }, "Deleted " + x.name, "sleepy");
    }
  }
</script>

{#if !b}
  <RelayLoading say="Gathering your branches" />
{:else}
  <Section id="g-local" title="Your branches" count={b.local.length} tone="blue">
    {#snippet extra()}<button class="btn small brand" onclick={newBranch}
        ><Icon name="plus" size={16} />New branch</button
      >{/snippet}
    <table class="table">
      <tbody>
        {#each b.local as x (x.name)}
          <tr>
            <td class="file"
              >{x.name}
              {#if x.current}<span class="pill green">you're here</span>{/if}
              {#if x.gone}<span class="pill red">gone from remote</span>{/if}
              <small>{x.subject} · {ago(x.date)}</small></td
            >
            <td class="opt muted">
              {#if x.upstream}{x.upstream}{#if x.ahead}
                  <span class="pill blue">↑{x.ahead}</span>{/if}{#if x.behind}
                  <span class="pill amber">↓{x.behind}</span>{/if}
              {:else}not on a remote{/if}
            </td>
            <td class="end">
              {#if !x.current}
                <button
                  class="btn small brand"
                  onclick={() =>
                    git.try<{ branch: string }>(
                      "branch-switch",
                      { name: x.name },
                      (r) => `Switched to ${r.branch}`,
                      "wink",
                    )}>Switch</button
                >
                <button class="btn small" onclick={() => merge(x)}>Merge into {st.branch}</button>
              {/if}
              <button class="btn small ghost" onclick={() => rename(x)}>Rename</button>
              {#if !x.current}<button class="btn small ghost danger" onclick={() => remove(x)}>Delete</button>{/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </Section>
  <Section id="g-remote" title="Only on the remote" count={b.remote.length}>
    {#if b.remote.length}
      <table class="table">
        <tbody>
          {#each b.remote as x (x.name)}
            <tr>
              <td class="file">{x.name}<small>{x.subject} · {ago(x.date)}</small></td>
              <td class="end"
                ><button
                  class="btn small"
                  onclick={() =>
                    git.try<{ branch: string }>(
                      "branch-switch",
                      { name: x.name },
                      (r) => `Checked out ${r.branch}`,
                      "wink",
                    )}>Check out</button
                ></td
              >
            </tr>
          {/each}
        </tbody>
      </table>
    {:else}<div class="empty-row">Every remote branch has a local copy. Press Fetch to look for new ones.</div>{/if}
  </Section>
{/if}

<style lang="scss">
  @use "tokens" as *;
  .end :global(.btn) {
    margin-left: space(1);
  }
  .file .pill {
    margin-left: space(2);
  }
  .opt {
    white-space: nowrap;
  }
</style>
