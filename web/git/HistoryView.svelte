<script lang="ts">
  import Icon from "../components/Icon.svelte";
  import RelayLoading from "../components/RelayLoading.svelte";
  import Section from "../components/Section.svelte";
  import { api, enc } from "../lib/api.ts";
  import { act } from "../lib/app.svelte.ts";
  import { ago, plural } from "../lib/format.ts";
  import { git } from "../lib/git.svelte.ts";
  import { graphLayout, GRAPH } from "../lib/graph.ts";
  import { ms } from "../lib/look.svelte.ts";
  import type { Commit, RepoStateResponse } from "../lib/types.ts";
  import Avatar from "./Avatar.svelte";
  import GraphCell from "./GraphCell.svelte";
  import IssueText from "./IssueText.svelte";
  import RefPill from "./RefPill.svelte";

  let { st }: { st: RepoStateResponse } = $props();
  const PAGE = 100;
  let all = $state(false);
  let limit = $state(PAGE);
  let commits = $state<Commit[] | null>(null);
  // the graph draws itself in once; rows added by "Show older commits" draw in from there
  let seen = 0,
    seenKey = "";
  let firstNew = $state(0);

  $effect(() => {
    const key = [git.selected, all, st.branch].join("|");
    const want = limit;
    void git.bump;
    if (!st.head) {
      commits = [];
      return;
    }
    act(null, () => api<Commit[]>("GET", git.url("log") + "?limit=" + want + (all ? "&all=1" : ""))).then((c) => {
      if (!c) return;
      if (key !== seenKey) {
        seenKey = key;
        seen = 0;
      }
      firstNew = seen;
      seen = c.length;
      commits = c;
    });
  });

  const layout = $derived(commits ? graphLayout(commits, commits.find((c) => c.head)?.hash) : null);
  const graphW = $derived(layout ? GRAPH.pad * 2 + (layout.width - 1) * GRAPH.lane : 34);
  const still = ms(1) === 0;

  // search: messages filter as you type; Enter (or the button) asks the server, which can also search code changes
  let query = $state("");
  let mode = $state<"message" | "code">((localStorage.getItem("ferry-hist-mode") as "message" | "code") || "message");
  let found = $state<Commit[] | null>(null);
  let searching = $state(false);
  let foundFor = $state("");
  const q = $derived(query.trim().toLowerCase());
  const shown = $derived(
    !commits
      ? []
      : !q || mode === "code"
        ? commits.map((c, i) => ({ c, i }))
        : commits
            .map((c, i) => ({ c, i }))
            .filter(({ c }) =>
              (c.subject + " " + (c.note || "") + " " + c.author + " " + c.email + " " + c.hash)
                .toLowerCase()
                .includes(q),
            ),
  );
  $effect(() => {
    if (query.trim() !== foundFor) found = null;
  });

  async function deepSearch() {
    const text = query.trim();
    if (text.length < 2) return;
    searching = true;
    foundFor = text;
    try {
      found = await api<Commit[]>(
        "GET",
        git.url("search") + "?q=" + enc(text) + "&mode=" + mode + (all ? "&all=1" : ""),
      );
    } catch {
      found = [];
    }
    searching = false;
  }
  function setMode(m: "message" | "code") {
    mode = m;
    localStorage.setItem("ferry-hist-mode", m);
    if (found && query.trim().length >= 2) void deepSearch();
  }
  const shortDate = (iso: string) => {
    const t = Date.parse(iso);
    return localStorage.getItem("ferry-time") !== "exact" && Date.now() - t < 7 * 86400e3
      ? ago(iso)
      : new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  };
  const open = (c: Commit) => (git.commit = c.hash);
</script>

