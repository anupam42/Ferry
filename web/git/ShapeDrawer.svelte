<script lang="ts">
  import ChangeStory from "../components/ChangeStory.svelte";
  import Drawer from "../components/Drawer.svelte";
  import Icon from "../components/Icon.svelte";
  import RelayLoading from "../components/RelayLoading.svelte";
  import { api, ApiError, face } from "../lib/api.ts";
  import { app, toast } from "../lib/app.svelte.ts";
  import { plural } from "../lib/format.ts";
  import { git } from "../lib/git.svelte.ts";
  import { cutsFromGap, filesOf, GAPS, groupsOf, opMark, span, suggestMessage } from "../lib/shape.ts";
  import type { FileDiff, ShapeResult, ShapeTimeline } from "../lib/types.ts";

  /**
   * Shape my history: the syncs Ferry recorded since the last commit, split
   * into commits where you paused. Name, join or split them, then create them.
   */
  const repo = git.current!;
  const st = git.state!;
  let t = $state<ShapeTimeline | null>(null);
  let error = $state("");
  let gap = $state(Number(localStorage.getItem("ferry-shape-gap") ?? 15));
  let cuts = $state(new Set<number>());
  const messages = $state<Record<string, string>>({}); // first batch id → what you typed
  let busy = $state(false);
  let writing = $state("");
  let preview = $state<{ key: string; path: string; d: FileDiff | null; error: string } | null>(null);

  async function load() {
    t = null;
    error = "";
    try {
      t = await api<ShapeTimeline>("GET", git.url("shape"));
      cuts = cutsFromGap(t.batches, gap);
    } catch (e) {
      error = (e as Error).message;
    }
  }
  $effect(() => {
    void load();
  });

  function setGap(v: number) {
    gap = v;
    localStorage.setItem("ferry-shape-gap", String(v));
    if (t) cuts = cutsFromGap(t.batches, v);
  }
  const B = $derived(t?.batches ?? []);
  const issueKey = $derived(
    app.conns?.jira.connected && localStorage.getItem("ferry-jira-prefix") !== "off"
      ? ((st.branch.match(/^([A-Z][A-Z0-9_]+-\d+)/) || [])[1] ?? "")
      : "",
  );
  const groups = $derived(
    groupsOf(B.length, cuts).map((idx) => {
      const files = filesOf(B, idx);
      const key = B[idx[0]!]!.id;
      return { idx, files, key, suggested: suggestMessage(files, issueKey) };
    }),
  );
  const total = $derived(new Set(B.flatMap((b) => b.files.map((f) => f.path))).size);
  const hhmm = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const dayAndClock = (iso: string) => {
    const d = new Date(iso);
    return (
      (d.toDateString() === new Date().toDateString()
        ? ""
        : d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }) + ", ") + hhmm(iso)
    );
  };
  const msgOf = (g: (typeof groups)[number]) => messages[g.key] ?? g.suggested;

  // cuts is replaced, never changed in place, so a plain Set is enough
  function split(i: number) {
    cuts = new Set([...cuts, i]);
  }
  function join(next: number) {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- a copy, changed before it replaces cuts
    const c = new Set(cuts);
    c.delete(next);
    cuts = c;
  }

  async function aiWrite(g: (typeof groups)[number]) {
    writing = g.key;
    try {
      messages[g.key] = (
        await api<{ message: string }>("POST", git.url("shape-message"), { batches: g.idx.map((i) => B[i]!.id) })
      ).message;
    } catch (e) {
      toast((e as Error).message, { error: true });
    }
    writing = "";
  }
  async function show(g: (typeof groups)[number], path: string) {
    if (preview?.key === g.key && preview.path === path) {
      preview = null;
      return;
    }
    const p = { key: g.key, path, d: null as FileDiff | null, error: "" };
    preview = p;
    try {
      const d = await api<FileDiff>("POST", git.url("shape-diff"), { batches: g.idx.map((i) => B[i]!.id), path });
      if (preview === p) preview = { ...p, d };
    } catch (e) {
      if (preview === p) preview = { ...p, error: (e as Error).message };
    }
  }

  async function create() {
    if (!t) return;
    const plan = groups.map((g) => ({ batches: g.idx.map((i) => B[i]!.id), message: msgOf(g).trim() }));
    const empty = plan.findIndex((p) => !p.message);
    if (empty >= 0) {
      toast(`Commit ${empty + 1} needs a message`, { error: true });
      return;
    }
    busy = true;
    try {
      const r = await api<ShapeResult>("POST", git.url("shape-commit"), { head: t.head, groups: plan });
      git.shaping = false;
      toast(
        `Made ${plural(r.commits.length, "commit")} on ${t.branch}` +
          (r.skipped ? ` (${r.skipped} step${r.skipped === 1 ? "" : "s"} added up to no change)` : ""),
        { mood: "party" },
      );
      await git.refresh();
    } catch (e) {
      busy = false;
      toast((e as Error).message, { error: true });
      if (e instanceof ApiError && e.code === "stale") void load(); // something changed underneath: start over from the new timeline
    }
  }
