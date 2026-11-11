<script lang="ts">
  import ChangeStory from "../components/ChangeStory.svelte";
  import Drawer from "../components/Drawer.svelte";
  import FileIcon from "../components/FileIcon.svelte";
  import Icon from "../components/Icon.svelte";
  import RelayLoading from "../components/RelayLoading.svelte";
  import { api, ApiError, enc } from "../lib/api.ts";
  import { ago, plural } from "../lib/format.ts";
  import { git } from "../lib/git.svelte.ts";
  import type { BranchList, Commit, Comparison, FileDiff, Tag } from "../lib/types.ts";
  import Avatar from "./Avatar.svelte";

  /**
   * Two branches (or tags, or commits) side by side: what "compare" has that
   * "base" doesn't, what base has that it doesn't, and what compare changed
   * since the two split, file by file, the way a pull request from compare into base shows it.
   */
  const start = git.compare!;
  let base = $state(start.base);
  let head = $state(start.head);

  // what you can pick: your branches, the remote's, and tags
  let refs = $state<{ label: string; names: string[] }[]>([]);
  $effect(() => {
    Promise.all([
      api<BranchList>("GET", git.url("branches")),
      api<Tag[]>("GET", git.url("tags")).catch(() => [] as Tag[]),
    ]).then(([b, t]) => {
      refs = [
        { label: "Your branches", names: b.local.map((x) => x.name) },
        { label: "On the remote", names: b.remote.map((x) => x.name) },
        { label: "Tags", names: t.map((x) => x.name) },
      ].filter((g) => g.names.length);
    });
  });
  const known = $derived(new Set(refs.flatMap((g) => g.names)));

  let c = $state<Comparison | null>(null);
  let error = $state("");
  $effect(() => {
    const b = base,
      h = head;
    c = null;
    error = "";
    file = "";
    api<Comparison>("GET", git.url("compare") + "?base=" + enc(b) + "&head=" + enc(h)).then(
      (r) => {
        if (b === base && h === head) c = r;
      },
      (e) => {
        if (b === base && h === head) error = e instanceof ApiError ? e.message : String(e);
      },
    );
  });

  let tab = $state<"commits" | "files">("commits");
  let file = $state("");
  let d = $state<FileDiff | null>(null);
  let diffError = $state("");
  async function show(path: string) {
    file = path;
    d = null;
    diffError = "";
    try {
      d = await api<FileDiff>(
        "GET",
        git.url("compare-diff") + "?base=" + enc(base) + "&head=" + enc(head) + "&path=" + enc(path),
      );
    } catch (e) {
      diffError = (e as Error).message;
    }
  }
  function swap() {
    [base, head] = [head, base];
  }

  const STATUS: Record<string, [string, string]> = {
    A: ["Added", "green"],
    M: ["Modified", "blue"],
    D: ["Deleted", "red"],
    R: ["Renamed", "violet"],
    C: ["Copied", "violet"],
  };
  const added = $derived(c?.files.reduce((n, f) => n + f.added, 0) ?? 0);
  const removed = $derived(c?.files.reduce((n, f) => n + f.removed, 0) ?? 0);
</script>

