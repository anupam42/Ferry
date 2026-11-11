<script lang="ts">
  import Icon from "../components/Icon.svelte";
  import RelayLoading from "../components/RelayLoading.svelte";
  import Section from "../components/Section.svelte";
  import { api } from "../lib/api.ts";
  import { act, ask, askFields } from "../lib/app.svelte.ts";
  import { git } from "../lib/git.svelte.ts";
  import { short } from "../lib/sync.svelte.ts";
  import type { RepoStateResponse, Worktree } from "../lib/types.ts";

  let { st }: { st: RepoStateResponse } = $props();
  let list = $state<Worktree[] | null>(null);
  $effect(() => {
    void git.bump;
    act(null, () => api<Worktree[]>("GET", git.url("worktrees"))).then((r) => {
      if (r) list = r;
    });
  });

  async function add() {
    const v = await askFields({
      primary: "yes",
      mood: "excited",
      title: "New worktree",
      yes: "Create it",
      no: "Cancel",
      yesMood: "party",
      text: "A worktree is a second folder for the same repository, checked out on another branch, so you can work on two branches at once.",
      fields: [
        { name: "branch", label: "Branch", placeholder: "e.g. hotfix" },
        { name: "create", type: "check", label: "It's a new branch", value: true },
        {
          name: "path",
          label: "Folder",
          placeholder: st.root + "-hotfix",
          hint: "Leave empty to put it next to this repository.",
        },
        { name: "open", type: "check", label: "Open it in Ferry too", value: true },
      ],
    });
    if (!v) return;
    const dir = (v.path as string) || `${st.root}-${String(v.branch || "worktree").replace(/[^\w.-]+/g, "-")}`;
    await git.try<{ path: string }>(
      "worktree-add",
      { path: dir, branch: v.branch, create: v.create, open: v.open },
      (r) => "Created " + short(r.path),
      "party",
    );
  }
  async function openHere(w: Worktree) {
    await act("Opened " + short(w.path), () => api("POST", "/git/repos", { action: "add", path: w.path }), "wink");
    await git.refresh();
  }
  async function remove(w: Worktree) {
    const ok = await ask({
      mood: "worried",
      title: "Remove this worktree?",
      text: "Its folder is deleted. Commits stay in the repository; uncommitted changes in that folder would be lost.",
      yes: "Remove",
      no: "Keep it",
      yesMood: "sad",
    });
    if (ok) await git.try("worktree-remove", { path: w.path }, "Removed the worktree", "sleepy");
  }
</script>

{#if !list}
  <RelayLoading say="Looking at your worktrees" />
{:else}
  <Section id="g-wt" title="Worktrees" count={list.length}>
    {#snippet extra()}<button class="btn small brand" onclick={add}><Icon name="plus" size={16} />New worktree</button
      >{/snippet}
    <table class="table">
      <tbody>
        {#each list as w (w.path)}
          <tr>
            <td class="file"
              >{short(w.path)}{#if w.main}<span class="pill">main</span>{/if}<small
                >{w.detached ? `detached at ${w.head}` : `⎇ ${w.branch}`}</small
              ></td
            >
            <td class="end">
              {#if !w.main}
                <button class="btn small" onclick={() => openHere(w)}>Open here</button>
                <button class="btn small ghost danger" onclick={() => remove(w)}>Remove</button>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
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
</style>
