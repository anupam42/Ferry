<script lang="ts">
  import Icon from "../components/Icon.svelte";
  import RelayLoading from "../components/RelayLoading.svelte";
  import Section from "../components/Section.svelte";
  import { api, ApiError } from "../lib/api.ts";
  import { ago } from "../lib/format.ts";
  import { git } from "../lib/git.svelte.ts";
  import type { PullRequestList } from "../lib/types.ts";
  import NeedsConnection from "./NeedsConnection.svelte";

  let res = $state<PullRequestList | null>(null);
  let error = $state<{ msg: string; code: string } | null>(null);
  $effect(() => { void git.bump; api<PullRequestList>("GET", git.url("prs")).then((r) => (res = r), (e) => (error = { msg: (e as Error).message, code: e instanceof ApiError ? e.code : "" })); });
  const fixable = $derived(!!error && ["no-cli", "not-connected", "auth"].includes(error.code));
  const REVIEW: Record<string, [string, string]> = { APPROVED: ["approved", "green"], CHANGES_REQUESTED: ["changes requested", "red"], REVIEW_REQUIRED: ["review needed", "amber"] };
</script>

{#if error}
  <NeedsConnection say={fixable ? "I need to be connected for this." : "I couldn't get the pull requests."} hint={error.msg} connect={fixable && error.code !== "no-cli"} />
{:else if !res}
  <RelayLoading say="Asking for your pull requests" mood="excited" sub="And how their checks are doing." />
{:else}
  <Section id="g-prs" title={res.provider === "GitLab" ? "Merge requests" : "Pull requests"} count={res.items.length} tone="blue">
    {#if res.items.length}
      <table class="table"><tbody>
        {#each res.items as p (p.number)}
          {@const c = p.checks}
          {@const rv = REVIEW[p.review]}
          <tr>
            <td class="file">#{p.number} {p.title}{#if p.draft}<span class="pill draft">draft</span>{/if}<small>{p.branch} → {p.base} · {p.author} · {ago(p.updated)}</small></td>
            <td class="state">
              {#if c.items.length}
                <button class="pill checks" class:red={c.failed > 0} class:amber={!c.failed && c.pending > 0} class:green={!c.failed && !c.pending} onclick={() => (git.checks = p)}>
                  {c.failed ? `✗ ${c.failed} failing` : c.pending ? `… ${c.pending} running` : `✓ ${c.passed} passing`}</button>
              {:else}<span class="muted">no checks</span>{/if}
              {#if rv}<span class="pill {rv[1]}">{rv[0]}</span>{/if}
            </td>
            <td class="end">
              <button class="btn small" onclick={() => (git.pr = { pr: p, provider: res!.provider })}><Icon name="list" size={16} />Review</button>
              <a class="btn small" href={p.url} target="_blank" rel="noopener noreferrer">Open</a>
              <button class="btn small brand" onclick={() => git.try("pr-checkout", { number: p.number, branch: p.branch }, `Checked out #${p.number} so you can try it`, "excited")}>Check out</button>
            </td>
          </tr>
        {/each}
      </tbody></table>
    {:else}<div class="empty-row">No open pull requests.</div>{/if}
  </Section>
{/if}

<style lang="scss">
  @use "tokens" as *;
  .draft { margin-left: space(2); }
  .checks { border: 0; cursor: pointer; }
  .state { white-space: nowrap; .pill { margin-right: space(1); } }
  .end :global(.btn) { margin-left: space(1); }
</style>
