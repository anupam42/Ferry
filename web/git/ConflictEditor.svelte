<script lang="ts">
  import { plural } from "../lib/format.ts";
  import type { MergePart } from "../lib/types.ts";

  /**
   * A conflicted file, change by change: for each place the two sides disagree,
   * keep yours, theirs, both (in either order), or write it yourself. The text
   * around them is shown folded. `result` is the whole file as decided so far,
   * and `decided` how many of the changes have an answer.
   */
  let {
    parts,
    swapped = false,
    result = $bindable(""),
    decided = $bindable(0),
    total = $bindable(0),
  }: {
    parts: MergePart[];
    /** edits put back after a pull: git's "theirs" is your work, so "Mine" shows that side */
    swapped?: boolean;
    result?: string;
    decided?: number;
    total?: number;
  } = $props();

  type Pick = "mine" | "theirs" | "mine-theirs" | "theirs-mine" | "edit";
  const conflicts = $derived(parts.flatMap((p, i) => (p.kind === "conflict" ? [i] : [])));
  const picks = $state<Record<number, Pick | undefined>>({});
  const edits = $state<Record<number, string>>({});

  const mine = (p: Extract<MergePart, { kind: "conflict" }>) => (swapped ? p.theirs : p.ours);
  const theirs = (p: Extract<MergePart, { kind: "conflict" }>) => (swapped ? p.ours : p.theirs);
  /** two pieces one after the other, with a line break between when the first has none */
  const join = (a: string, b: string) => (a && b && !a.endsWith("\n") ? a + "\n" + b : a + b);
  function resolved(i: number): string | null {
    const p = parts[i]!;
    if (p.kind === "same") return p.text;
    switch (picks[i]) {
      case "mine":
        return mine(p);
      case "theirs":
        return theirs(p);
      case "mine-theirs":
        return join(mine(p), theirs(p));
      case "theirs-mine":
        return join(theirs(p), mine(p));
      case "edit":
        return edits[i] ?? "";
      default:
        return null;
    }
  }
  $effect(() => {
    total = conflicts.length;
    decided = conflicts.filter((i) => picks[i]).length;
    const pieces = parts.map((_, i) => resolved(i));
    result = pieces.every((x) => x !== null) ? pieces.join("") : "";
  });

  function pick(i: number, how: Pick) {
    picks[i] = how;
    if (how === "edit" && edits[i] === undefined) {
      const p = parts[i] as Extract<MergePart, { kind: "conflict" }>;
      edits[i] = join(mine(p), theirs(p));
    }
  }

  // the text between changes, folded to a few lines of context on each side
  const CONTEXT = 3;
  function fold(text: string, first: boolean, last: boolean) {
    const lines = text.replace(/\n$/, "").split("\n");
    const keepTop = first ? 0 : CONTEXT,
      keepEnd = last ? 0 : CONTEXT;
    if (lines.length <= keepTop + keepEnd + 1) return { top: lines, hidden: 0, end: [] as string[] };
    return {
      top: lines.slice(0, keepTop),
      hidden: lines.length - keepTop - keepEnd,
      end: lines.slice(lines.length - keepEnd),
    };
  }
  const CHOICES: [Pick, string][] = [
    ["mine", "Keep mine"],
    ["theirs", "Keep theirs"],
    ["mine-theirs", "Both, mine first"],
    ["theirs-mine", "Both, theirs first"],
    ["edit", "Edit"],
  ];
  const WORD: Record<Pick, string> = {
    mine: "kept mine",
    theirs: "kept theirs",
    "mine-theirs": "both, mine first",
    "theirs-mine": "both, theirs first",
    edit: "edited",
  };
</script>

