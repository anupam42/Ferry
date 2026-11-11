<script lang="ts">
  import Icon from "../components/Icon.svelte";
  import Markdown from "../components/Markdown.svelte";
  import InlineMd from "../components/InlineMd.svelte";
  import RelayLoading from "../components/RelayLoading.svelte";
  import Switch from "../components/Switch.svelte";
  import { toast } from "../lib/app.svelte.ts";
  import { plural } from "../lib/format.ts";
  import { releases } from "../lib/releases.svelte.ts";
  import { INSTALL_NAME, REL_KIND, relCount, relWhen } from "../lib/releases.ts";
  import type { LatestRelease } from "../lib/types.ts";

  /** The update check (off until you turn it on; Check now always works), What's new, and every release. */
  $effect(() => { void releases.load(); });
  const rel = $derived(releases.info);
  const inDev = $derived(!!rel && (rel.dev || rel.commit === "dev"));
  type Up = { s: "idle" } | { s: "busy" } | { s: "error"; msg: string } | { s: "done"; r: LatestRelease };
  let up = $state<Up>(releases.checkOn && releases.last ? { s: "done", r: releases.last.r } : { s: "idle" });
  let openRel = $state<Record<string, boolean>>({});

  async function check(force: boolean) {
    up = { s: "busy" };
    try { const r = await releases.check(force); up = r ? { s: "done", r } : { s: "idle" }; }
    catch (e) { up = { s: "error", msg: (e as Error).message }; }
  }
  function auto(on: boolean) { releases.setCheck(on); if (on) void check(false); else up = { s: "idle" }; }
  async function copy(text: string, what: string) {
    try { await navigator.clipboard.writeText(text); toast(`Copied ${what}`, { mood: "wink" }); } catch { toast("Couldn't copy to the clipboard", { error: true }); }
  }
  const isOpen = (v: string, i: number) => openRel[v] ?? i === 0;
</script>

