<script lang="ts">
  import Drawer from "../components/Drawer.svelte";
  import Icon from "../components/Icon.svelte";
  import RelayLoading from "../components/RelayLoading.svelte";
  import { api, ApiError, enc, face } from "../lib/api.ts";
  import { ask, toast } from "../lib/app.svelte.ts";
  import { ago, plural } from "../lib/format.ts";
  import { git } from "../lib/git.svelte.ts";
  import type { RewriteCommit, RewritePlan, RewriteStep } from "../lib/types.ts";

  /**
   * Rewrite recent commits (an interactive rebase): reorder them, reword,
   * squash one into the commit above it, or drop it. They're replayed from the
   * top of the list down. Undo anything can take you back afterwards.
   */
  type Act = "pick" | "reword" | "squash" | "drop";
  const from = git.rewrite!;
  let plan = $state<RewritePlan | null>(null);
  let error = $state("");
  let order = $state<string[]>([]);
  const acts = $state<Record<string, Act>>({});
  const edited = $state<Record<string, string>>({});
  let busy = $state(false);

  $effect(() => {
    api<RewritePlan>("GET", git.url("rewrite-plan") + "?from=" + enc(from)).then(
      (p) => {
        plan = p;
        order = p.commits.map((c) => c.hash);
        for (const c of p.commits) acts[c.hash] = "pick";
      },
      (e) => (error = (e as Error).message),
    );
  });
  const byHash = $derived(new Map((plan?.commits ?? []).map((c) => [c.hash, c])));
  const rows = $derived(order.map((h) => byHash.get(h)!).filter(Boolean));

  /** the commits squashed into the kept one at row i (the squashes right after it, skipping drops) */
  function squashedInto(i: number): RewriteCommit[] {
    const out: RewriteCommit[] = [];
    for (let j = i + 1; j < rows.length; j++) {
      const a = acts[rows[j]!.hash];
      if (a === "squash") out.push(rows[j]!);
      else if (a !== "drop") break;
    }
    return out;
  }
  /** the message the kept commit at row i ends up with: yours, or its own plus what's squashed into it */
  function messageOf(i: number): string {
    const c = rows[i]!;
    if (edited[c.hash] !== undefined) return edited[c.hash]!;
    return [c.message, ...squashedInto(i).map((s) => s.message)].join("\n\n");
  }
  const firstKept = $derived(rows.findIndex((c) => acts[c.hash] !== "drop"));

  function move(i: number, by: number) {
    const j = i + by;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j]!, next[i]!];
    order = next;
  }
  function setAct(c: RewriteCommit, a: Act) {
    acts[c.hash] = a;
    if (a !== "reword") delete edited[c.hash];
  }

  const changed = $derived(
    !!plan &&
      (order.some((h, i) => h !== plan!.commits[i]!.hash) ||
        rows.some((c, i) => acts[c.hash] !== "pick" || squashedInto(i).length > 0)),
  );
  const result = $derived(rows.filter((c) => acts[c.hash] === "pick" || acts[c.hash] === "reword").length);
  const dropped = $derived(rows.filter((c) => acts[c.hash] === "drop").length);
  const squashed = $derived(rows.filter((c) => acts[c.hash] === "squash").length);
  const problem = $derived(
    firstKept < 0
      ? "That would drop every commit. Keep at least one."
      : rows[firstKept] && acts[rows[firstKept]!.hash] === "squash"
        ? "The first commit you keep has nothing above it to be squashed into."
        : rows.some((c, i) => acts[c.hash] === "reword" && !messageOf(i).trim())
          ? "A commit message can't be empty."
          : "",
  );
  const pushedTouched = $derived(rows.filter((c) => c.pushed).length);

  async function apply() {
    if (!plan || problem) return;
    const steps: RewriteStep[] = rows.map((c, i) => {
      const a = acts[c.hash]!;
      if (a === "drop" || a === "squash") return { hash: c.hash, action: a };
      const custom = a === "reword" || squashedInto(i).length > 0;
      return custom ? { hash: c.hash, action: "pick", message: messageOf(i) } : { hash: c.hash, action: "pick" };
    });
    if (pushedTouched) {
      const ok = await ask({
        mood: "worried",
        hold: true,
        title: `Rewrite ${plural(pushedTouched, "commit")} that ${pushedTouched === 1 ? "is" : "are"} already on the remote?`,
        text: "Anyone who pulled them will have a different history from yours, and pushing afterwards needs a force push. Undo anything can still take you back.",
        yes: "Rewrite them",
        no: "Cancel",
        yesMood: "sad",
      });
      if (!ok) return;
    }
    busy = true;
    try {
      const r = await api<{ commits: number; stopped: boolean; changed: boolean }>("POST", git.url("rewrite"), {
        from: plan.from,
        head: plan.head,
        steps,
      });
      git.rewrite = null;
      if (r.stopped)
        toast("Paused on a conflict. Settle it under Changes, then continue (or cancel to go back).", {
          mood: "worried",
        });
      else
        toast(`Rewrote ${plan.branch}: ${plural(r.commits, "commit")}. Undo anything can take you back.`, {
          mood: "party",
        });
      git.bump++;
      await git.refresh();
    } catch (e) {
      toast((e as Error).message, { error: true });
      if (e instanceof ApiError && e.code === "stale") git.rewrite = null;
    } finally {
      busy = false;
    }
  }
  const ACTS: [Act, string, string][] = [
    ["pick", "Keep", "Keep it as it is"],
    ["reword", "Reword", "Keep it, with a new message"],
    ["squash", "Squash ↑", "Fold it into the commit above"],
    ["drop", "Drop", "Leave it out"],
  ];
