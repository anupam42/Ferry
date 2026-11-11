<script lang="ts">
  import Icon from "../components/Icon.svelte";
  import RelayLoading from "../components/RelayLoading.svelte";
  import Section from "../components/Section.svelte";
  import { api } from "../lib/api.ts";
  import { act, ask, askFields } from "../lib/app.svelte.ts";
  import { ago } from "../lib/format.ts";
  import { git } from "../lib/git.svelte.ts";
  import type { RepoStateResponse, Tag } from "../lib/types.ts";

  let { st }: { st: RepoStateResponse } = $props();
  let list = $state<Tag[] | null>(null);
  $effect(() => {
    void git.bump;
    act(null, () => api<Tag[]>("GET", git.url("tags"))).then((r) => {
      if (r) list = r;
    });
  });

  async function add() {
    const v = await askFields({
      mood: "excited",
      title: "Tag where you are now",
      text: `A tag names this exact commit (${st.head}) forever, like v1.2.0.`,
      yes: "Create tag",
      no: "Cancel",
      yesMood: "party",
      primary: "yes",
      fields: [
        { name: "name", label: "Tag name", placeholder: "e.g. v1.2.0" },
        { name: "message", label: "Note (optional)", placeholder: "e.g. First public release" },
      ],
    });
    if (v)
      await git.try<{ tag: string }>(
        "tag-create",
        { name: v.name, message: v.message },
        (r) => `Tagged ${r.tag}`,
        "party",
      );
  }
  async function remove(t: Tag) {
    const ok = await ask({
      mood: "worried",
      title: `Delete the tag ${t.name}?`,
      text: "Only your local tag goes; if it's already on the remote it stays there.",
      yes: "Delete",
      no: "Keep it",
      yesMood: "sad",
    });
    if (ok) await git.try("tag-delete", { name: t.name }, `Deleted ${t.name}`, "sleepy");
  }
</script>

{#if !list}
  <RelayLoading say="Reading your tags" />
{:else}
  <Section id="g-tags" title="Tags" count={list.length}>
    {#snippet extra()}
      <span class="inline">
        {#if list?.length}<button class="btn small" onclick={() => git.try("tag-push", {}, "Pushed all tags", "party")}
            >Push all tags</button
          >{/if}
        <button class="btn small brand" onclick={add}><Icon name="plus" size={16} />New tag</button>
      </span>
    {/snippet}
    {#if list.length}
      <table class="table">
        <tbody>
          {#each list as t (t.name)}
            <tr>
              <td class="file"
                ><span class="name"><Icon name="tag" size={14} />{t.name}</span><small
                  >{t.message ? t.message + " · " : ""}{ago(t.date)}</small
                ></td
              >
              <td class="opt mono muted">{t.commit}</td>
              <td class="end">
                <button
                  class="btn small"
                  onclick={() => git.try("tag-push", { name: t.name }, `Pushed ${t.name}`, "party")}
                  ><Icon name="up" size={16} />Push</button
                >
                <button class="btn small ghost danger" onclick={() => remove(t)}>Delete</button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {:else}<div class="empty-row">No tags yet. Tags mark releases, like v1.0.</div>{/if}
  </Section>
{/if}

<style lang="scss">
  @use "tokens" as *;
  .name {
    display: inline-flex;
    align-items: center;
    gap: space(1) + 2;
    :global(svg) {
      color: var(--amber);
    }
  }
  .end :global(.btn) {
    margin-left: space(1);
  }
</style>
