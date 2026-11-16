<script lang="ts">
  import Icon from "../components/Icon.svelte";
  import { ask, toast } from "../lib/app.svelte.ts";
  import { work } from "../lib/work.svelte.ts";
  import { duration, issueKey, type Block, type Meeting } from "../../src/shared/work.ts";

  /**
   * Editing one stretch of time. A timer entry (or one added or pinned before) changes in place,
   * splits, joins the one before it, goes to Jira, or goes away. An automatic block or a meeting is
   * saved as an entry of its own ("pinned"): from then on it covers that span the way a timer does,
   * so the automatic count steps aside there. With nothing given, it adds a forgotten entry.
   */
  let {
    block = null,
    meeting = null,
    day,
    prev = null,
    onclose,
  }: {
    block?: Block | null;
    meeting?: Meeting | null;
    day: string;
    /** the timer entry just before this one, to join with */
    prev?: Block | null;
    onclose: () => void;
  } = $props();

  const entry = $derived(
    block?.kind === "timer" ? (work.timer?.entries.find((e) => e.id === block!.id) ?? null) : null,
  );
  const hhmm = (t: number) => {
    const d = new Date(t);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };
  const at = (v: string) => Date.parse(`${day}T${v}:00`);
  // the form starts from what's there (read once: editing doesn't follow later changes)
  // svelte-ignore state_referenced_locally
  const init = {
    task:
      block?.task ||
      (block && block.kind === "auto" ? (block.commits.at(-1) ?? block.issue ?? "") : "") ||
      meeting?.title ||
      "",
    project: block?.repo ?? (work.projects[0] || ""),
    start: hhmm(block?.start ?? meeting?.start ?? Date.now() - 30 * 60_000),
    end: hhmm(block?.end ?? meeting?.end ?? Date.now()),
    billable: block?.billable ?? false,
  };
  let task = $state(init.task);
  let project = $state(init.project);
  let start = $state(init.start);
  let end = $state(init.end);
  let billable = $state(init.billable);
  let splitAt = $state("");
  const minutes = $derived((at(end) - at(start)) / 60_000);
  const key = $derived(issueKey(task) || block?.issue || "");
  const kind = $derived(entry ? "entry" : block ? "auto" : meeting ? "meeting" : "new");

  async function save(): Promise<string | null> {
    if (!(minutes > 0)) {
      toast("It has to end after it starts", { error: true });
      return null;
    }
    const body = { project, task, billable, start: at(start), end: at(end) };
    if (entry) return (await work.act("edit", { id: entry.id, ...body })) ? entry.id : null;
    const from = kind === "auto" ? "auto" : kind === "meeting" ? "meeting" : "added";
    if (!(await work.act("add", { ...body, from }))) return null;
    // the new entry: the one just added with this span
    return (
      work.timer?.entries.find((e) => e.start === body.start && e.end === body.end && e.project === project)?.id ?? null
    );
  }
  async function saveAndClose() {
    if (await save()) {
      toast(kind === "auto" ? "Pinned: it's an entry now" : kind === "new" || kind === "meeting" ? "Added" : "Saved");
      onclose();
    }
  }
  async function toJira() {
    if (!key) return;
    const id = await save();
    if (!id) return;
    if (await work.act("jira", { id, key })) {
      toast(`Logged ${duration(minutes)} on ${key}`, { mood: "party" });
      onclose();
    }
  }
  async function split() {
    if (!entry || !splitAt) return;
    if (await work.act("split", { id: entry.id, at: at(splitAt) })) onclose();
  }
  async function merge() {
    if (!entry || !prev) return;
    if (await work.act("merge", { ids: [prev.id, entry.id] })) onclose();
  }
  async function remove() {
    if (!entry) return;
    const ok = await ask({
      mood: "thinking",
      title: "Remove this entry?",
      text: `${duration(minutes)} on ${task || project}. Ferry's own count from your saves stays as it is.`,
      yes: "Remove it",
      no: "Keep it",
    });
    if (ok && (await work.act("delete", { id: entry.id }))) onclose();
  }
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && onclose()} />

