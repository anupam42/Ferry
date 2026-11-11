<script lang="ts">
  import Icon from "../components/Icon.svelte";
  import RelayLoading from "../components/RelayLoading.svelte";
  import Section from "../components/Section.svelte";
  import { api } from "../lib/api.ts";
  import { act, ask, askFields } from "../lib/app.svelte.ts";
  import { ago, plural } from "../lib/format.ts";
  import { git } from "../lib/git.svelte.ts";
  import { dayLabel, reflogWords } from "../lib/gitmood.ts";
  import type { ReflogEntry, RepoStateResponse, UndoTimeline } from "../lib/types.ts";

  /** Every place the branch has been (the reflog), and branches you deleted: go back to any of them. */
  let { st }: { st: RepoStateResponse } = $props();
  let t = $state<UndoTimeline | null>(null);
  $effect(() => { void git.bump; act(null, () => api<UndoTimeline>("GET", git.url("undo-timeline"))).then((r) => { if (r) t = r; }); });
  const busy = $derived(!!st.operation);
  const days = $derived.by(() => {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- built and read inside this derived value, never stored
    const groups = new Map<string, ReflogEntry[]>();
    for (const e of t?.entries ?? []) {
      const k = dayLabel(e.date);
      groups.set(k, [...(groups.get(k) ?? []), e]);
    }
    return [...groups];
  });

  async function goBack(e: ReflogEntry) {
    const dirty = st.files.filter((f) => !f.untracked).length;
    const ok = await ask({ mood: "thinking", title: `Go back to how ${t?.branch || "this branch"} was ${ago(e.date)}?`, yes: "Go back", no: "Cancel", yesMood: "wink",
      text: `Your branch will point at ${e.short} (“${e.subject}”) again. Nothing is deleted: where you are now stays in this list, so you can come straight back.`
        + (dirty ? ` Your ${plural(dirty, "uncommitted change")} ${dirty === 1 ? "stays" : "stay"} as ${dirty === 1 ? "it is" : "they are"}.` : "") });
    if (ok) await git.try("restore", { hash: e.hash }, `Back to ${e.short}. Changed your mind? It's at the top of this list.`, "party");
  }
  async function branchHere(hash: string) {
    const v = await askFields({ mood: "excited", title: "Make a branch here", text: "A new branch at this exact point. Nothing else moves.", yes: "Create branch", no: "Cancel", yesMood: "party", primary: "yes",
      fields: [{ name: "name", label: "Branch name", placeholder: "e.g. rescue/before-rebase" }] });
    if (v?.name) await git.try<{ branch: string }>("branch-at", { name: v.name, hash }, (r) => `Created ${r.branch}`, "party");
  }
</script>