{#snippet code(text: string, cls = "")}
  <pre class="code mono {cls}">{text.replace(/\n$/, "") || " "}</pre>
{/snippet}

<div class="parts">
  {#each parts as p, i (i)}
    {#if p.kind === "same"}
      {@const f = fold(p.text, i === 0, i === parts.length - 1)}
      <div class="same mono">
        {#if f.top.length}<pre>{f.top.join("\n")}</pre>{/if}
        {#if f.hidden}<div class="gap">{plural(f.hidden, "unchanged line")}</div>{/if}
        {#if f.end.length}<pre>{f.end.join("\n")}</pre>{/if}
      </div>
    {:else}
      {@const n = conflicts.indexOf(i) + 1}
      <section class="conflict" class:done={!!picks[i]} id="conflict-{n}" aria-label="Change {n} of {conflicts.length}">
        <header>
          <b>Change {n} of {conflicts.length}</b>
          {#if picks[i]}<span class="pill green">✓ {WORD[picks[i]!]}</span>{:else}<span class="pill amber"
              >not decided</span
            >{/if}
        </header>
        <div class="sides">
          <div class="side">
            <span class="who mine-c">Mine</span>
            {@render code(mine(p), "mine")}
          </div>
          <div class="side">
            <span class="who theirs-c">Theirs</span>
            {@render code(theirs(p), "theirs")}
          </div>
        </div>
        {#if p.base}
          <details class="base">
            <summary>What it was before both changes</summary>
            {@render code(p.base)}
          </details>
        {/if}
        <div class="choices" role="radiogroup" aria-label="Change {n}: keep">
          {#each CHOICES as [how, label] (how)}
            <button
              type="button"
              role="radio"
              class="btn small"
              class:brand={picks[i] === how}
              aria-checked={picks[i] === how}
              onclick={() => pick(i, how)}>{label}</button
            >
          {/each}
        </div>
        {#if picks[i] === "edit"}
          <textarea
            class="mono"
            rows={Math.min(14, Math.max(3, (edits[i] ?? "").split("\n").length + 1))}
            bind:value={edits[i]}
            aria-label="Change {n}, as you want it"></textarea>
        {/if}
      </section>
    {/if}
  {/each}
</div>

<style lang="scss">
  @use "tokens" as *;
  .parts {
    display: flex;
    flex-direction: column;
    gap: space(2);
  }
  pre {
    margin: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .same {
    font-size: 12.5px;
    color: var(--muted);
    padding: 0 space(3);
  }
  .gap {
    margin: space(1) 0;
    padding: 2px space(2);
    border-radius: $radius-sm;
    background: var(--card2);
    color: var(--faint);
    font-family: inherit;
    font-size: 11.5px;
    text-align: center;
  }
  .conflict {
    padding: space(3) space(3) + 2;
    border: 2px solid var(--amber-soft);
    border-radius: $radius-lg;
    background: var(--card-solid);
    scroll-margin-top: space(4);
    &.done {
      border-color: var(--green-soft);
    }
  }
  header {
    display: flex;
    align-items: center;
    gap: space(2);
    margin-bottom: space(2) + 2;
    font-size: 13.5px;
  }
  .sides {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: space(2);
  }
  .side {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: space(1);
  }
  .who {
    font-size: 12px;
    font-weight: $weight-bold;
    &.mine-c {
      color: var(--accent);
    }
    &.theirs-c {
      color: var(--violet);
    }
  }
  .code {
    font-size: 12.5px;
    line-height: 1.55;
    padding: space(2) space(3);
    border-radius: $radius-sm;
    background: var(--card2);
    min-height: 2.2em;
    &.mine {
      background: var(--accent-soft);
    }
    &.theirs {
      background: var(--violet-soft);
    }
  }
  .base {
    margin-top: space(2);
    summary {
      cursor: pointer;
      font-size: 12.5px;
      color: var(--muted);
      margin-bottom: space(1);
    }
  }
  .choices {
    display: flex;
    flex-wrap: wrap;
    gap: space(1) + 2;
    margin-top: space(2) + 2;
  }
  textarea {
    width: 100%;
    margin-top: space(2);
    font-size: 12.5px;
    line-height: 1.55;
    resize: vertical;
  }
</style>
