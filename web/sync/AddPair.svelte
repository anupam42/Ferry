<script lang="ts">
  import Drawer from "../components/Drawer.svelte";
  import { api, face } from "../lib/api.ts";
  import { act, app, toast } from "../lib/app.svelte.ts";
  import { sync } from "../lib/sync.svelte.ts";
  import FolderPicker from "./FolderPicker.svelte";

  const f = $state({
    source: "",
    target: "",
    mode: "one-way",
    name: "",
    on_delete: "keep",
    merge: false,
    ignore: "",
    secrets: "warn",
    targets: "",
    ac: false,
    ac_interval: "10m",
    ac_ai: false,
    ac_push: false,
  });
  const errors = $state({ source: "", target: "" });
  let busy = $state(false);
  let picking = $state<"" | "source" | "target">("");
  let sourceInput: HTMLInputElement = $state()!;
  $effect(() => {
    setTimeout(() => sourceInput?.focus(), 320);
  });

  const close = () => (sync.adding = false);
  const lines = (s: string) =>
    s
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean);
  const isRemote = (s: string) => /^(s3:\/\/|ssh:\/\/|[^/\\]+@)/.test(s);

  async function submit() {
    if (!f.source.trim()) errors.source = "Choose the folder you work in.";
    if (!f.target.trim()) errors.target = "Choose where the files should go.";
    if (errors.source || errors.target) return;
    const two = f.mode === "two-way";
    const body: Record<string, unknown> = {
      name: f.name.trim(),
      source: f.source.trim(),
      target: f.target.trim(),
      mode: f.mode,
      on_delete: f.on_delete,
      ignore: lines(f.ignore),
      secrets: f.secrets,
    };
    if (two) {
      body.merge = f.merge;
      if (f.secrets === "redact") return toast("Blanking out secrets only works one way", { error: true });
    } else if (f.on_delete === "restore")
      return toast("“Put it back” only works when syncing both ways", { error: true });
    const extra = lines(f.targets);
    if (extra.length) {
      if (two) return toast("Extra targets only work one way", { error: true });
      body.targets = extra;
    }
    if (f.ac)
      body.auto_commit = {
        enabled: true,
        interval: f.ac_interval,
        push: f.ac_push,
        message: f.ac_ai ? "{ai}" : "sync: {summary}",
      };
    busy = true;
    const r = await act(null, () => api<{ added: string[] }>("POST", "/pairs", body));
    busy = false;
    if (!r) return;
    toast("Now syncing " + r.added.join(", "), { mood: "party" });
    close();
    sync.select(r.added[0]!);
    await sync.refresh();
  }
</script>

<Drawer
  title={picking
    ? picking === "source"
      ? "Choose your working folder"
      : "Choose where the files should go"
    : "New folder pair"}
  sub="I'll keep these two folders in sync."
  onclose={close}
