<script lang="ts">
  import Icon from "../components/Icon.svelte";
  import Markdown from "../components/Markdown.svelte";
  import RelayLoading from "../components/RelayLoading.svelte";
  import { api, enc } from "../lib/api.ts";
  import { act } from "../lib/app.svelte.ts";
  import { findFiles, fileSize, folderTree, readmeOf, since } from "../lib/files.ts";
  import { git } from "../lib/git.svelte.ts";
  import type { FileContent, FolderEntry, RepoFolder, RepoStateResponse } from "../lib/types.ts";
  import Avatar from "./Avatar.svelte";
  import FileIcon from "./FileIcon.svelte";

  /** A folder-at-a-time browser, like a code host's: each entry's last commit, file search, and the folder's README below. */
  let { st }: { st: RepoStateResponse } = $props();
  const repo = git.selected;
  let paths = $state<string[] | null>(null);
  $effect(() => {
    void git.bump;
    act(null, () => api<string[]>("GET", git.url("files"))).then((p) => {
      if (p) paths = p;
    });
  });
  const tree = $derived(paths ? folderTree(paths) : null);
  const dir = $derived(tree && tree.has(git.folder[repo] ?? "") ? (git.folder[repo] ?? "") : "");
  const node = $derived(tree?.get(dir));
  const cmp = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
  const entries = $derived(
    node
      ? [
          ...[...node.dirs].sort(cmp).map((n) => ({ name: n, path: dir ? dir + "/" + n : n, dir: true })),
          ...[...node.files].sort(cmp).map((n) => ({ name: n, path: dir ? dir + "/" + n : n, dir: false })),
        ]
      : [],
  );
  const countUnder = (d: string) =>
    paths ? (d ? paths.filter((p) => p.startsWith(d + "/")).length : paths.length) : 0;
  const open = (d: string) => {
    git.folder[repo] = d;
    query = "";
  };

  // each entry's last commit, per folder, fetched once
  let info = $state<Record<string, FolderEntry[]>>({});
  $effect(() => {
    const d = dir;
    if (!tree || info[d]) return;
    api<RepoFolder>("GET", git.url("folder") + "?dir=" + enc(d)).then(
      (r) => (info[d] = r.entries),
      () => (info[d] = []),
    );
  });
  const byPath = $derived(info[dir] ? new Map(info[dir]!.map((e) => [e.path, e])) : null);
  const latest = $derived(
    (info[dir] ?? [])
      .map((e) => e.commit)
      .filter((c) => !!c)
      .sort((a, b) => Date.parse(b!.date) - Date.parse(a!.date))[0] ?? null,
  );

  let query = $state("");
  const hits = $derived(paths ? findFiles(paths, query) : []);

  // the folder's README
  const readme = $derived(node ? readmeOf(node.files) : undefined);
  const readmePath = $derived(readme ? (dir ? dir + "/" + readme : readme) : "");
  let readmeText = $state<FileContent | null>(null);
  let readmeError = $state("");
  $effect(() => {
    const p = readmePath;
    readmeText = null;
    readmeError = "";
    if (!p) return;
    api<FileContent>("GET", git.url("file") + "?path=" + enc(p)).then(
      (f) => {
        if (p === readmePath) readmeText = f;
      },
      (e) => (readmeError = (e as Error).message),
    );
  });
  const crumbs = $derived(dir ? dir.split("/") : []);
  const rawURL = (p: string) => git.url("file") + "?path=" + enc(p) + "&raw=1";
  /** A folder opens in place; a file opens in the file drawer. */
  const go = (e: { path: string; dir: boolean }) => {
    if (e.dir) open(e.path);
    else git.file = e.path;
  };
</script>