{#snippet picker(label: string, value: string, set: (v: string) => void)}
  <label class="pick">
    <span class="lbl">{label}</span>
    <select {value} onchange={(e) => set(e.currentTarget.value)} aria-label={label}>
      {#if !known.has(value)}<option {value}>{value}</option>{/if}
      {#each refs as g (g.label)}
        <optgroup label={g.label}>
          {#each g.names as n (n)}<option value={n}>{n}</option>{/each}
        </optgroup>
      {/each}
    </select>
  </label>
{/snippet}

{#snippet commitRow(x: Commit)}
  <button type="button" class="commit" onclick={() => (git.commit = x.hash)}>
    <Avatar author={x.author} email={x.email} size={24} />
    <span class="grow"><span class="subj">{x.subject}</span><small>{x.author} · {ago(x.date)}</small></span>
    <span class="mono faint">{x.short}</span>
  </button>
{/snippet}

<Drawer title="Compare" sub="{head} against {base}" wide onclose={() => (git.compare = null)}>
  <div class="pickers">
    {@render picker("Base", base, (v) => (base = v))}
    <button
      type="button"
      class="btn small ghost swap"
      title="Swap them"
      aria-label="Swap base and compare"
      onclick={swap}><Icon name="sync" size={16} /></button
    >
    {@render picker("Compare", head, (v) => (head = v))}
  </div>

  {#if error}
    <p class="muted">{error}</p>
  {:else if !c}
    <RelayLoading say="Comparing {head} with {base}" mood="comparing" card={false} />
  {:else}
    <div class="summary" role="status">
      {#if base === head}
        <b>That's the same thing twice.</b> Pick another branch to compare with.
      {:else if !c.aheadCount && !c.behindCount}
        <b>{head} and {base} are the same.</b> Neither has a commit the other doesn't.
      {:else}
        <span
          ><b>{head}</b> has <b>{plural(c.aheadCount, "commit")}</b> that {base} doesn't{#if c.behindCount}; {base}
            has <b>{plural(c.behindCount, "commit")}</b> that {head} doesn't{/if}.</span
        >
        {#if c.files.length}<span class="muted"
            >{plural(c.files.length, "file")} changed since they split · <span class="plus">+{added}</span>
            <span class="minus">−{removed}</span></span
          >{/if}
        {#if !c.mergeBase}<span class="pill amber">no shared history</span>{/if}
      {/if}
    </div>

    {#if c.aheadCount || c.behindCount}
      <div class="seg tabs" role="tablist" aria-label="Show">
        <button
          role="tab"
          class:on={tab === "commits"}
          aria-selected={tab === "commits"}
          onclick={() => (tab = "commits")}>Commits <span class="n">{c.aheadCount}</span></button
        >
        <button role="tab" class:on={tab === "files"} aria-selected={tab === "files"} onclick={() => (tab = "files")}
          >Files changed <span class="n">{c.files.length}</span></button
        >
      </div>

      {#if tab === "commits"}
        <h4>On {head}, not on {base}</h4>
        <div class="list">
          {#each c.ahead as x (x.hash)}{@render commitRow(x)}{:else}<div class="empty-row">
              None: everything on {head} is already on {base}.
            </div>{/each}
          {#if c.aheadCount > c.ahead.length}<div class="more muted">
              and {c.aheadCount - c.ahead.length} more
            </div>{/if}
        </div>
        {#if c.behindCount}
          <details class="behind">
            <summary>On {base}, not on {head} ({c.behindCount})</summary>
            <div class="list">
              {#each c.behind as x (x.hash)}{@render commitRow(x)}{/each}
              {#if c.behindCount > c.behind.length}<div class="more muted">
                  and {c.behindCount - c.behind.length} more
                </div>{/if}
            </div>
          </details>
        {/if}
      {:else}
        <div class="list">
          {#each c.files as f (f.path)}
            {@const s = STATUS[f.status] ?? [f.status, ""]}
            <button type="button" class="file" class:on={f.path === file} onclick={() => show(f.path)}>
              <span class="pill {s[1]}">{s[0]}</span>
              <FileIcon name={f.path} size={18} />
              <span class="grow"
                >{f.path}{#if f.from}<small class="muted"> from {f.from}</small>{/if}</span
              >
              <span class="pill green">+{f.added}</span><span class="pill red">−{f.removed}</span>
            </button>
          {:else}
            <div class="empty-row">No file differs since they split.</div>
          {/each}
        </div>
        {#if file}
          <div class="pane">
            {#if diffError}<p class="muted">{diffError}</p>
            {:else if !d}<RelayLoading say="Comparing {file.split('/').pop()}" mood="comparing" card={false} />
            {:else}{#key file}<ChangeStory {d} file={file.split("/").pop() ?? file} />{/key}{/if}
          </div>
        {/if}
      {/if}
    {/if}
  {/if}
  {#snippet foot()}
    <button class="btn small" onclick={() => (git.compare = null)}>Close</button>
  {/snippet}
</Drawer>

<style lang="scss">
  @use "tokens" as *;
  @use "mixins" as *;
  .pickers {
    display: flex;
    align-items: flex-end;
    gap: space(2);
    flex-wrap: wrap;
    margin-bottom: space(3) + 2;
  }
  .pick {
    display: flex;
    flex-direction: column;
    gap: space(1);
    flex: 1;
    min-width: 180px;
    select {
      width: 100%;
    }
  }
  .lbl {
    font-size: fs(sm);
    font-weight: $weight-semibold;
    color: var(--muted);
  }
  .swap {
    margin-bottom: 4px;
  }
  .summary {
    display: flex;
    flex-direction: column;
    gap: space(1);
    padding: space(3) space(4);
    border-radius: $radius-md;
    background: var(--card2);
    margin-bottom: space(3) + 2;
    font-size: 14px;
    .plus {
      color: var(--green);
    }
    .minus {
      color: var(--red);
    }
    .pill {
      align-self: flex-start;
    }
  }
  .tabs {
    margin-bottom: space(3);
    .n {
      margin-left: space(1);
      font-size: 11.5px;
      color: var(--muted);
    }
  }
  h4 {
    margin: 0 0 space(2);
    font-size: fs(sm);
    color: var(--muted);
    font-weight: $weight-semibold;
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .commit,
  .file {
    display: flex;
    align-items: center;
    gap: space(2) + 2;
    width: 100%;
    padding: space(2) space(3);
    border: 0;
    border-radius: $radius-md;
    background: none;
    color: var(--text);
    text-align: left;
    cursor: pointer;
    font-size: 13.5px;
    &:hover {
      background: var(--accent-soft);
    }
    &.on {
      background: var(--accent-soft);
      box-shadow: inset 3px 0 0 var(--accent);
    }
    .grow {
      flex: 1;
      min-width: 0;
      overflow-wrap: anywhere;
    }
  }
  .commit .grow {
    display: flex;
    flex-direction: column;
    .subj {
      @include ellipsis;
      font-weight: $weight-semibold;
    }
    small {
      color: var(--muted);
      font-size: 12px;
    }
  }
  .faint {
    color: var(--faint);
    font-size: 12px;
  }
  .more {
    font-size: 12.5px;
    padding: space(1) + 2 space(3);
  }
  .behind {
    margin-top: space(3) + 2;
    summary {
      cursor: pointer;
      font-size: fs(sm);
      font-weight: $weight-semibold;
      color: var(--muted);
      margin-bottom: space(2);
    }
  }
  .pane {
    margin-top: space(3) + 2;
  }
</style>