{#if releases.error}<p class="muted pad">{releases.error}</p>
{:else if !rel}<div class="pad"><RelayLoading say="Reading the release notes" card={false} /></div>
{:else}
  {@const top = rel.releases[0]}
  <div class="now">
    <div class="main">
      <span class="label">You're on</span>
      <div class="name"><b>Ferry</b><span class="ver">{rel.version || "unknown"}</span>{#if inDev}<span class="pill amber">development build</span>{/if}</div>
      {#if top}<p>{top.unreleased ? `Next up: ${top.version}. ${top.summary}` : top.summary}</p>{/if}
    </div>
    <button class="btn brand" onclick={() => releases.openWhatsNew()}><Icon name="sparkle" size={16} />What's new</button>
  </div>

  <section class="block">
    <div class="head">
      <span class="ic"><Icon name="down" size={16} /></span><b>Check for updates</b><span class="grow"></span>
      <span class="auto"><Switch label="Check for updates once a day" checked={releases.checkOn} onchange={auto} /><span>Check daily</span></span>
      <button class="btn small" disabled={up.s === "busy"} onclick={() => check(true)}><Icon name="sync" size={16} />Check now</button>
    </div>
    <div class="up" aria-live="polite">
      {#if up.s === "idle"}<span class="muted">{releases.checkOn ? "Checks once a day." : "Ferry doesn't look for updates on its own. Press Check now, or turn on the daily check."}</span>
      {:else if up.s === "busy"}<span class="muted">Asking GitHub…</span>
      {:else if up.s === "error"}<span class="state warn"><Icon name="warn" size={18} />{up.msg}</span>
      {:else if up.r.newer}
        <div class="state new"><Icon name="sparkle" size={18} /><span><b>Ferry {up.r.version} is out</b>{up.r.date ? ` · ${new Date(up.r.date + "T12:00:00").toLocaleDateString()}` : ""} · you have {up.r.current}</span></div>
        <p class="muted how">{rel.install.update ? `You installed Ferry ${INSTALL_NAME[rel.install.method]}, so this updates it:` : "Download the new version and replace this one:"}</p>
        {#if rel.install.update}
          <div class="cmd"><code>{rel.install.update}</code><button class="btn small" onclick={() => copy(rel.install.update, "the command")}><Icon name="copy" size={16} />Copy</button></div>
        {:else}<a class="btn small brand" href="https://github.com/anupam42/Ferry/releases/latest" target="_blank" rel="noopener noreferrer">Download the latest</a>{/if}
        {#if up.r.notes}<details class="notes"><summary>Release notes on GitHub</summary><Markdown text={up.r.notes} /></details>{/if}
        <a class="btn small ghost open" href={up.r.url} target="_blank" rel="noopener noreferrer">Open the release</a>
      {:else}<div class="state ok"><Icon name="check" size={18} /><span><b>You're up to date</b> · {up.r.version ? "latest is " + up.r.version : "nothing newer"}</span></div>{/if}
    </div>
    <p class="privacy">Checking asks GitHub for the newest release. Nothing about you or your files is sent.</p>
  </section>

  <section class="block">
    <div class="head">
      <span class="ic"><Icon name="list" size={16} /></span><b>All releases</b><span class="grow"></span>
      <a class="btn small ghost" href="https://github.com/anupam42/Ferry/blob/main/CHANGELOG.md" target="_blank" rel="noopener noreferrer">CHANGELOG.md</a>
    </div>
    <div class="tl">
      {#each rel.releases as r, i (r.version)}
        {@const n = relCount(r)}
        <div class="row">
          <button type="button" class="tl-head" aria-expanded={isOpen(r.version, i)} onclick={() => (openRel[r.version] = !isOpen(r.version, i))}>
            <span class="dot" class:dev={r.unreleased} class:latest={!r.unreleased && i === 0}></span>
            <span class="v">{r.version}</span>
            <span class="when">{relWhen(r)}</span>
            <span>{#if r.version === rel.version}<span class="pill blue">you're on this</span>{/if}</span>
            <span class="sum">{r.summary}</span>
            {#if n}<span class="changes">{plural(n, "change")}</span>{:else}<span></span>{/if}
            <span class="caret"><Icon name="caret" size={16} /></span>
          </button>
          {#if isOpen(r.version, i)}
            <div class="body">
              {#each r.groups as g (g.kind)}
                {@const [name, ic, tone] = REL_KIND[g.kind]}
                <div><span class="kind t-{tone}"><Icon name={ic} size={13} />{name}</span>
                  <ul>{#each g.items as it (it.title)}<li><b>{it.title}</b>{#if it.text}<span>&nbsp;— <InlineMd text={it.text} /></span>{/if}</li>{/each}</ul></div>
              {/each}
              {#if !n}<p class="muted">No notes here yet.</p>{/if}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  </section>
{/if}

<style lang="scss">
  @use "tokens" as *;
  @use "mixins" as *;
  .pad { padding: space(5); }
  .now { display: flex; align-items: center; gap: space(4) + 2; padding: space(5) space(5) + 2; border-bottom: 1px solid var(--line);
    background: radial-gradient(90% 160% at 100% 0%, color-mix(in srgb, var(--accent-2) 16%, transparent), transparent 60%), radial-gradient(70% 140% at 0% 0%, color-mix(in srgb, var(--accent) 12%, transparent), transparent 60%);
    .main { flex: 1; min-width: 0; } p { margin: space(1) + 2 0 0; color: var(--muted); font-size: 13.5px; } }
  .label { font-size: 11.5px; font-weight: $weight-heavy; letter-spacing: .08em; text-transform: uppercase; color: var(--faint); }
  .name { display: flex; align-items: baseline; gap: space(2) + 2; flex-wrap: wrap; b { font-size: 24px; letter-spacing: -.02em; } }
  .ver { font: $weight-bold 15px $font-mono; color: var(--accent); background: var(--accent-soft); padding: 2px space(2) + 2; border-radius: $radius-pill; }
  .block { padding: space(4) space(5) + 2 space(4) + 2; border-bottom: 1px solid var(--line); &:last-child { border-bottom: 0; } }
  .head { display: flex; align-items: center; gap: space(2) + 2; margin-bottom: space(2) + 2; flex-wrap: wrap; .grow { flex: 1; } b { font-size: 15px; } }
  .ic { width: 30px; height: 30px; border-radius: $radius-sm + 2; display: grid; place-items: center; background: var(--accent-soft); color: var(--accent); }
  .auto { display: inline-flex; align-items: center; gap: space(2); font-size: 13px; color: var(--muted); }
  .up { font-size: 13.5px; }
  .state { display: flex; align-items: center; gap: space(2); :global(svg) { flex: none; }
    &.ok :global(svg) { color: var(--green); } &.new :global(svg) { color: var(--accent); } &.warn { color: var(--amber); } }
  .how { margin: space(1) + 2 0 space(2) + 2; }
  .cmd { display: flex; align-items: center; gap: space(2); padding: space(1) + 2 space(1) + 2 space(1) + 2 space(3); border-radius: $radius-md; background: var(--card2); width: fit-content; max-width: 100%;
    code { font-size: 13px; overflow-wrap: anywhere; } }
  .notes { margin-top: space(2) + 2; summary { cursor: pointer; font-weight: $weight-semibold; font-size: 13px; } }
  .open { margin-top: space(2); }
  .privacy { margin: space(2) + 2 0 0; font-size: 12px; color: var(--faint); }
  .tl { display: flex; flex-direction: column; border-radius: $radius-lg; background: var(--card2); padding: space(1); }
  .tl-head { display: grid; grid-template-columns: 14px auto auto auto minmax(0, 1fr) auto 18px; align-items: center; gap: space(2) + 2; width: 100%; border: 0; background: none;
    padding: space(2) + 2 space(3); border-radius: $radius-md; cursor: pointer; text-align: left; color: var(--text);
    &:hover { background: var(--card-solid); }
    .caret { display: inline-flex; color: var(--faint); transform: rotate(-90deg); @include motion { transition: transform $duration-base; } }
    &[aria-expanded="true"] .caret { transform: none; } }
  .dot { width: 10px; height: 10px; border-radius: 50%; background: var(--faint);
    &.latest { background: var(--green); box-shadow: 0 0 0 3px var(--green-soft); } &.dev { background: var(--amber); box-shadow: 0 0 0 3px var(--amber-soft); } }
  .v { font: $weight-bold 14px $font-mono; }
  .when { font-size: 12.5px; color: var(--faint); white-space: nowrap; }
  .sum { color: var(--muted); font-size: 13px; @include ellipsis; }
  .changes { font-size: 12px; color: var(--faint); white-space: nowrap; }
  .body { padding: space(1) space(4) space(3) + 2 space(9); display: flex; flex-direction: column; gap: space(3);
    ul { margin: space(1) + 2 0 0; padding-left: space(4) + 2; font-size: 13.5px; line-height: 1.55; } li { margin: 3px 0; span { color: var(--muted); } } }
  .kind { display: inline-flex; align-items: center; gap: 5px; padding: 2px space(2) + 2 2px 7px; border-radius: $radius-pill; font-size: 11.5px; font-weight: $weight-heavy; letter-spacing: .04em; text-transform: uppercase;
    &.t-green { background: var(--green-soft); color: var(--green); } &.t-blue { background: var(--accent-soft); color: var(--accent); }
    &.t-violet { background: var(--violet-soft); color: var(--violet); } &.t-red { background: var(--red-soft); color: var(--red); } &.t-muted { background: var(--card-solid); color: var(--faint); } }
  @include below(tablet) { .tl-head { grid-template-columns: 14px auto minmax(0, 1fr) 18px; .when, .sum, .changes, > span:nth-child(4) { display: none; } } .body { padding-left: space(4); } }
</style>