{#if !t}
  <RelayLoading say="Looking back through everything you did" mood="thinking" sub="Commits, switches, resets, rebases, merges and pulls." />
{:else}
  <div class="card intro">
    <span class="ic t-green"><Icon name="shield" size={18} /></span>
    <div><b>Nothing here is ever really lost.</b><small>Every commit, switch, reset, rebase, merge and pull is below. Go back to any of them; where you are now always stays in the list, so going back can be undone too.</small></div>
  </div>
  {#if t.lost.length}
    <Section id="g-lost" title="Deleted branches you can bring back" count={t.lost.length}>
      <div class="lost">
        {#each t.lost as b (b.name + b.hash)}
          <div class="lost-row">
            <span class="ic t-amber"><Icon name="branch" size={16} /></span>
            <div class="grow"><b>{b.name}</b><small>was at {b.short} “{b.subject}” · you left it {ago(b.date)}</small></div>
            <button class="btn small brand" onclick={() => git.try("branch-at", { name: b.name, hash: b.hash }, `${b.name} is back`, "party")}><Icon name="undo" size={16} />Restore</button>
          </div>
        {/each}
      </div>
    </Section>
  {/if}
  <Section id="g-undo" title="Everything you did" count={t.entries.length}>
    {#if t.entries.length}
      <div class="tl">
        {#each days as [day, list] (day)}
          <div class="day">{day}</div>
          {#each list as e (e.selector)}
            {@const [ic, words, tone] = reflogWords(e)}
            <div class="row" class:here={e.current} class:minor={tone === "muted"}>
              <span class="node t-{tone}"><Icon name={ic} size={14} /></span>
              <div class="main">
                <div class="what"><b>{words}</b>{#if e.current}<span class="pill blue">You are here</span>{/if}</div>
                <button type="button" class="commit" onclick={() => (git.commit = e.hash)}><span class="mono">{e.short}</span> {e.subject}</button>
              </div>
              <span class="when" title={new Date(e.date).toLocaleString()}>{new Date(e.date).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</span>
              <div class="acts">
                {#if !e.current}<button class="btn small" disabled={busy} title={busy ? `Finish the ${st.operation} first` : ""} onclick={() => goBack(e)}><Icon name="undo" size={16} />Go back here</button>{/if}
                <button class="btn small ghost" onclick={() => branchHere(e.hash)}><Icon name="branch" size={16} />Branch here</button>
              </div>
            </div>
          {/each}
        {/each}
      </div>
    {:else}<div class="empty-row">Nothing yet. Once you commit or switch branches, it shows up here.</div>{/if}
  </Section>
{/if}

<style lang="scss">
  @use "tokens" as *;
  @use "mixins" as *;

  .intro { display: flex; align-items: center; gap: space(3); padding: space(3) + 2 space(4); b { display: block; } small { color: var(--muted); } }
  .ic, .node { display: grid; place-items: center; flex: none; border-radius: 50%; }
  .ic { width: 34px; height: 34px; }
  .t-green { background: var(--green-soft); color: var(--green); } .t-amber { background: var(--amber-soft); color: var(--amber); }
  .t-violet { background: var(--violet-soft); color: var(--violet); } .t-blue { background: var(--accent-soft); color: var(--accent); } .t-muted { background: var(--card2); color: var(--faint); }
  .lost { padding: 0 space(3) space(2); }
  .lost-row { display: flex; align-items: center; gap: space(3); padding: space(2) space(1); border-top: 1px solid var(--line); &:first-child { border-top: 0; }
    .grow { flex: 1; min-width: 0; } b { display: block; } small { color: var(--muted); } }
  .tl { position: relative; padding: 0 space(3) space(3); }
  .day { font-size: 12px; font-weight: $weight-bold; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); padding: space(3) 0 space(1) space(10); }
  .row { position: relative; display: grid; grid-template-columns: 28px minmax(0, 1fr) auto auto; gap: space(3); align-items: center; padding: space(2) space(2); border-radius: $radius-md;
    &::before { content: ""; position: absolute; left: 21px; top: 0; bottom: 0; width: 2px; background: var(--line); z-index: 0; }
    &:hover { background: var(--accent-soft); }
    &.here { background: var(--accent-soft); box-shadow: inset 3px 0 0 var(--accent); }
    &.minor { opacity: .75; } }
  .node { position: relative; z-index: 1; width: 28px; height: 28px; box-shadow: 0 0 0 3px var(--card-solid); }
  .main { min-width: 0; }
  .what { display: flex; align-items: center; gap: space(2); font-size: 13.5px; }
  .commit { border: 0; background: none; padding: 0; color: var(--muted); font-size: fs(sm); cursor: pointer; text-align: left; @include ellipsis; max-width: 100%; &:hover { color: var(--accent); } }
  .when { color: var(--muted); font-size: fs(sm); white-space: nowrap; }
  .acts { display: flex; gap: space(1); }
  @include below(tablet) { .row { grid-template-columns: 28px minmax(0, 1fr); } .when, .acts { grid-column: 2; } }
</style>
