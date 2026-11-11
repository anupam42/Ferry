<script lang="ts">
  import FileIcon from "../components/FileIcon.svelte";
  import Icon from "../components/Icon.svelte";
  import Section from "../components/Section.svelte";
  import { api } from "../lib/api.ts";
  import { app, ask, askFields, toast } from "../lib/app.svelte.ts";
  import { plural } from "../lib/format.ts";
  import { discardFiles, git } from "../lib/git.svelte.ts";
  import type { FileChange, RepoStateResponse } from "../lib/types.ts";
  import ShapeCallout from "./ShapeCallout.svelte";

  let { st }: { st: RepoStateResponse } = $props();
  const files = $derived(st.files.filter((f) => !f.conflicted));
  const staged = $derived(files.filter((f) => f.staged).length);
  const last = $derived(st.lastCommit);
  const folder = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/") + 1) : "top folder");
  const status = (f: FileChange): [string, string] =>
    f.untracked || f.x === "A"
      ? ["New", "green"]
      : f.x === "R"
        ? ["Renamed", "violet"]
        : f.x === "D" || f.y === "D"
          ? ["Deleted", "red"]
          : ["Modified", "blue"];
  const partly = (f: FileChange) => f.staged && f.unstaged && !f.untracked;

  // a branch named after a Jira issue (SHOP-42-…) puts the key in front of the message
  const issueKey = $derived((st.branch.match(/^([A-Z][A-Z0-9_]+-\d+)/) || [])[1] ?? "");
  const withKey = $derived(
    !!issueKey && !!app.conns?.jira.connected && localStorage.getItem("ferry-jira-prefix") !== "off",
  );

  let message = $state("");
  let coAuthors = $state("");
  let amend = $state(false);
  let writing = $state(false);
  let committing = $state(false);

  async function write() {
    writing = true;
    try {
      message = (await api<{ message: string }>("GET", git.url("ai-message"))).message;
    } catch (e) {
      toast((e as Error).message, { error: true });
    }
    writing = false;
  }
  async function commit() {
    let m = message.trim();
    if (withKey && m && !m.includes(issueKey)) m = `${issueKey}: ${m}`;
    const co = coAuthors
      .split(/,(?=[^>]*(?:<|$))/)
      .map((x) => x.trim())
      .filter(Boolean);
    committing = true;
    const r = await git.try<{ commit: string }>(
      "commit",
      { message: m, amend, co_authors: co },
      (r) => (amend ? `Updated the last commit (${r.commit})` : `Committed ${r.commit}`),
      "party",
    );
    committing = false;
    if (r) {
      message = "";
      coAuthors = "";
      amend = false;
    }
  }
  async function stashAll() {
    const v = await askFields({
      mood: "thinking",
      title: "Put these changes aside?",
      yes: "Stash them",
      no: "Cancel",
      yesMood: "wink",
      primary: "yes",
      text: "I'll stash them (tuck them away safely) so you get a clean folder. Bring them back any time from the Stashes tab.",
      fields: [
        { name: "message", label: "A note to remember them by (optional)", placeholder: "e.g. half-done login page" },
      ],
    });
    if (v) await git.try("stash", { message: v.message }, "Tucked away in Stashes", "wink");
  }
  async function undoLast() {
    if (!last) return;
    const ok = await ask({
      mood: last.pushed ? "worried" : "thinking",
      title: `Undo “${last.subject}”?`,
      yes: "Undo it",
      no: "Keep it",
      yesMood: "wink",
      text:
        (last.pushed ? "This commit is already on the remote, so after undoing you'd need to force-push. " : "") +
        "The commit goes away but its changes stay, ready to commit again.",
    });
    if (ok)
      await git.try<{ subject: string }>("undo", {}, (r) => `Undid “${r.subject}”; the changes are still here`, "wink");
  }
</script>