>
  {#if picking}
    {@const typed = f[picking].trim()}
    <FolderPicker
      start={typed && !isRemote(typed) ? typed : app.info?.home || ""}
      onpick={(dir) => {
        f[picking as "source" | "target"] = dir;
        errors[picking as "source" | "target"] = "";
        picking = "";
      }}
      onback={() => (picking = "")}
    />
  {:else}
    <div class="narrator">
      <img src={face("excited")} alt="" />
      <div class="bubble">
        <div class="say">Which folders should I look after?</div>
        <div class="hint">
          {app.info?.config_file
            ? "I'll remember this pair in " + app.info.config_file + "."
            : "This pair lasts until ferry stops."}
        </div>
      </div>
    </div>
    <form
      autocomplete="off"
      onsubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div class="field">
        <label class="label" for="f-source">Your working folder (source)</label>
        <div class="inline">
          <input
            type="text"
            id="f-source"
            placeholder="Choose the folder you edit in"
            class:invalid={!!errors.source}
            bind:value={f.source}
            bind:this={sourceInput}
            oninput={() => (errors.source = "")}
          />
          <button type="button" class="btn small" onclick={() => (picking = "source")}>Choose…</button>
        </div>
        <small>Where you edit files. I watch this folder.</small>
        {#if errors.source}<small class="field-error">{errors.source}</small>{/if}
      </div>
      <div class="field">
        <label class="label" for="f-target">Where the files should go (target)</label>
        <div class="inline">
          <input
            type="text"
            id="f-target"
            placeholder="Usually a git repository"
            class:invalid={!!errors.target}
            bind:value={f.target}
            oninput={() => (errors.target = "")}
          />
          <button type="button" class="btn small" onclick={() => (picking = "target")}>Choose…</button>
        </div>
        <small>You can also type user@server:/path (ssh) or s3://bucket/folder (cloud storage).</small>
        {#if errors.target}<small class="field-error">{errors.target}</small>{/if}
      </div>
      <div class="field">
        <span class="label">How should they stay in sync?</span>
        <div class="choices">
          <label class="choice"
            ><input type="radio" value="one-way" bind:group={f.mode} />One way →<small
              >Changes in your working folder are copied to the target.</small
            ></label
          >
          <label class="choice"
            ><input type="radio" value="two-way" bind:group={f.mode} />Both ways ⇄<small
              >Changes on either side are copied to the other. If both change a file, you choose.</small
            ></label
          >
        </div>
      </div>
      <details class="more">
        <summary>More options</summary>
        <label class="field first"
          ><span class="label">Name</span><input type="text" placeholder="e.g. website" bind:value={f.name} /><small
            >Optional. Shown in the list and in notifications.</small
          ></label
        >
        <label class="field"
          ><span class="label">When a file is deleted on one side</span>
          <select bind:value={f.on_delete}>
            <option value="keep">Keep the other copy (safest)</option><option value="propagate"
              >Delete it on the other side too</option
            ><option value="restore">Put it back from the other side (both ways only)</option>
          </select></label
        >
        <label class="check"
          ><input type="checkbox" bind:checked={f.merge} /><span
            >Merge edits automatically when both sides changed a text file<small class="hint"
              >Both ways only. Falls back to asking you if the edits overlap.</small
            ></span
          ></label
        >
        <label class="field"
          ><span class="label">Files to skip</span><textarea placeholder={"dist\n*.log"} bind:value={f.ignore}
          ></textarea><small>One pattern per line, like .gitignore. node_modules and .git are always skipped.</small
          ></label
        >
        <label class="field"
          ><span class="label">Things that look like passwords or keys</span>
          <select bind:value={f.secrets}>
            <option value="warn">Copy them, but warn me</option><option value="block">Don't copy those files</option
            ><option value="redact">Copy with the secrets blanked out (one way only)</option><option value="off"
              >Don't check</option
            >
          </select></label
        >
        <label class="field"
          ><span class="label">Also copy to these targets</span><textarea
            placeholder={"/path/to/another-repo\ns3://my-bucket/backup"}
            bind:value={f.targets}></textarea><small>One per line. Each becomes its own one-way pair.</small></label
        >
        <label class="check"
          ><input type="checkbox" bind:checked={f.ac} /><span>Commit to git automatically</span></label
        >
        {#if f.ac}
          <div class="ac">
            <div class="inline">
              <span>every</span><select class="auto" bind:value={f.ac_interval}
                ><option value="5m">5 minutes</option><option value="10m">10 minutes</option><option value="30m"
                  >30 minutes</option
                ><option value="1h">hour</option></select
              >
            </div>
            <label class="check"
              ><input type="checkbox" bind:checked={f.ac_ai} /><span
                >Let Claude write the commit messages<small class="hint"
                  >Needs ANTHROPIC_API_KEY where ferry runs.</small
                ></span
              ></label
            >
            <label class="check"
              ><input type="checkbox" bind:checked={f.ac_push} /><span>Push after committing</span></label
            >
          </div>
        {/if}
      </details>
      <button type="submit" hidden aria-hidden="true" tabindex="-1"></button>
    </form>
  {/if}
  {#snippet foot()}
    {#if !picking}
      <button class="btn ghost" type="button" onclick={close}>Cancel</button>
      <button class="btn brand" type="button" disabled={busy} onclick={submit}>Start syncing</button>
    {/if}
  {/snippet}
</Drawer>

<style lang="scss">
  @use "tokens" as *;
  @use "mixins" as *;

  .choices {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: space(2) + 2;
    @include below(phone) {
      grid-template-columns: 1fr;
    }
  }
  .choice {
    border: 2px solid var(--line);
    border-radius: $radius-lg;
    padding: space(3) space(3) + 2;
    cursor: pointer;
    background: var(--card-solid);
    &:has(input:checked) {
      border-color: var(--accent);
      background: var(--accent-soft);
    }
    input {
      margin-right: space(1) + 2;
      accent-color: var(--accent);
    }
    small {
      display: block;
      color: var(--muted);
      margin-top: space(1);
    }
  }
  .more summary {
    cursor: pointer;
    font-weight: $weight-semibold;
    color: var(--accent);
  }
  .first {
    margin-top: space(2) + 2;
  }
  textarea {
    min-height: 70px;
    resize: vertical;
    font-family: $font-mono;
    font-size: fs(sm);
  }
  .ac {
    padding-left: 26px;
  }
  .auto {
    width: auto;
  }
</style>
