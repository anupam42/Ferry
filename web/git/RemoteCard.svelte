<script lang="ts">
  import Icon from "../components/Icon.svelte";
  import { ago, plural } from "../lib/format.ts";
  import { doPull, doPush, fileList, git, remoteJob, whoPushed } from "../lib/git.svelte.ts";
  import type { RepoStateResponse } from "../lib/types.ts";

  /** New on the remote: who pushed what, and whether it touches your work. */
  let { st }: { st: RepoStateResponse } = $props();
  const rc = $derived(git.remote[git.selected]);
  const show = $derived(!!rc && st.behind > 0 && !st.operation && rc.incoming.length > 0);
  const dirty = $derived(rc ? rc.overlap.filter((p) => st.files.some((f) => f.path === p)) : []);
  const both = $derived(st.ahead > 0);
  const initials = (n: string) =>
    (n || "?")
      .split(/\s+/)
      .map((w) => w[0])
      .slice(0, 2)
      .join("")
      .toUpperCase();
</script>

{#if show && rc}
  <section class="card rc">
    <div class="head">
      <span class="ic" aria-hidden="true"><Icon name="down" size={18} /></span>
      <div class="title">
        <b>{plural(st.behind, "new commit")} on {rc.upstream}</b>
        <small
          >from {whoPushed(rc.incoming)} · latest {ago(rc.incoming[0]!.date)}{both
            ? ` · you have ${plural(st.ahead, "commit")} to push`
            : ""}</small
        >
      </div>
      <div class="actions">
        <button
          class="btn small"
          class:brand={!both}
          disabled={!!git.busy}
          onclick={() => remoteJob("pull", () => doPull())}
          ><Icon name="down" size={16} />{both ? "Pull (rebase)" : "Pull now"}</button
        >
        {#if both}<button
            class="btn small brand"
            disabled={!!git.busy}
            onclick={() => remoteJob("push", () => doPush())}><Icon name="up" size={16} />Pull & push</button
          >{/if}
      </div>
    </div>
    <div class="list">
      {#each rc.incoming.slice(0, 3) as c (c.hash)}
        <button type="button" class="commit" onclick={() => (git.commit = c.hash)}>
          <span class="avatar" aria-hidden="true">{initials(c.author)}</span>
          <span class="subj">{c.subject}</span>
          <span class="muted">{plural(c.files.length, "file")}</span>
          <span class="mono faint">{c.short}</span>
          <span class="muted when">{ago(c.date)}</span>
        </button>
      {/each}
      {#if rc.incoming.length > 3}<button type="button" class="more" onclick={() => (git.view = "history")}
          >+ {rc.incoming.length - 3} more in History</button
        >{/if}
    </div>
    {#if rc.overlap.length}
      <div class="warn">
        <Icon name="info" size={16} /><span
          ><b>Heads-up:</b>
          {fileList(rc.overlap)} changed on both sides.
          {dirty.length ? "Pulling now keeps your uncommitted edits safe (I set them aside and put them back)." : ""} If the
          same lines changed, you'll pick what to keep.</span
        >
      </div>
    {:else}
      <div class="ok">
        <Icon name="check" size={16} /><span
          >None of these touch the files you're working on, so pulling should be smooth.</span
        >
      </div>
    {/if}
  </section>
{/if}

<style lang="scss">
  @use "tokens" as *;
  @use "mixins" as *;

  .rc {
    padding: space(3) + 2 space(4);
    border: 2px solid color-mix(in srgb, var(--amber) 45%, transparent);
  }
  .head {
    display: flex;
    align-items: center;
    gap: space(3);
    flex-wrap: wrap;
  }
  .ic {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: var(--amber-soft);
    color: var(--amber);
    flex: none;
  }
  .title {
    flex: 1;
    min-width: 200px;
    b {
      display: block;
    }
    small {
      color: var(--muted);
    }
  }
  .actions {
    display: flex;
    gap: space(2);
  }
  .list {
    margin: space(3) 0 space(2);
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .commit {
    width: 100%;
    border: 0;
    background: none;
    color: var(--text);
    text-align: left;
    cursor: pointer;
    display: grid;
    grid-template-columns: 28px minmax(0, 1fr) auto auto auto;
    gap: space(3);
    align-items: center;
    padding: space(1) + 2 space(2);
    border-radius: $radius-md;
    font-size: 13.5px;
    &:hover {
      background: var(--card2);
    }
  }
  .avatar {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: var(--accent);
    color: #fff;
    font-size: 10.5px;
    font-weight: $weight-heavy;
  }
  .subj {
    @include ellipsis;
  }
  .faint {
    color: var(--faint);
  }
  .when {
    font-size: fs(sm);
  }
  .more {
    border: 0;
    background: none;
    color: var(--accent);
    font-weight: $weight-semibold;
    cursor: pointer;
    text-align: left;
    padding: space(1) space(2);
  }
  .warn,
  .ok {
    display: flex;
    gap: space(2);
    align-items: flex-start;
    padding: space(2) space(3);
    border-radius: $radius-md;
    font-size: 13px;
    :global(svg) {
      flex: none;
      margin-top: 2px;
    }
  }
  .warn {
    background: var(--amber-soft);
    color: var(--amber);
  }
  .ok {
    background: var(--green-soft);
    color: var(--green);
  }
</style>
