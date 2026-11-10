<script lang="ts">
  import Drawer from "../components/Drawer.svelte";
  import { api, face } from "../lib/api.ts";
  import { act, app, toast } from "../lib/app.svelte.ts";
  import { plural } from "../lib/look.svelte.ts";

  interface Field { name: string; label: string; placeholder: string; value?: string; hint?: string; secret?: boolean }
  const SERVICES: { id: "gitlab" | "azure" | "jira"; name: string; blurb: string; fields: Field[]; help: string; link: string }[] = [
    { id: "gitlab", name: "GitLab", blurb: "Merge requests, pipelines and approvals (gitlab.com or your own server).", fields: [
      { name: "url", label: "GitLab address", placeholder: "https://gitlab.com", value: "https://gitlab.com", hint: "Just the server: https://gitlab.com, or your company's GitLab address. Not a profile or project page." },
      { name: "token", label: "Personal access token", placeholder: "glpat-…", secret: true }],
      help: "Create one under User settings → Access tokens, with the read_api scope.", link: "https://gitlab.com/-/user_settings/personal_access_tokens" },
    { id: "azure", name: "Azure DevOps", blurb: "Pull requests, reviewer votes and build status in Azure Repos.", fields: [
      { name: "org", label: "Organization", placeholder: "the name after dev.azure.com/" },
      { name: "token", label: "Personal access token", placeholder: "paste the token", secret: true }],
      help: "Create one under User settings → Personal access tokens, with Code (Read) access.", link: "https://dev.azure.com/" },
    { id: "jira", name: "Jira", blurb: "Your issues, branches named after them, and commits linked back.", fields: [
      { name: "url", label: "Jira address", placeholder: "https://your-team.atlassian.net", hint: "Just the site, like https://your-team.atlassian.net." },
      { name: "email", label: "Your Jira email", placeholder: "you@company.com" },
      { name: "token", label: "API token", placeholder: "paste the token", secret: true }],
      help: "Create an API token in your Atlassian account settings.", link: "https://id.atlassian.com/manage-profile/security/api-tokens" },
  ];

  // one form's values per service, starting from each field's default
  const values = $state(Object.fromEntries(SERVICES.map((s) => [s.id, Object.fromEntries(s.fields.map((f) => [f.name, f.value ?? ""]))])) as Record<string, Record<string, string>>);
  let busy = $state("");
  const count = $derived(SERVICES.filter((s) => app.conns?.[s.id]?.connected).length);

  $effect(() => { void app.loadConnections(); });

  async function connect(id: string, name: string) {
    busy = id;
    const body = Object.fromEntries(Object.entries(values[id]!).map(([k, v]) => [k, v.trim()]));
    const r = await act(null, () => api<{ user: string }>("POST", `/connections/${id}`, body));
    busy = "";
    if (r) {
      toast(`Connected to ${name} as ${r.user}`, { mood: "party" });
      values[id]!.token = "";
      await app.loadConnections();
    }
  }
  async function disconnect(id: string, name: string) {
    await act(`Disconnected ${name}`, () => api("POST", `/connections/${id}/remove`), "sleepy");
    await app.loadConnections();
  }
</script>

<Drawer title="Connections" sub="Let Ferry talk to the services you use" onclose={() => (app.connectionsOpen = false)}>
  <div class="narrator">
    <img src={face(count ? "happy" : "excited")} alt="" />
    <div class="bubble">
      <div class="say">{count ? `I'm connected to ${plural(count, "service")}.` : "Which services do you use?"}</div>
      <div class="hint">Tokens stay on this computer, in a file only you can read. The browser never sees them.</div>
    </div>
  </div>

  <div class="service">
    <div class="head"><div><b>GitHub</b><small>Pull requests and their checks.</small></div><span class="pill">via gh CLI</span></div>
    <p class="hint">GitHub uses the GitHub CLI: install it and run “gh auth login” in a terminal. Nothing to enter here.</p>
  </div>

  {#each SERVICES as s (s.id)}
    {@const c = app.conns?.[s.id]}
    <div class="service">
      <div class="head">
        <div><b>{s.name}</b><small>{s.blurb}</small></div>
        <span class="pill" class:green={c?.connected}>{c?.connected ? "✓ connected" : "not connected"}</span>
      </div>
      {#if c?.connected}
        <p class="hint">As {c.user || "you"} · {c.where}</p>
        {#if c.fromEnv}
          <p class="hint">Set by environment variables where ferry runs; change them there.</p>
        {:else}
          <button class="btn small ghost danger" onclick={() => disconnect(s.id, s.name)}>Disconnect</button>
        {/if}
      {:else}
        <form onsubmit={(e) => { e.preventDefault(); void connect(s.id, s.name); }}>
          {#each s.fields as f (f.name)}
            <label class="field">
              <span class="label">{f.label}</span>
              <input type={f.secret ? "password" : "text"} placeholder={f.placeholder} autocomplete="off" bind:value={values[s.id]![f.name]} />
              {#if f.hint}<small>{f.hint}</small>{/if}
            </label>
          {/each}
          <div class="foot">
            <span class="hint">{s.help} <a href={s.link} target="_blank" rel="noopener noreferrer">Create a token</a></span>
            <button class="btn brand small" disabled={busy === s.id}>{busy === s.id ? "Checking…" : "Connect"}</button>
          </div>
        </form>
      {/if}
    </div>
  {/each}
</Drawer>

<style lang="scss">
  @use "tokens" as *;

  .service { margin-bottom: space(3); padding: space(3) + 2 space(4); border-radius: $radius-lg; background: var(--card2); }
  .head {
    display: flex; justify-content: space-between; align-items: flex-start; gap: space(2) + 2; flex-wrap: wrap;
    b { font-size: 16px; } small { display: block; color: var(--muted); font-size: fs(sm) + .5; }
  }
  .hint { color: var(--muted); font-size: fs(sm); margin: space(2) 0; }
  form { margin-top: space(3); }
  .foot { display: flex; justify-content: space-between; align-items: center; gap: space(3); flex-wrap: wrap; .hint { margin: 0; } }
</style>