</script>

<Drawer title="Shape my history" sub="{repo.name} · on {st.branch}" wide onclose={() => (git.shaping = false)}>
  {#if error}<p class="muted">{error}</p>
  {:else if !t}<RelayLoading
      say="Replaying your work"
      mood="thinking"
      card={false}
      sub="Putting the syncs since your last commit in order."
    />
  {:else if !B.length}
    <div class="empty">
      <img class="float" src={face("happy")} alt="" />
      <h2>Nothing to shape.</h2>
      <p>I haven't synced anything into this repository since its last commit.</p>
    </div>
  {:else}
    <div class="narrator">
      <img src={face("excited")} alt="" />
      <div class="bubble" role="status">
        <div class="say">
          {plural(B.length, "sync")} between {dayAndClock(B[0]!.time)} and {hhmm(B[B.length - 1]!.time)}, touching {plural(
            total,
            "file",
          )}.
        </div>
        <div class="hint">
          {groups.length === 1
            ? "That's one commit for now. Pick a shorter pause, or split it yourself with ✂."
            : `I split them into ${plural(groups.length, "commit")} where you paused for ${gap >= 60 ? "an hour" : gap + " minutes"} or more. Name each one, join or split them, then create them.`}
        </div>
      </div>
    </div>
    <div class="gap">
      <span class="muted">Start a new commit after a pause of</span>
      <div class="seg" role="radiogroup" aria-label="Start a new commit after a pause of">
        {#each GAPS as [v, label] (v)}<button
            role="radio"
            class:on={gap === v}
            aria-checked={gap === v}
            onclick={() => setGap(v)}>{label}</button
          >{/each}
      </div>
    </div>
    <div class="list">
      {#each groups as g, gi (g.key)}
        {@const a = B[g.idx[0]!]!}
        {@const z = B[g.idx[g.idx.length - 1]!]!}
        <div class="card group">
          <div class="head">
            <span class="n">{gi + 1}</span>
            <div class="grow">
              <b>{g.idx.length === 1 ? hhmm(a.time) : `${hhmm(a.time)} – ${hhmm(z.time)}`}</b>
              <small
                >{plural(g.idx.length, "sync")} · {plural(g.files.length, "file")}{g.idx.length > 1
                  ? " · " + span(a.time, z.time)
                  : ""}</small
              >
            </div>
            {#if gi < groups.length - 1}<button
                class="btn small ghost"
                title="Make this and the next one a single commit"
                onclick={() => join(groups[gi + 1]!.idx[0]!)}>Join with next ↓</button
              >{/if}
          </div>
          <div class="msg">
            <input
              type="text"
              value={msgOf(g)}
              aria-label="Message for commit {gi + 1}"
              oninput={(e) => (messages[g.key] = e.currentTarget.value)}
            />
            {#if app.settings?.ai.configured}
              <button
                class="btn small"
                title="Claude reads what this step changed and writes a message"
                disabled={!!writing}
                onclick={() => aiWrite(g)}>{writing === g.key ? "Writing…" : "✨ Write it"}</button
              >
            {/if}
          </div>
          <div class="files">
            {#each g.files as f (f.path)}
              <button
                type="button"
                class="file {f.op}"
                class:on={preview?.key === g.key && preview.path === f.path}
                title={f.path}
                aria-pressed={preview?.key === g.key && preview.path === f.path}
                onclick={() => show(g, f.path)}
              >
                <i aria-hidden="true">{opMark(f.op)}</i>{f.path.split("/").pop()}</button
              >
            {/each}
          </div>
          {#if g.idx.length > 1}
            <details class="steps-box">
              <summary>The {g.idx.length} syncs in this commit</summary>
              <div class="steps">
                {#each g.idx as i, k (i)}
                  {#if k > 0}<button class="cut" title="Start a new commit here" onclick={() => split(i)}
                      >✂ split here</button
                    >{/if}
                  <div class="step">
                    <span class="mono">{hhmm(B[i]!.time)}</span><span
                      >{B[i]!.files.map((f) => opMark(f.op) + " " + (f.path.split("/").pop() ?? f.path)).join(
                        ", ",
                      )}</span
                    >
                  </div>
                {/each}
              </div>
            </details>
          {/if}
          {#if preview?.key === g.key}
            {@const name = preview.path.split("/").pop() ?? preview.path}
            <div class="preview">
              {#if preview.error}<p class="muted">{preview.error}</p>
              {:else if !preview.d}<RelayLoading say="Comparing {name}" mood="comparing" card={false} />
              {:else}{#key preview.path}<ChangeStory d={preview.d} file={name} />{/key}{/if}
            </div>
          {/if}
        </div>
      {/each}
    </div>
    {#if t.unrecorded.length}
      <div class="callout amber">
        {plural(t.unrecorded.length, "other changed file")}
        {t.unrecorded.length === 1 ? "wasn't" : "weren't"} synced by Ferry ({t.unrecorded.slice(0, 3).join(", ")}{t
          .unrecorded.length > 3
          ? "…"
          : ""}). {t.unrecorded.length === 1 ? "It stays" : "They stay"} uncommitted for you to commit as usual.
      </div>
    {/if}
  {/if}
  {#snippet foot()}
    <span class="muted left note"
      >Your files don't change. Commits get the time you did the work. Commit hooks don't run.</span
    >
    <button class="btn ghost" onclick={() => (git.shaping = false)}>Cancel</button>
    {#if t && B.length}<button class="btn brand" disabled={busy} onclick={create}
        ><Icon name="commit" size={16} />{busy
          ? "Creating…"
          : `Create ${plural(groups.length, "commit")} on ${t.branch}`}</button
      >{/if}
  {/snippet}
</Drawer>

<style lang="scss">
  @use "tokens" as *;
  @use "mixins" as *;
  .note {
    font-size: fs(sm);
  }
  .gap {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: space(3);
    flex-wrap: wrap;
    margin: space(1) 0 space(3) + 2;
    font-size: 13px;
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: space(3);
  }
  .group {
    padding: space(3) + 2 space(4);
  }
  .head {
    display: flex;
    align-items: center;
    gap: space(3);
    .grow {
      flex: 1;
      min-width: 0;
    }
    b {
      display: block;
      font-size: 14px;
    }
    small {
      display: block;
      color: var(--muted);
      font-size: 12px;
    }
  }
  .n {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    flex: none;
    @include brand-gradient;
    color: #fff;
    font-weight: $weight-heavy;
    font-size: 13px;
  }
  .msg {
    display: flex;
    gap: space(2);
    align-items: center;
    margin: space(3) 0 space(2) + 2;
    input {
      flex: 1;
    }
  }
  .files {
    display: flex;
    flex-wrap: wrap;
    gap: space(1) + 2;
  }
  .file {
    display: inline-flex;
    align-items: center;
    gap: space(1) + 2;
    padding: space(1) space(2) + 2;
    border: 1px solid var(--line);
    border-radius: $radius-pill;
    background: var(--card-solid);
    color: var(--text);
    font-size: 12.5px;
    cursor: pointer;
    i {
      font-style: normal;
      font-weight: $weight-heavy;
    }
    &.add i {
      color: var(--green);
    }
    &.delete i {
      color: var(--red);
    }
    &.update i {
      color: var(--amber);
    }
    &:hover,
    &.on {
      border-color: var(--accent);
    }
    &.on {
      background: var(--accent-soft);
    }
  }
  .steps-box {
    margin-top: space(2) + 2;
    font-size: 12.5px;
    summary {
      cursor: pointer;
      color: var(--muted);
    }
  }
  .steps {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-top: space(2);
    padding-left: space(1);
    border-left: 2px solid var(--line);
  }
  .step {
    display: flex;
    gap: space(2) + 2;
    padding: 3px space(2) + 2;
    .mono {
      color: var(--muted);
      min-width: 64px;
    }
  }
  .cut {
    align-self: flex-start;
    margin-left: space(2);
    padding: 1px space(2);
    border: 1px dashed var(--line);
    border-radius: $radius-pill;
    background: none;
    color: var(--muted);
    font-size: 11.5px;
    cursor: pointer;
    &:hover {
      color: var(--accent);
      border-color: var(--accent);
    }
  }
  .preview {
    margin-top: space(3);
    padding-top: space(3);
    border-top: 1px solid var(--line);
  }
  .callout {
    margin: space(3) + 2 0 0;
  }
</style>
