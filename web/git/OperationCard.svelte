<script lang="ts">
  import Icon from "../components/Icon.svelte";
  import { ask } from "../lib/app.svelte.ts";
  import { git, resolveFile } from "../lib/git.svelte.ts";
  import type { RepoStateResponse } from "../lib/types.ts";

  /**
   * A merge, rebase, cherry-pick or revert in progress: conflicted files with
   * one-click choices, then Continue or Abort. With no operation but
   * conflicted files, a pull put your set-aside edits back and some lines
   * clashed; there git's "ours" is what came in and "theirs" is your edits.
   */
  let { st }: { st: RepoStateResponse } = $props();
  const conflicts = $derived(st.files.filter((f) => f.conflicted));
  const clash = $derived(!st.operation && conflicts.length > 0);
  const TITLE: Record<string, string> = {
    rebase: "Rebase in progress",
    "cherry-pick": "Cherry-pick in progress",
    revert: "Revert in progress",
  };
  const title = $derived(
    st.operation === "merge" ? `Merging ${st.operationBranch || "a branch"}` : (TITLE[st.operation] ?? ""),
  );

  async function abort() {
    const ok = await ask({
      mood: "worried",
      title: `Abort the ${st.operation}?`,
      text: "I'll put everything back the way it was before it started.",
      yes: "Abort",
      no: "Keep going",
      yesMood: "sad",
    });
    if (ok) await git.try("finish", { action: "abort" }, `Aborted the ${st.operation}`, "sleepy");
  }
</script>

{#if st.operation || clash}
  <section class="card section op">
    <div class="section-head">
      <span class="section-title"
        >{clash ? "Your edits met the pulled changes" : title}{#if conflicts.length}<span class="count red"
            >{conflicts.length}</span
          >{/if}</span
      >
      <div class="grow"></div>
      {#if !clash}
        <button class="btn ghost danger" onclick={abort}>Abort</button>
        <button
          class="btn brand"
          disabled={conflicts.length > 0}
          onclick={() => git.try("finish", { action: "continue" }, "Done! Finished the " + st.operation, "party")}
          >Continue</button
        >
      {/if}
    </div>
    {#if clash}
      <p class="hint note">
        The pull worked. Putting your uncommitted edits back clashed in these files. Nothing is lost: a copy of your
        edits is also kept in Stashes (“autostash”) until you remove it.
      </p>
    {/if}
    {#if conflicts.length}
      <table class="table">
        <tbody>
          {#each conflicts as f (f.path)}
            <tr>
              <td class="file"
                >{f.path}<small
                  >{clash ? "your edit and the pulled change touch the same lines" : "changed on both branches"}</small
                ></td
              >
              <td class="end">
                <button class="btn small brand" onclick={() => (git.conflict = f.path)}
                  ><Icon name="eye" size={16} />See both</button
                >
                {#if clash}
                  <button class="btn small" onclick={() => resolveFile(f.path, "theirs", "kept your edits")}
                    >Keep my edits</button
                  >
                  <button class="btn small" onclick={() => resolveFile(f.path, "ours", "took the pulled version")}
                    >Take theirs</button
                  >
                {:else}
                  <button class="btn small" onclick={() => resolveFile(f.path, "ours", "kept your version")}
                    >Keep mine</button
                  >
                  <button class="btn small" onclick={() => resolveFile(f.path, "theirs", "kept theirs")}
                    >Keep theirs</button
                  >
                {/if}
                <button
                  class="btn small"
                  title="Keep every line from both sides"
                  onclick={() => resolveFile(f.path, "both", "kept both")}>Keep both</button
                >
                <button
                  class="btn small ghost"
                  title="I fixed it in my editor"
                  onclick={() => resolveFile(f.path, "done", "marked as resolved")}>I fixed it</button
                >
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {:else}
      <div class="empty-row">Every conflict is settled. Press Continue to finish.</div>
    {/if}
  </section>
{/if}

<style lang="scss">
  @use "tokens" as *;
  .op {
    border: 2px solid var(--red);
  }
  .note {
    margin: 0 space(4) space(2);
  }
  .end :global(.btn) {
    margin-left: space(1);
  }
</style>