</script>

<Drawer
  title="Rewrite commits"
  sub={plan ? `${plural(plan.commits.length, "commit")} on ${plan.branch}` : ""}
  wide
  onclose={() => (git.rewrite = null)}
>
  {#if error}<p class="muted">{error}</p>
  {:else if !plan}<RelayLoading say="Reading the commits" mood="thinking" card={false} />
  {:else if plan.blocked}
    <div class="narrator">
      <img src={face("thinking")} alt="" />
      <div class="bubble">
        <div class="say">This can't be rewritten right now.</div>
        <div class="hint">{plan.blocked}</div>
      </div>
    </div>
  {:else}
    <div class="narrator">
      <img src={face(pushedTouched ? "worried" : "excited")} alt="" />
      <div class="bubble">
        <div class="say">Reorder, reword, squash or drop.</div>
        <div class="hint">
          They're replayed from the top down, oldest first. Squash folds a commit into the one above it.
          {#if plan.dirty}Your uncommitted changes are set aside while it runs, and put back after.{/if}
        </div>
      </div>
    </div>
    {#if pushedTouched}
      <div class="callout amber">
        <Icon name="warn" size={16} />{plural(pushedTouched, "commit")} here {pushedTouched === 1 ? "is" : "are"} already
        on the remote. Rewriting {pushedTouched === 1 ? "it" : "them"} means force-pushing afterwards.
      </div>
    {/if}
    <ol class="rows">
      {#each rows as c, i (c.hash)}
        {@const a = acts[c.hash]}
        {@const into = a === "pick" || a === "reword" ? squashedInto(i) : []}
        <li class="row a-{a}">
          <div class="move">
            <button
              type="button"
              class="ib"
              aria-label="Move {c.subject} up"
              disabled={i === 0}
              onclick={() => move(i, -1)}>↑</button
            >
            <button
              type="button"
              class="ib"
              aria-label="Move {c.subject} down"
              disabled={i === rows.length - 1}
              onclick={() => move(i, 1)}>↓</button
            >
          </div>
          <div class="main">
            <div class="top">
              <span class="n">{i + 1}</span>
              <span class="subj">{c.subject}</span>
              {#if c.pushed}<span class="pill amber" title="Already on a remote">pushed</span>{/if}
              <span class="mono faint">{c.short}</span>
            </div>
            <small class="muted">{c.author} · {ago(c.date)}</small>
            {#if a === "squash"}<small class="what">folded into the commit above</small>{/if}
            {#if a === "drop"}<small class="what">left out</small>{/if}
            {#if a === "reword" || into.length}
              <label class="msg">
                <span class="muted"
                  >{into.length
                    ? `Message for this commit and the ${plural(into.length, "one")} squashed into it`
                    : "New message"}</span
                >
                <textarea
                  class="mono"
                  rows={Math.min(10, Math.max(2, messageOf(i).split("\n").length))}
                  value={messageOf(i)}
                  oninput={(e) => (edited[c.hash] = e.currentTarget.value)}></textarea>
              </label>
            {/if}
          </div>
          <div class="seg mini acts" role="radiogroup" aria-label="What to do with {c.subject}">
            {#each ACTS as [k, label, tip] (k)}
              <button role="radio" title={tip} class:on={a === k} aria-checked={a === k} onclick={() => setAct(c, k)}
                >{label}</button
              >
            {/each}
          </div>
        </li>
      {/each}
    </ol>
  {/if}
  {#snippet foot()}
    {#if plan && !plan.blocked}
      <span class="left muted">
        {#if problem}<span class="bad">{problem}</span>
        {:else if changed}{plural(plan.commits.length, "commit")} → {result}{#if squashed || dropped}&nbsp;({[
              squashed && `${squashed} squashed`,
              dropped && `${dropped} dropped`,
            ]
              .filter(Boolean)
              .join(", ")}){/if}
        {:else}No changes yet{/if}
      </span>
      <button class="btn small" onclick={() => (git.rewrite = null)}>Cancel</button>
      <button class="btn small brand" disabled={!changed || !!problem || busy} onclick={apply}
        >{busy ? "Rewriting…" : "Rewrite"}</button
      >
    {:else}
      <button class="btn small" onclick={() => (git.rewrite = null)}>Close</button>
    {/if}
  {/snippet}
</Drawer>

<style lang="scss">
  @use "tokens" as *;
  @use "mixins" as *;
  .callout {
    margin: 0 0 space(3);
  }
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: space(1) + 2;
  }
  .row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: space(3);
    align-items: start;
    padding: space(2) + 2 space(3);
    border-radius: $radius-md;
    background: var(--card2);
    border-left: 3px solid transparent;
    &.a-reword {
      border-left-color: var(--accent);
    }
    &.a-squash {
      border-left-color: var(--violet);
      margin-left: space(6);
    }
    &.a-drop {
      opacity: 0.55;
      .subj {
        text-decoration: line-through;
      }
    }
  }
  .move {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .ib {
    width: 26px;
    height: 22px;
    border: 0;
    border-radius: $radius-sm;
    background: var(--card-solid);
    color: var(--muted);
    cursor: pointer;
    font-size: 12px;
    &:disabled {
      opacity: 0.35;
      cursor: default;
    }
    &:hover:not(:disabled) {
      color: var(--accent);
    }
  }
  .main {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .top {
    display: flex;
    align-items: center;
    gap: space(2);
    min-width: 0;
  }
  .n {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    flex: none;
    background: var(--card-solid);
    color: var(--muted);
    font-size: 11px;
    font-weight: $weight-bold;
  }
  .subj {
    font-weight: $weight-semibold;
    font-size: 13.5px;
    @include ellipsis;
  }
  .faint {
    color: var(--faint);
    font-size: 12px;
    margin-left: auto;
  }
  small {
    font-size: 12px;
  }
  .what {
    color: var(--violet);
    font-weight: $weight-semibold;
  }
  .a-drop .what {
    color: var(--muted);
  }
  .msg {
    display: flex;
    flex-direction: column;
    gap: space(1);
    margin-top: space(2);
    font-size: 12px;
    textarea {
      width: 100%;
      font-size: 12.5px;
      resize: vertical;
    }
  }
  .acts {
    flex: none;
  }
  .bad {
    color: var(--red);
  }
  @include below(tablet) {
    .row {
      grid-template-columns: auto minmax(0, 1fr);
    }
    .acts {
      grid-column: 2;
    }
  }
</style>