<ShapeCallout {st} count={files.length} />
<Section id="g-changes" title="Changes" count={files.length} tone="blue">
  {#snippet extra()}
    {#if files.length}
      <span class="inline">
        <button class="btn small" onclick={() => git.try("stage", { files: [] }, "Everything is ready to commit")}
          >Select all</button
        >
        <button class="btn small ghost" onclick={() => git.try("unstage", { files: [] })}>Clear</button>
        <button class="btn small ghost" onclick={stashAll}>Stash all</button>
        <button class="btn small ghost danger" onclick={() => discardFiles([], "every change")}>Discard all</button>
      </span>
    {/if}
  {/snippet}
  {#if files.length}
    <table class="table">
      <tbody>
        {#each files as f (f.path)}
          {@const [word, tone] = status(f)}
          <tr>
            <td class="cb"
              ><input
                type="checkbox"
                aria-label="Include {f.path} in the next commit"
                checked={f.staged}
                indeterminate={partly(f)}
                onchange={(e) => git.try(e.currentTarget.checked ? "stage" : "unstage", { files: [f.path] })}
              /></td
            >
            <td class="file"
              ><div class="fi">
                <FileIcon name={f.path} /><span
                  >{f.path.split("/").pop()}<small>{f.from ? `renamed from ${f.from}` : folder(f.path)}</small></span
                >
              </div></td
            >
            <td
              ><span class="pill {tone}">{word}</span>{#if partly(f)}
                <span class="pill amber">partly staged</span>{/if}</td
            >
            <td class="end">
              <button class="btn small" onclick={() => (git.review = f.path)}
                ><Icon name="eye" size={16} />Review & pick lines</button
              >
              <button class="btn small ghost danger" onclick={() => discardFiles([f.path], f.path)}>Discard</button>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {:else}<div class="empty-row">No changes. Edit some files and they show up here.</div>{/if}
</Section>

<Section id="g-commit" title="Commit">
  <form
    class="form"
    onsubmit={(e) => {
      e.preventDefault();
      void commit();
    }}
  >
    <div class="field">
      <div class="label-row">
        <span class="label">Message</span>
        <button
          type="button"
          class="btn small"
          title="Claude reads the staged changes and writes a message"
          disabled={writing}
          onclick={write}>{writing ? "Writing…" : "✨ Write it for me"}</button
        >
      </div>
      <input
        type="text"
        bind:value={message}
        placeholder={withKey ? `${issueKey}: what did you change?` : "What did you change? (e.g. Fix the login button)"}
      />
    </div>
    <label class="field"
      ><input
        type="text"
        bind:value={coAuthors}
        placeholder="Co-authors (optional): Name <email>, Name <email>"
        aria-label="Co-authors"
      /></label
    >
    {#if last}
      <label class="check"
        ><input
          type="checkbox"
          bind:checked={amend}
          onchange={() => {
            if (amend && !message) message = last.subject;
          }}
        />
        <span
          >Add to the last commit instead (“{last.subject}”){#if last.pushed}<small class="hint"
              >It's already pushed: you'd need to force-push afterwards.</small
            >{/if}</span
        ></label
      >
    {/if}
    <div class="row">
      <button class="btn primary" disabled={committing || (!staged && !amend)}
        ><Icon name="commit" size={16} />{staged
          ? `Commit ${plural(staged, "file")} to ${st.branch || "HEAD"}`
          : "Commit"}</button
      >
      {#if last}<button type="button" class="btn small ghost" onclick={undoLast}>↶ Undo last commit</button>{/if}
    </div>
  </form>
</Section>

<style lang="scss">
  @use "tokens" as *;
  .cb {
    width: 36px;
    input {
      accent-color: var(--accent);
      width: 17px;
      height: 17px;
      cursor: pointer;
    }
  }
  .end :global(.btn) {
    margin-left: space(1);
  }
  .form {
    padding: space(1) space(4) space(3) + 2;
  }
  .label-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: space(1) + 2;
    .label {
      margin: 0;
    }
  }
  .row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: space(2);
  }
</style>
