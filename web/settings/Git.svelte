<script lang="ts">
  import Switch from "../components/Switch.svelte";
  import TextSetting from "../components/TextSetting.svelte";
  import { api } from "../lib/api.ts";
  import { app, toast } from "../lib/app.svelte.ts";
  import type { GitSettings } from "../lib/types.ts";
  import Row from "./Row.svelte";

  const g = $derived(app.settings!.git);
  const missing = $derived(!g.name || !g.email);
  let jira = $state(localStorage.getItem("ferry-jira-prefix") !== "off");

  /** Saves global git settings (git config --global) and keeps the page in step. */
  async function save(body: Partial<GitSettings>, done: string): Promise<boolean> {
    try {
      app.settings!.git = await api<GitSettings>("POST", "/settings/git", body);
      toast(done, { mood: "wink" });
      return true;
    } catch (e) {
      toast((e as Error).message, { error: true });
      return false;
    }
  }
</script>

<div class="banner" class:warn={missing}>
  {#if missing}
    Git needs a name and an email before it can make a commit. They're not an account: git just writes them on each commit, and GitHub or GitLab use the email to link commits to you.
  {:else}
    These are your global git settings (git config --global), so they apply to every repository, in Ferry and anywhere else you use git.
  {/if}
</div>

<div class="group">Commit identity</div>
<Row label="Name" hint="Written on every commit you make">
  <TextSetting label="Name" value={g.name} placeholder="Your name" save={(v) => save({ name: v }, "Saved your name")} />
</Row>
<Row label="Email" hint="Use the one your GitHub or GitLab account knows, so commits link to you">
  <TextSetting label="Email" value={g.email} placeholder="you@example.com" save={(v) => save({ email: v }, "Saved your email")} />
</Row>

<div class="group">Defaults</div>
<Row label="Default branch" hint="The first branch of a repository you create">
  <TextSetting label="Default branch" value={g.default_branch} placeholder="main"
    save={(v) => save({ default_branch: v }, v ? `New repositories start on ${v}` : "Using git's default branch name")} />
</Row>
<Row label="When pulling" hint="If both you and the remote have new commits">
  <select aria-label="When pulling" value={g.pull} onchange={(e) => { const v = e.currentTarget.value; void save({ pull: v }, v ? `Pulling will ${v}` : "I'll ask when it matters"); }}>
    <option value="">Ask me each time</option><option value="merge">Merge both histories</option><option value="rebase">Rebase: mine on top</option>
  </select>
</Row>
<Row label="Sign commits" hint="Needs a GPG or SSH signing key set up in git">
  <Switch label="Sign commits" checked={g.sign} onchange={(on) => save({ sign: on }, on ? "Commits will be signed" : "Commits won't be signed")} />
</Row>
<Row label="Jira issue key in commits" hint="On a branch named after an issue (SHOP-42-…), start each commit message with its key">
  <Switch label="Jira issue key in commits" checked={jira} onchange={(on) => {
    jira = on;
    localStorage.setItem("ferry-jira-prefix", on ? "on" : "off");
    toast(on ? "Issue keys go into commit messages" : "Commit messages stay as you write them", { mood: "wink" });
  }} />
</Row>
<Row label="AI commit messages" hint={app.settings!.ai.configured ? "“Write it for me” uses your Anthropic API key" : "Set ANTHROPIC_API_KEY in your terminal, then start ferry again"}>
  <span class="pill" class:green={app.settings!.ai.configured} class:amber={!app.settings!.ai.configured}>{app.settings!.ai.configured ? "Ready" : "Not set up"}</span>
</Row>

<style lang="scss">
  @use "tokens" as *;

  .banner {
    margin: space(3) + 2 space(5) + 2 2px; padding: space(2) + 2 space(3) + 2; border-radius: $radius-md;
    background: var(--accent-soft); color: var(--text); font-size: fs(sm) + .5;
    &.warn { background: var(--amber-soft); color: var(--amber); }
  }
  .group {
    padding: space(4) space(5) + 2 0; font-size: 12px; font-weight: $weight-bold; letter-spacing: .06em; text-transform: uppercase; color: var(--muted);
    + :global(.row) { padding-top: space(2) + 2; }
  }
</style>