{#snippet row(c: Commit, i: number, graph: boolean)}
  <div
    class="h-row"
    class:is-head={c.head}
    role="row"
    tabindex="0"
    aria-label="{c.subject}, by {c.author}, {shortDate(c.date)}"
    onclick={() => open(c)}
    onkeydown={(e) => {
      if (e.key === "Enter") open(c);
    }}
  >
    <span class="h-graph" role="cell">
      {#if graph && layout}
        <GraphCell
          row={layout.rows[i]!}
          width={layout.width}
          merge={c.parents.length > 1}
          head={!!c.head}
          index={i}
          delay={!still && i >= firstNew ? Math.min((i - firstNew) * 26, 1400) : null}
          flow={!still && i < 80}
        />
      {/if}
    </span>
    <span class="h-author" role="cell"
      ><Avatar author={c.author} email={c.email} /><span class="h-name">{c.author}</span></span
    >
    <span class="h-commit mono" role="cell">{c.short}</span>
    <span class="h-msg" role="cell" title={c.subject + (c.note ? "\n" + c.note : "")}>
      {#if c.parents.length > 1}<span class="pill green merged">Merged</span>{/if}
      {#each c.refs as r (r)}<RefPill ref={r} remotes={st.remotes} current={st.branch} />{/each}
      <span class="h-subject"><IssueText text={c.subject} /></span>
      {#if c.note && c.parents.length > 1}<span class="h-note">{c.note}</span>{/if}
    </span>
    <span class="h-date" role="cell" title={new Date(c.date).toLocaleString()}>{shortDate(c.date)}</span>
  </div>
{/snippet}

{#if !st.head}
  <Section id="g-hist" title="History" count={0}
    ><div class="empty-row">No commits yet. Your first commit will show up here.</div></Section
  >
{:else if !commits}
  <RelayLoading say="Reading the history" mood="thinking" />
{:else}
  <Section id="g-hist" title="History" count={commits.length}>
    <div class="tools">
      <div class="scope">
        <span class="lbl" id="h-scope">Show</span>
        <div class="seg" role="radiogroup" aria-labelledby="h-scope">
          <button
            class:on={!all}
            role="radio"
            aria-checked={!all}
            onclick={() => {
              all = false;
              limit = PAGE;
            }}>On {st.branch || "this branch"}</button
          >
          <button
            class:on={all}
            role="radio"
            aria-checked={all}
            onclick={() => {
              all = true;
              limit = PAGE;
            }}>All branches</button
          >
        </div>
      </div>
      <!-- one search field: what to look for, and (inside it) where to look -->
      <div class="find">
        <Icon name="search" size={16} />
        <input
          type="search"
          bind:value={query}
          aria-label={mode === "code" ? "Find commits that added or removed this text" : "Find a commit"}
          placeholder={mode === "code" ? "Text added or removed, e.g. a function name" : "Message, author or commit id"}
          onkeydown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void deepSearch();
            }
            if (e.key === "Escape") query = "";
          }}
        />
        {#if query}<button type="button" class="clear" aria-label="Clear the search" onclick={() => (query = "")}
            ><Icon name="close" size={14} /></button
          >{/if}
        <div class="seg mini" role="radiogroup" aria-label="Search in">
          <button
            class:on={mode === "message"}
            role="radio"
            aria-checked={mode === "message"}
            title="Commit messages, authors and ids"
            onclick={() => setMode("message")}>Messages</button
          >
          <button
            class:on={mode === "code"}
            role="radio"
            aria-checked={mode === "code"}
            title="Commits that added or removed the text"
            onclick={() => setMode("code")}>Code</button
          >
        </div>
      </div>
      {#if q.length >= 2}<button class="btn small" onclick={deepSearch}
          ><Icon name="search" size={16} />{mode === "code" ? "Find in all code changes" : "Search all history"}</button
        >{/if}
    </div>

    {#if searching}
      <RelayLoading
        card={false}
        mood="thinking"
        say={mode === "code"
          ? `Finding the commits that added or removed “${query.trim()}”`
          : `Searching every commit for “${query.trim()}”`}
        sub={mode === "code" ? "This reads every change ever made, so it can take a moment." : ""}
      />
    {:else if found}
      <div class="found-head">
        <b
          >{found.length
            ? `${plural(found.length, "commit")}${found.length >= 200 ? "+" : ""} ${mode === "code" ? "added or removed" : "mention"} “${foundFor}”`
            : `No commit ${mode === "code" ? "added or removed" : "mentions"} “${foundFor}”`}</b
        >
        <button
          class="btn small ghost"
          onclick={() => {
            query = "";
            found = null;
          }}>Back to the full history</button
        >
      </div>
      <div class="h-rows searching" role="table" aria-label="Search results">
        {#each found as c, i (c.hash)}{@render row(c, i, false)}{/each}
      </div>
    {:else}
      <div class="h-scroll">
        <div
          class="h-rows"
          class:searching={!!q && mode === "message"}
          role="table"
          aria-label="Commits, newest first"
          style:--graph-w="{graphW}px"
        >
          <div class="h-row h-head" role="row">
            <span role="columnheader"></span><span role="columnheader">Author</span><span
              role="columnheader"
              class="h-commit">Commit</span
            >
            <span role="columnheader">Message</span><span role="columnheader" class="h-date">Date</span>
          </div>
          {#each shown as { c, i } (c.hash)}{@render row(c, i, true)}{/each}
        </div>
      </div>
      {#if q && mode === "message" && !shown.length}<div class="empty-row">
          No commit here matches. Press Enter to search the whole history.
        </div>{/if}
      {#if commits.length >= limit}<div class="older">
          <button class="btn small" onclick={() => (limit += PAGE)}>Show older commits</button>
        </div>{/if}
    {/if}
  </Section>
{/if}

<style lang="scss">
  @use "tokens" as *;
  @use "mixins" as *;

  .tools {
    display: flex;
    align-items: center;
    gap: space(3);
    flex-wrap: wrap;
    padding: 2px space(4) space(2) + 2;
  }
  .scope {
    display: flex;
    align-items: center;
    gap: space(2);
    // the same height as the search field beside it
    .seg {
      padding: 4px;
    }
  }
  .lbl {
    font-size: fs(sm);
    font-weight: $weight-semibold;
    color: var(--muted);
  }
  // the search field: icon, input, clear, and where to search, in one pill the same height as the toggles
  .find {
    display: flex;
    align-items: center;
    gap: space(2);
    flex: 1;
    min-width: 260px;
    max-width: 560px;
    height: 40px;
    padding: 0 3px 0 space(3) + 2;
    border: 1px solid var(--line);
    border-radius: $radius-pill;
    background: var(--card-solid);
    color: var(--muted);
    @include motion {
      transition:
        border-color $duration-fast,
        box-shadow $duration-fast;
    }
    &:focus-within {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px var(--accent-soft);
    }
    input {
      flex: 1;
      min-width: 0;
      border: 0;
      outline: 0;
      background: none;
      padding: 0;
      box-shadow: none;
      color: var(--text);
      font: inherit;
      font-size: 14px;
      &::-webkit-search-cancel-button {
        display: none;
      }
    }
  }
  .clear {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border: 0;
    border-radius: 50%;
    background: var(--card2);
    color: var(--muted);
    cursor: pointer;
    flex: none;
    &:hover {
      color: var(--text);
    }
  }
  .seg.mini {
    flex: none;
    padding: 2px;
    button {
      padding: space(1) space(2) + 2;
      font-size: 12.5px;
    }
  }
  .found-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: space(3);
    padding: space(2) space(4);
  }
  .older {
    padding: space(2) + 2 space(4) space(3) + 2;
  }
  .h-scroll {
    overflow-x: auto;
  }
  .h-rows {
    --graph-w: 34px;
    min-width: 640px;
  }
  .h-row {
    display: grid;
    grid-template-columns: var(--graph-w) minmax(130px, 200px) 84px minmax(0, 1fr) minmax(112px, 152px);
    align-items: center;
    column-gap: space(3) + 2;
    height: 44px;
    padding: 0 space(4) 0 space(1) + 2;
    cursor: pointer;
    border-radius: $radius-md;
    &:not(.h-head):hover,
    &:focus-visible {
      background: var(--accent-soft);
      outline: none;
    }
    &.is-head .h-subject {
      font-weight: $weight-bold;
    }
  }
  .h-head {
    height: 34px;
    cursor: default;
    font-size: fs(sm);
    font-weight: $weight-bold;
    color: var(--muted);
    border-bottom: 1px solid var(--line);
    border-radius: 0;
    margin-bottom: 2px;
  }
  .h-graph {
    height: 44px;
    display: block;
    overflow: visible;
  }
  .searching .h-graph :global(svg) {
    visibility: hidden;
  }
  .h-author {
    display: flex;
    align-items: center;
    gap: space(2) + 2;
    min-width: 0;
  }
  .h-name {
    @include ellipsis;
    font-size: 13.5px;
  }
  .h-commit {
    color: var(--accent);
    font-size: fs(sm);
  }
  .h-head .h-commit {
    color: inherit;
    font-size: inherit;
  }
  .h-msg {
    display: flex;
    align-items: center;
    gap: space(1) + 2;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    font-size: 13.5px;
  }
  .merged {
    flex: none;
  }
  .h-subject {
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 0 1 auto;
    min-width: 40px;
  }
  .h-note {
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1 1 0;
    min-width: 0;
  }
  .h-date {
    color: var(--muted);
    font-size: fs(sm);
    text-align: right;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  @include below(tablet) {
    .h-row {
      grid-template-columns: var(--graph-w) 28px minmax(0, 1fr) 96px;
    }
    .h-name,
    .h-commit {
      display: none;
    }
  }
</style>
