<script lang="ts">
  import Icon from "../components/Icon.svelte";
  import RelayLoading from "../components/RelayLoading.svelte";
  import Section from "../components/Section.svelte";
  import { api } from "../lib/api.ts";
  import { askFields, toast } from "../lib/app.svelte.ts";
  import { ago } from "../lib/format.ts";
  import { git } from "../lib/git.svelte.ts";
  import { branchFor } from "../lib/gitmood.ts";
  import type { Issue, IssueList, RepoStateResponse } from "../lib/types.ts";
  import NeedsConnection from "./NeedsConnection.svelte";

  let { st }: { st: RepoStateResponse } = $props();
  let res = $state<IssueList | null>(null);
  let error = $state("");
  $effect(() => { api<IssueList>("GET", git.url("issues")).then((r) => (res = r), (e) => (error = (e as Error).message)); });
  const tone = (c: string) => (c === "indeterminate" ? "blue" : c === "done" ? "green" : "");

  async function start(i: Issue) {
    const v = await askFields({ mood: "excited", title: `Start work on ${i.key}?`, yes: "Start work", no: "Cancel", yesMood: "party", noMood: "thinking", primary: "yes",
      text: `I'll make a branch for “${i.summary}” from ${st.branch || "here"} and switch to it. Commits there get ${i.key} in their message, so Jira links them.`,
      fields: [{ name: "branch", label: "Branch name", value: branchFor(i.key, i.summary) }, { name: "transition", type: "check", label: "Move the issue to In Progress", value: i.category !== "indeterminate" }] });
    if (!v) return;
    const r = await git.try<{ branch: string; moved: string }>("issue-start", { key: i.key, summary: i.summary, branch: v.branch, transition: v.transition },
      (r) => `On ${r.branch}` + (r.moved && !r.moved.startsWith("!") ? `; ${i.key} is now ${r.moved}` : ""), "party");
    if (r?.moved?.startsWith("!")) toast(`Couldn't move ${i.key}: ${r.moved.slice(1)}`, { error: true });
  }
</script>

{#if error}
  <NeedsConnection say="I couldn't reach Jira." hint={error} />
{:else if !res}
  <RelayLoading say="Asking Jira for your issues" mood="excited" />
{:else}
  <Section id="g-issues" title="My Jira issues" count={res.issues.length} tone="blue">
    {#if res.issues.length}
      <table class="table"><tbody>
        {#each res.issues as i (i.key)}
          <tr>
            <td class="file"><a class="pill blue key" href={i.url} target="_blank" rel="noopener noreferrer">{i.key}</a>{i.summary}
              <small>{[i.type, i.priority && i.priority + " priority", "updated " + ago(i.updated)].filter(Boolean).join(" · ")}</small></td>
            <td><span class="pill {tone(i.category)}">{i.status}</span></td>
            <td class="end">
              <button class="btn small brand" onclick={() => start(i)}><Icon name="branch" size={16} />Start work</button>
              <a class="btn small" href={i.url} target="_blank" rel="noopener noreferrer">Open</a>
            </td>
          </tr>
        {/each}
      </tbody></table>
    {:else}<div class="empty-row">Nothing assigned to you that's still open. Nice!</div>{/if}
  </Section>
{/if}

<style lang="scss">
  @use "tokens" as *;
  .key { text-decoration: none; margin-right: space(2); }
  .end :global(.btn) { margin-left: space(1); }
</style>