<form
  class="editor"
  onsubmit={(e) => {
    e.preventDefault();
    void saveAndClose();
  }}
>
  {#if kind === "auto"}
    <p class="note muted">Ferry worked this out from your saves. Saving it pins it as an entry you can change.</p>
  {:else if kind === "meeting"}
    <p class="note muted">From your calendar. Log it to count it as time.</p>
  {/if}
  <div class="grid">
    <label class="wide"
      ><span>Task</span><input type="text" bind:value={task} placeholder="What it was (PROJ-12 …)" /></label
    >
    <label><span>Project</span><input type="text" list="time-projects-edit" bind:value={project} /></label>
    <datalist id="time-projects-edit">
      {#each work.projects as p (p)}<option value={p}></option>{/each}
    </datalist>
    <label><span>From</span><input type="time" bind:value={start} /></label>
    <label><span>To</span><input type="time" bind:value={end} /></label>
    <label class="check"><input type="checkbox" bind:checked={billable} /> Billable</label>
  </div>
  <div class="acts">
    <button type="submit" class="btn small brand" disabled={work.busy || !project.trim()}>
      {kind === "auto" ? "Pin it" : kind === "meeting" ? "Log it" : kind === "new" ? "Add" : "Save"}
      {minutes > 0 ? `· ${duration(minutes)}` : ""}
    </button>
    {#if entry?.jira}
      <span class="pill green" title="Sent to Jira">logged on {entry.jira.key}</span>
    {:else if key}
      <button type="button" class="btn small ghost" disabled={work.busy} onclick={toJira}
        ><Icon name="ticket" size={14} />Log on {key}</button
      >
    {/if}
    {#if entry}
      <span class="split">
        <input type="time" bind:value={splitAt} aria-label="Split at" />
        <button type="button" class="btn small ghost" disabled={work.busy || !splitAt} onclick={split}>Split</button>
      </span>
      {#if prev}
        <button
          type="button"
          class="btn small ghost"
          disabled={work.busy}
          onclick={merge}
          title="Join with “{prev.task || prev.repo}”">Join with the one before</button
        >
      {/if}
      <button type="button" class="btn small ghost danger" disabled={work.busy} onclick={remove}
        ><Icon name="trash" size={14} />Remove</button
      >
    {/if}
    <span class="grow"></span>
    <button type="button" class="btn small ghost" onclick={onclose}>Cancel</button>
  </div>
</form>

<style lang="scss">
  @use "tokens" as *;
  @use "mixins" as *;

  .editor {
    grid-column: 1 / -1;
    margin-top: space(2);
    padding-top: space(3);
    border-top: 1px dashed var(--line);
    display: flex;
    flex-direction: column;
    gap: space(3);
  }
  .note {
    margin: 0;
    font-size: 12px;
  }
  .grid {
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(0, 1.2fr) 110px 110px auto;
    gap: space(2);
    align-items: end;
    label {
      display: flex;
      flex-direction: column;
      gap: 3px;
      font-size: 11.5px;
      color: var(--muted);
      min-width: 0;
    }
    input[type="time"] {
      border: 1px solid var(--line);
      border-radius: $radius-md + 2;
      background: var(--card-solid);
      color: var(--text);
      padding: space(2) space(2);
      font: inherit;
      font-size: 13px;
    }
    .check {
      flex-direction: row;
      align-items: center;
      gap: 6px;
      padding-bottom: space(2);
      font-size: 13px;
      color: var(--text);
    }
  }
  .acts {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: space(2);
    .grow {
      flex: 1;
    }
    :global(svg) {
      margin-right: 4px;
    }
  }
  .split {
    display: inline-flex;
    gap: 4px;
    align-items: center;
    input {
      border: 1px solid var(--line);
      border-radius: $radius-md;
      background: var(--card-solid);
      color: var(--text);
      padding: 3px space(1);
      font: inherit;
      font-size: 12px;
    }
  }
  @include below(laptop) {
    .grid {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      .wide {
        grid-column: 1 / -1;
      }
    }
  }
</style>
