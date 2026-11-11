<script lang="ts">
  import Drawer from "../components/Drawer.svelte";
  import Icon from "../components/Icon.svelte";
  import Markdown from "../components/Markdown.svelte";
  import RelayLoading from "../components/RelayLoading.svelte";
  import Section from "../components/Section.svelte";
  import { api, ApiError } from "../lib/api.ts";
  import { app, toast } from "../lib/app.svelte.ts";
  import { ago, plural } from "../lib/format.ts";
  import { git } from "../lib/git.svelte.ts";
  import { htmlToText } from "../lib/markdown.ts";
  import type { Conversation, ReviewComment, ReviewThread } from "../lib/types.ts";
  import Avatar from "./Avatar.svelte";
  import Composer from "./Composer.svelte";

  /** One pull request's description, reviews, comments and line comments; reply, comment, resolve or reopen. */
  const { pr: p, provider } = git.pr!;
  const word = provider === "GitLab" ? "merge request" : "pull request";
  let conv = $state<Conversation | null>(null);
  let error = $state<{ msg: string; code: string } | null>(null);
  let filter = $state<"open" | "resolved" | "all">("open");
  // unsent text per thread ("new" for a general comment): survives reloads
  const drafts = $state<Record<string, string>>({ new: "" });

  async function load() {
    try {
      const c = await api<Conversation>("GET", git.url("pr-conversation") + "?number=" + p.number);
      for (const t of c.threads) drafts[t.id] ??= "";
      conv = c;
      error = null;
    } catch (e) {
      error = { msg: (e as Error).message, code: e instanceof ApiError ? e.code : "" };
    }
  }
  $effect(() => {
    void load();
  });

  async function send(action: string, payload: Record<string, unknown>, ok: string, after?: () => Promise<void>) {
    try {
      await api("POST", git.url(action), { number: p.number, ...payload });
      if (after) await after();
      toast(ok, { mood: "happy" });
      await load();
    } catch (e) {
      toast((e as Error).message, { error: true });
    }
  }
  const reply = (t: ReviewThread, resolve: boolean) =>
    send("pr-reply", { thread: t.id, body: drafts[t.id] }, resolve ? "Replied and resolved" : "Replied", async () => {
      drafts[t.id] = "";
      if (resolve)
        await api("POST", git.url("pr-resolve"), { number: p.number, thread: t.id, resolved: true }).catch((e) =>
          toast("Replied, but couldn't resolve: " + (e as Error).message, { error: true }),
        );
    });

  const open = $derived(conv?.threads.filter((t) => !t.resolved) ?? []);
  const done = $derived(conv?.threads.filter((t) => t.resolved) ?? []);
  const shown = $derived(filter === "open" ? open : filter === "resolved" ? done : (conv?.threads ?? []));
  // grouped by file; discussions without a file last
  const threads = $derived(
    [...shown].sort((a, b) => (a.path || "￿").localeCompare(b.path || "￿") || (a.line || 0) - (b.line || 0)),
  );
  // where each reviewer landed: their latest verdict
  const verdicts = $derived.by(() => {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- built and read inside this derived value, never stored
    const v = new Map<string, string>();
    for (const r of conv?.reviews ?? [])
      if (r.state === "APPROVED" || r.state === "CHANGES_REQUESTED") v.set(r.author, r.state);
    return {
      approved: [...v].filter(([, s]) => s === "APPROVED").map(([a]) => a),
      changes: [...v].filter(([, s]) => s === "CHANGES_REQUESTED").map(([a]) => a),
    };
  });
  type Item =
    { kind: "c"; date: string; c: ReviewComment } | { kind: "r"; date: string; r: Conversation["reviews"][number] };
  const timeline = $derived<Item[]>(
    !conv
      ? []
      : [
          ...conv.comments.map((c): Item => ({ kind: "c", date: c.date, c })),
          ...conv.reviews
            .filter((r) => r.body || r.state !== "COMMENTED")
            .map((r): Item => ({ kind: "r", date: r.date, r })),
        ].sort((a, b) => (Date.parse(a.date) || 0) - (Date.parse(b.date) || 0)),
  );
  const REV: Record<string, [string, string, string]> = {
    APPROVED: ["approved", "green", "check"],
    CHANGES_REQUESTED: ["asked for changes", "red", "undo"],
    COMMENTED: ["reviewed", "blue", "list"],
    DISMISSED: ["review dismissed", "muted", "close"],
  };
  const isOpen = $derived(!!conv && ["OPEN", "OPENED", "ACTIVE"].includes(conv.state));
</script>