{#if !paths || !tree || !node}
  <RelayLoading say="Listing the repository's files" sub="Every file git tracks." />
{:else if !paths.length}
  <div class="card none">
    <Icon name="folder" size={28} /><b>Nothing here yet</b><span class="muted"
      >Commit some files and they show up here.</span
    >
  </div>
{:else}
  <div class="card fb">
    <div class="head">
      <nav class="crumbs" aria-label="Folder">
        <button type="button" class:here={!crumbs.length} onclick={() => open("")}
          ><Icon name="home" size={15} />{st.name || "repository"}</button
        >
        {#each crumbs as p, i (i)}
          <span class="sep" aria-hidden="true">/</span>
          {#if i === crumbs.length - 1}<span class="here">{p}</span>
          {:else}<button type="button" onclick={() => open(crumbs.slice(0, i + 1).join("/"))}>{p}</button>{/if}
        {/each}
      </nav>
      <div class="tools">
        <label class="find"
          ><Icon name="search" size={16} /><input
            type="text"
            bind:value={query}
            placeholder="Go to file…"
            aria-label="Find a file"
            spellcheck="false"
            onkeydown={(e) => {
              if (e.key === "Escape") query = "";
              if (e.key === "Enter" && hits[0]) git.file = hits[0];
            }}
          /></label
        >
        <span class="pill">{countUnder(dir)} {countUnder(dir) === 1 ? "file" : "files"}</span>
      </div>
    </div>
    {#if query.trim()}
      {#if hits.length}
        <div class="hits">
          {#each hits as p (p)}
            {@const name = p.split("/").pop() ?? p}
            <button type="button" class="hit" onclick={() => (git.file = p)}
              ><FileIcon {name} /><span class="label">{name}</span><span class="where"
                ><bdi>{p.slice(0, -name.length).replace(/\/$/, "")}</bdi></span
              ></button
            >
          {/each}
        </div>
      {:else}<div class="empty-row">No file matches “{query.trim()}”.</div>{/if}
    {:else}
      {#if latest}
        <div class="latest">
          <Avatar author={latest.author} size={26} /><b>{latest.author}</b>
          <button type="button" class="commit grow" onclick={() => (git.commit = latest.hash)}>{latest.subject}</button>
          <span class="mono faint">{latest.short}</span><span
            class="muted"
            title={new Date(latest.date).toLocaleString()}>{since(latest.date)}</span
          >
        </div>
      {/if}
      <table class="list">
        <thead
          ><tr><th>Name</th><th class="msg">Last commit</th><th class="when">Updated</th><th class="size">Size</th></tr
          ></thead
        >
        <tbody>
          {#if dir}
            <tr
              class="row"
              tabindex="0"
              onclick={() => open(dir.split("/").slice(0, -1).join("/"))}
              onkeydown={(e) => {
                if (e.key === "Enter") open(dir.split("/").slice(0, -1).join("/"));
              }}
            >
              <td colspan="4" class="name"><FileIcon name=".." up /><span class="label muted">..</span></td>
            </tr>
          {/if}
          {#each entries as e (e.path)}
            {@const i = byPath?.get(e.path)}
            <tr
              class="row"
              class:is-dir={e.dir}
              tabindex="0"
              onclick={() => go(e)}
              onkeydown={(ev) => {
                if (ev.key === "Enter") go(e);
              }}
            >
              <td class="name"
                ><FileIcon name={e.name} dir={e.dir} /><span class="label">{e.name}</span>{#if e.dir}<span class="n"
                    >{countUnder(e.path)}</span
                  >{/if}</td
              >
              <td class="msg">
                {#if !byPath}<span class="skel"></span>
                {:else if i?.commit}{@const c = i.commit}<button
                    type="button"
                    class="commit"
                    title="{c.subject} ({c.short})"
                    onclick={(ev) => {
                      ev.stopPropagation();
                      git.commit = c.hash;
                    }}>{c.subject}</button
                  >
                {:else}<span class="faint">not committed yet</span>{/if}
              </td>
              <td class="when"
                >{#if !byPath}<span class="skel short"></span>{:else if i?.commit}<span
                    title={new Date(i.commit.date).toLocaleString()}>{since(i.commit.date)}</span
                  >{/if}</td
              >
              <td class="size">{e.dir ? "" : fileSize(i?.size ?? null)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>
  {#if readme}
    <div class="card readme">
      <div class="readme-head">
        <FileIcon name={readme} /><b>{readme}</b><button
          type="button"
          class="btn small ghost"
          onclick={() => (git.file = readmePath)}>View raw</button
        >
      </div>
      <div class="readme-body">
        {#if readmeError}<p class="muted">{readmeError}</p>
        {:else if !readmeText}<RelayLoading say="Reading {readme}" card={false} />
        {:else if readmeText.tooBig}<p class="muted">This README is too large to show here.</p>
        {:else if /\.(md|markdown|mdown|mkd)$/i.test(readme)}<Markdown
            text={readmeText.text}
            base={dir}
            fileURL={rawURL}
            openFile={(p) => (git.file = p)}
          />
        {:else}<pre class="mono raw">{readmeText.text}</pre>{/if}
      </div>
    </div>
  {/if}
{/if}

<style lang="scss">
  @use "tokens" as *;
  @use "mixins" as *;

  .none {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: space(2);
    padding: space(10);
    color: var(--muted);
    b {
      color: var(--text);
    }
  }
  .fb {
    overflow: hidden;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: space(3);
    flex-wrap: wrap;
    padding: space(3) space(4);
    border-bottom: 1px solid var(--line);
  }
  .crumbs {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-wrap: wrap;
    font-size: 14px;
    button {
      display: inline-flex;
      align-items: center;
      gap: space(1) + 2;
      border: 0;
      background: none;
      color: var(--accent);
      cursor: pointer;
      padding: 3px 7px;
      border-radius: $radius-sm;
      font-weight: $weight-semibold;
      &:hover {
        background: var(--accent-soft);
      }
    }
    .here {
      color: var(--text);
      font-weight: $weight-bold;
      padding: 3px 7px;
      cursor: default;
      &:hover {
        background: none;
      }
    }
    .sep {
      color: var(--faint);
    }
  }
  .tools {
    display: flex;
    align-items: center;
    gap: space(2) + 2;
  }
  .find {
    display: flex;
    align-items: center;
    gap: space(2);
    background: var(--card2);
    border-radius: $radius-pill;
    padding: space(1) + 2 space(3);
    color: var(--muted);
    input {
      border: 0;
      outline: 0;
      background: none;
      padding: 2px 0;
      width: 200px;
      color: var(--text);
      border-radius: 0;
    }
  }
  .latest {
    display: flex;
    align-items: center;
    gap: space(2) + 2;
    padding: space(2) + 2 space(4);
    background: var(--card2);
    border-bottom: 1px solid var(--line);
    font-size: 13.5px;
  }
  .commit {
    border: 0;
    background: none;
    color: var(--text);
    text-align: left;
    cursor: pointer;
    padding: 0;
    @include ellipsis;
    max-width: 100%;
    &:hover {
      color: var(--accent);
      text-decoration: underline;
    }
  }
  .grow {
    flex: 1;
    min-width: 0;
  }
  .faint {
    color: var(--faint);
  }
  .list {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    th {
      text-align: left;
      font-weight: $weight-medium;
      color: var(--muted);
      font-size: 12.5px;
      padding: space(2) space(4);
    }
    td {
      padding: space(2) + 1 space(4);
      border-top: 1px solid var(--line);
      font-size: 13.5px;
      vertical-align: middle;
    }
    .msg {
      width: 46%;
    }
    .when {
      width: 120px;
      color: var(--muted);
    }
    .size {
      width: 80px;
      text-align: right;
      color: var(--muted);
      font-variant-numeric: tabular-nums;
    }
  }
  .row {
    cursor: pointer;
    &:hover td,
    &:focus-visible td {
      background: var(--accent-soft);
      outline: none;
    }
  }
  .name {
    display: flex;
    align-items: center;
    gap: space(2) + 2;
    min-width: 0;
  }
  .label {
    @include ellipsis;
  }
  .is-dir .label {
    font-weight: $weight-semibold;
  }
  .n {
    font-size: 11px;
    color: var(--muted);
    background: var(--card2);
    border-radius: $radius-pill;
    padding: 0 space(2);
  }
  .skel {
    display: inline-block;
    height: 10px;
    width: 70%;
    border-radius: $radius-pill;
    background: var(--card2);
    &.short {
      width: 50px;
    }
  }
  .hits {
    display: flex;
    flex-direction: column;
    padding: space(2);
    max-height: 60vh;
    overflow-y: auto;
  }
  .hit {
    display: flex;
    align-items: center;
    gap: space(2) + 2;
    padding: space(2) space(3);
    border: 0;
    border-radius: $radius-md;
    background: none;
    color: var(--text);
    text-align: left;
    cursor: pointer;
    &:hover {
      background: var(--accent-soft);
    }
  }
  .where {
    margin-left: auto;
    color: var(--muted);
    font-size: fs(sm);
    @include ellipsis;
    direction: rtl;
  }
  .readme {
    overflow: hidden;
  }
  .readme-head {
    display: flex;
    align-items: center;
    gap: space(2) + 2;
    padding: space(3) space(4);
    border-bottom: 1px solid var(--line);
    :global(.btn) {
      margin-left: auto;
    }
  }
  .readme-body {
    padding: space(4) space(6) space(5);
  }
  .raw {
    white-space: pre-wrap;
    margin: 0;
  }
  @include below(tablet) {
    .list .when,
    .list .size {
      display: none;
    }
    .list .msg {
      width: 50%;
    }
  }
</style>
