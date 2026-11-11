<script lang="ts">
  import Drawer from "../components/Drawer.svelte";
  import Icon from "../components/Icon.svelte";
  import RelayLoading from "../components/RelayLoading.svelte";
  import { api, face } from "../lib/api.ts";
  import { ago, plural } from "../lib/format.ts";
  import { git } from "../lib/git.svelte.ts";
  import type { BisectState, Commit } from "../lib/types.ts";

  /**
   * Find the commit that broke something (git bisect): say where it worked and
   * where it's broken, then test the commit halfway between and say which it is,
   * until only the first bad commit is left. Testing happens in your own editor or
   * terminal; this checks the commits out for you.
   */
  const start = git.bisect ?? {};
  let b = $state<BisectState | null>(null);
  let error = $state("");
  let busy = $state(false);
  $effect(() => {
    void git.bump;
    api<BisectState>("GET", git.url("bisect")).then(
      (r) => (b = r),
      (e) => (error = (e as Error).message),
    );
  });

  // starting: where it worked (a commit on this branch) and where it's broken (now, by default)
  let commits = $state<Commit[]>([]);
  $effect(() => {
    if (b && !b.active && !commits.length)
      api<Commit[]>("GET", git.url("log") + "?limit=80").then(
        (c) => (commits = c),
        () => (commits = []),
      );
  });
  let good = $state(start.good ?? "");
  let bad = $state("");
  const dirty = $derived((git.state?.files ?? []).some((f) => !f.untracked));
  const goodCommit = $derived(commits.find((c) => c.hash === good));

  async function act(action: string, body: Record<string, unknown>, ok: string) {
    busy = true;
    const r = await git.try<{ bisect?: BisectState }>(action, body, ok, "thinking");
    busy = false;
    if (r?.bisect) b = r.bisect;
  }
  const begin = () => act("bisect-start", { good, bad }, "Checked out the commit halfway between: test it");
  const mark = (verdict: "good" | "bad" | "skip") =>
    act(
      "bisect-mark",
      { verdict },
      verdict === "skip" ? "Skipped that one" : verdict === "good" ? "Marked as working" : "Marked as broken",
    );
  async function stop() {
    const branch = b?.branch.replace(/^refs\/heads\//, "") || "your branch";
    busy = true;
    const r = await git.try("bisect-reset", {}, `Back on ${branch}`, "happy");
    busy = false;
    if (r) git.bisect = null;
  }
  const back = $derived(b?.branch.replace(/^refs\/heads\//, "") || "your branch");
  const VERDICT = { good: ["works", "green"], bad: ["broken", "red"], skip: ["skipped", "muted"] } as const;
</script>

{#snippet commitCard(c: Commit, title: string)}
  <div class="card-c">
    <span class="lbl">{title}</span>
    <button type="button" class="c" onclick={() => (git.commit = c.hash)} title="See this commit">
      <b>{c.subject}</b>
      <small class="muted">{c.author} · {ago(c.date)} · <span class="mono">{c.short}</span></small>
    </button>
  </div>
{/snippet}

<Drawer title="Find the commit that broke it" sub="git bisect" wide onclose={() => (git.bisect = null)}>
  {#if error}<p class="muted">{error}</p>
  {:else if !b}<RelayLoading say="Looking" mood="thinking" card={false} />
  {:else if !b.active}
    <div class="narrator">
      <img src={face("thinking")} alt="" />
      <div class="bubble">
        <div class="say">Something worked before and is broken now?</div>
        <div class="hint">
          Pick a commit where it still worked. I'll check out the commit halfway between, you test it and tell me, and
          we halve the range again until only the first broken commit is left. A hundred commits take about seven tests.
        </div>
      </div>
    </div>
    {#if dirty}<div class="callout amber">
        <Icon name="warn" size={16} />Commit or stash your changes first: testing old commits checks them out over your
        work.
      </div>{/if}
    <label class="field">
      <span class="label">It worked at</span>
      <select bind:value={good} aria-label="A commit where it still worked">
        <option value="" disabled>Choose a commit…</option>
        {#if good && !goodCommit}<option value={good}>{good.slice(0, 7)}</option>{/if}
        {#each commits.slice(1) as c (c.hash)}<option value={c.hash}>{c.short} · {c.subject} ({ago(c.date)})</option
          >{/each}
      </select>
    </label>
    <label class="field">
      <span class="label">It's broken at</span>
      <select bind:value={bad} aria-label="A commit where it's broken">
        <option value="">Now (the latest commit)</option>
        {#each commits.slice(1) as c (c.hash)}<option value={c.hash}>{c.short} · {c.subject}</option>{/each}
      </select>
    </label>
  {:else if b.found}
    <div class="narrator">
      <img src={face("party")} alt="" />
      <div class="bubble" role="status">
        <div class="say">Found it.</div>
        <div class="hint">This is the first commit where it's broken. Every commit before it works.</div>
      </div>
    </div>
    {@render commitCard(b.found, "The first broken commit")}
  {:else}
    <div class="narrator">
      <img src={face("focused")} alt="" />
      <div class="bubble" role="status">
        <div class="say">Is it broken at this commit?</div>
        <div class="hint">
          I've checked it out: try it in your editor or terminal, then tell me.
          {plural(b.remaining, "commit")} left, about {plural(b.steps, "more test", "more tests")}.
        </div>
      </div>
    </div>
    {#if b.current}{@render commitCard(b.current, "Testing now")}{/if}
    <div class="verdicts">
      <button class="btn good" disabled={busy} onclick={() => mark("good")}
        ><Icon name="check" size={16} />It works</button
      >
      <button class="btn bad" disabled={busy} onclick={() => mark("bad")}
        ><Icon name="close" size={16} />It's broken</button
      >
      <button class="btn ghost" disabled={busy} onclick={() => mark("skip")}>Can't test this one</button>
    </div>
  {/if}

  {#if b?.active && b.marks.length}
    <h4>So far</h4>
    <ol class="marks">
      {#each b.marks as m, i (i)}
        <li>
          <span class="pill {VERDICT[m.verdict][1]}">{VERDICT[m.verdict][0]}</span><span class="mono faint"
            >{m.hash.slice(0, 7)}</span
          ><span class="s">{m.subject}</span>
        </li>
      {/each}
    </ol>
  {/if}

  {#snippet foot()}
    {#if b && !b.active}
      <button class="btn small" onclick={() => (git.bisect = null)}>Cancel</button>
      <button class="btn small brand" disabled={!good || dirty || busy} onclick={begin}>Start</button>
    {:else if b?.active}
      <span class="left muted">You're on a commit being tested, not on {back}.</span>
      <button class="btn small" class:brand={!!b.found} disabled={busy} onclick={stop}
        >{b.found ? `Done: back to ${back}` : `Stop and go back to ${back}`}</button
      >
    {/if}
  {/snippet}
</Drawer>

<style lang="scss">
  @use "tokens" as *;
  @use "mixins" as *;
  .callout {
    margin: 0 0 space(3);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: space(1);
    margin-bottom: space(3);
    select {
      width: 100%;
    }
  }
  .label {
    font-size: fs(sm);
    font-weight: $weight-semibold;
    color: var(--muted);
  }
  .card-c {
    display: flex;
    flex-direction: column;
    gap: space(1);
    margin-bottom: space(3) + 2;
  }
  .lbl {
    font-size: fs(sm);
    font-weight: $weight-semibold;
    color: var(--muted);
  }
  .c {
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 100%;
    padding: space(3) space(4);
    border: 1px solid var(--line);
    border-radius: $radius-md;
    background: var(--card-solid);
    color: var(--text);
    text-align: left;
    cursor: pointer;
    font-size: 14px;
    &:hover {
      border-color: var(--accent);
    }
    small {
      font-size: 12.5px;
    }
  }
  .verdicts {
    display: flex;
    gap: space(2);
    flex-wrap: wrap;
    margin-bottom: space(4);
    .good {
      background: var(--green-soft);
      color: var(--green);
    }
    .bad {
      background: var(--red-soft);
      color: var(--red);
    }
  }
  h4 {
    margin: space(2) 0 space(2);
    font-size: fs(sm);
    color: var(--muted);
    font-weight: $weight-semibold;
  }
  .marks {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: space(1);
    li {
      display: flex;
      align-items: center;
      gap: space(2);
      font-size: 13px;
      min-width: 0;
    }
    .s {
      @include ellipsis;
    }
  }
  .faint {
    color: var(--faint);
    font-size: 12px;
  }
</style>