{#snippet bubble(c: ReviewComment)}
  <div class="c" class:mine={c.mine}>
    <Avatar author={c.author} />
    <div class="main">
      <div class="who">
        <b>{c.author}</b>{#if c.mine}<span class="pill blue">you</span>{/if}<span
          class="muted"
          title={new Date(c.date).toLocaleString()}>{ago(c.date)}</span
        >
      </div>
      <div class="text"><Markdown text={htmlToText(c.body) || "_(no text)_"} /></div>
    </div>
  </div>
{/snippet}

<Drawer title="#{p.number} {p.title}" sub="{p.branch} → {p.base}" wide onclose={() => (git.pr = null)}>
  {#if error}
    <div class="empty-row">{error.msg}</div>
    {#if ["not-connected", "auth"].includes(error.code)}<div class="center">
        <button class="btn small brand" onclick={() => (app.connectionsOpen = true)}
          ><Icon name="plug" size={16} />Open Connections</button
        >
      </div>{/if}
  {:else if !conv}
    <RelayLoading
      say="Reading the conversation"
      card={false}
      mood="thinking"
      sub="Reviews, comments, and the code they point at."
    />
  {:else}
    <div class="sum">
      <span class="pill" class:green={isOpen} class:violet={conv.state === "MERGED"}>{conv.state.toLowerCase()}</span>
      <span class="muted">by {conv.author}</span>
      {#if verdicts.approved.length}<span class="pill green">✓ approved by {verdicts.approved.join(", ")}</span>{/if}
      {#if verdicts.changes.length}<span class="pill red">changes asked by {verdicts.changes.join(", ")}</span>{/if}
      {#if open.length}<span class="pill amber">{plural(open.length, "open thread")}</span
        >{:else if conv.threads.length}<span class="pill green">all threads resolved</span>{/if}
      <span class="grow"></span>
      <button class="btn small ghost" onclick={load}><Icon name="sync" size={16} />Refresh</button>
    </div>
    {#if conv.body}<details class="desc">
        <summary>Description</summary><Markdown text={htmlToText(conv.body)} />
      </details>{/if}

    <Section id="pr-threads" title="Line comments" count={open.length || null}>
      {#if conv.threads.length}
        <div class="filter">
          <div class="seg" role="radiogroup" aria-label="Which line comments">
            {#each [["open", `Open (${open.length})`], ["resolved", `Resolved (${done.length})`], ["all", `All (${conv.threads.length})`]] as const as [v, label] (v)}
              <button class:on={filter === v} role="radio" aria-checked={filter === v} onclick={() => (filter = v)}
                >{label}</button
              >
            {/each}
          </div>
        </div>
      {/if}
      {#if threads.length}
        <div class="threads">
          {#each threads as t (t.id)}
            <div class="card thread" class:resolved={t.resolved}>
              <div class="t-head">
                {#if t.path}
                  <button
                    type="button"
                    class="where"
                    title="Open this file (your current copy)"
                    onclick={() => (git.file = t.path)}
                    ><Icon name="files" size={15} /><span class="mono"
                      ><bdi>{t.path}{t.line ? ":" + t.line : ""}</bdi></span
                    ></button
                  >
                {:else}<span class="where plain"><Icon name="list" size={15} />Discussion</span>{/if}
                {#if t.outdated}<span class="pill amber" title="The code changed after this comment">outdated</span
                  >{/if}
                {#if t.resolved}<span class="pill green">resolved</span>{/if}
                <span class="grow"></span>
                {#if t.canResolve}
                  <button
                    class="btn small ghost"
                    onclick={() =>
                      send(
                        "pr-resolve",
                        { thread: t.id, resolved: !t.resolved },
                        t.resolved ? "Reopened the thread" : "Resolved",
                      )}
                  >
                    {#if t.resolved}Reopen{:else}<Icon name="check" size={16} />Resolve{/if}</button
                  >
                {/if}
              </div>
              {#if t.snippet.length}
                <div class="snip mono">
                  {#each t.snippet as s, i (i)}
                    <div class="sl {s.op === '+' ? 'add' : s.op === '-' ? 'del' : 'ctx'}" class:target={s.target}>
                      <span class="no">{s.no ?? ""}</span><span class="op"
                        >{s.op === " " ? "" : s.op === "-" ? "−" : "+"}</span
                      ><span class="tx">{s.text || " "}</span>
                    </div>
                  {/each}
                </div>
              {/if}
              <div class="cs">
                {#each t.comments as c (c.id)}{@render bubble(c)}{/each}
              </div>
              <Composer
                bind:text={drafts[t.id]}
                placeholder="Reply…"
                actions={[
                  ...(t.canResolve && !t.resolved ? [{ label: "Reply & resolve", run: () => reply(t, true) }] : []),
                  { label: "Reply", primary: true, run: () => reply(t, false) },
                ]}
              />
            </div>
          {/each}
        </div>
      {:else}
        <div class="empty-row">
          {conv.threads.length
            ? filter === "open"
              ? "Every thread is resolved. 🎉"
              : "Nothing here."
            : `No line comments on this ${word} yet.`}
        </div>
      {/if}
    </Section>

    <Section id="pr-convo" title="Conversation" count={timeline.length}>
      <div class="convo">
        {#each timeline as e, i (i)}
          {#if e.kind === "c"}{@render bubble(e.c)}
          {:else}
            {@const rv = REV[e.r.state] ?? REV.COMMENTED!}
            <div class="review">
              <span class="rv {rv[1]}"><Icon name={rv[2]} size={15} /></span>
              <div class="main">
                <div class="who">
                  <b>{e.r.author}</b><span>{rv[0]}</span>{#if e.r.date}<span class="muted">{ago(e.r.date)}</span>{/if}
                </div>
                {#if e.r.body}<div class="text"><Markdown text={htmlToText(e.r.body)} /></div>{/if}
              </div>
            </div>
          {/if}
        {:else}
          <div class="empty-row">No comments yet.</div>
        {/each}
        <Composer
          bind:text={drafts["new"]}
          placeholder="Add a comment…"
          actions={[
            {
              label: "Comment",
              primary: true,
              run: () =>
                send("pr-comment", { subject: conv!.subjectId, body: drafts["new"] }, "Comment added", async () => {
                  drafts["new"] = "";
                }),
            },
          ]}
        />
      </div>
    </Section>
  {/if}
  {#snippet foot()}
    <a class="btn small left" href={p.url} target="_blank" rel="noopener noreferrer">Open on {provider}</a>
    <button class="btn small" onclick={() => (git.pr = null)}>Close</button>
  {/snippet}
</Drawer>

<style lang="scss">
  @use "tokens" as *;
  @use "mixins" as *;

  .center {
    text-align: center;
  }
  .sum {
    display: flex;
    align-items: center;
    gap: space(2);
    flex-wrap: wrap;
    margin-bottom: space(3);
    .grow {
      flex: 1;
    }
  }
  .desc {
    margin-bottom: space(3);
    padding: space(2) + 2 space(4);
    border-radius: $radius-md;
    background: var(--card2);
    summary {
      cursor: pointer;
      font-weight: $weight-semibold;
      margin-bottom: space(2);
    }
  }
  .filter {
    padding: 0 space(3) space(2);
  }
  .threads {
    display: flex;
    flex-direction: column;
    gap: space(3);
    padding: 0 space(2) space(2);
  }
  .thread {
    padding: space(3) space(3) + 2;
    &.resolved {
      opacity: 0.75;
    }
  }
  .t-head {
    display: flex;
    align-items: center;
    gap: space(2);
    margin-bottom: space(2);
    .grow {
      flex: 1;
    }
  }
  .where {
    display: inline-flex;
    align-items: center;
    gap: space(1) + 2;
    border: 0;
    background: none;
    color: var(--accent);
    cursor: pointer;
    padding: 0;
    min-width: 0;
    font-size: fs(sm);
    span {
      @include ellipsis;
    }
    &.plain {
      color: var(--muted);
      cursor: default;
    }
  }
  .snip {
    font-size: 12px;
    border-radius: $radius-sm;
    overflow: hidden;
    border: 1px solid var(--line);
    margin-bottom: space(2);
  }
  .sl {
    display: grid;
    grid-template-columns: 44px 18px 1fr;
    .no {
      color: var(--faint);
      text-align: right;
      padding-right: space(2);
    }
    .op {
      text-align: center;
    }
    .tx {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      padding-right: space(2);
    }
    &.add {
      background: var(--ins);
      color: var(--ins-text);
    }
    &.del {
      background: var(--del);
      color: var(--del-text);
    }
    &.ctx {
      color: var(--muted);
    }
    &.target {
      box-shadow: inset 3px 0 0 var(--accent);
      font-weight: $weight-semibold;
    }
  }
  .cs,
  .convo {
    display: flex;
    flex-direction: column;
    gap: space(3);
  }
  .convo {
    padding: 0 space(3) space(3);
  }
  .c,
  .review {
    display: flex;
    gap: space(2) + 2;
    align-items: flex-start;
  }
  .c.mine .main {
    background: var(--accent-soft);
  }
  .main {
    flex: 1;
    min-width: 0;
    padding: space(2) space(3);
    border-radius: $radius-md;
    background: var(--card2);
  }
  .review .main {
    background: none;
    padding: 0 space(1);
  }
  .who {
    display: flex;
    align-items: center;
    gap: space(2);
    font-size: 13px;
    margin-bottom: 2px;
  }
  .text {
    font-size: 13.5px;
    :global(.md p:last-child) {
      margin-bottom: 0;
    }
  }
  .rv {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    flex: none;
    &.green {
      background: var(--green-soft);
      color: var(--green);
    }
    &.red {
      background: var(--red-soft);
      color: var(--red);
    }
    &.blue {
      background: var(--accent-soft);
      color: var(--accent);
    }
    &.muted {
      background: var(--card2);
      color: var(--faint);
    }
  }
</style>
