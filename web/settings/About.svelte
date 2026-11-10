<script lang="ts">
  import { api, face } from "../lib/api.ts";
  import { app } from "../lib/app.svelte.ts";
  import type { Release } from "../lib/types.ts";
  import Row from "./Row.svelte";

  const PLATFORMS: Record<string, string> = { darwin: "macOS", linux: "Linux", win32: "Windows" };
  let rel = $state<Release | null>(null);
  $effect(() => { api<Release>("GET", "/release").then((r) => (rel = r), () => (rel = null)); });
  const version = $derived(rel?.version || app.info?.version || "unknown");
  const dev = $derived(!!rel?.dev || rel?.commit === "dev");
</script>

<div class="hero">
  <img src={face("happy")} alt="Relay" />
  <div>
    <div class="name"><b>Ferry</b><span class="ver">{version}</span>{#if dev}<span class="pill amber">development build</span>{/if}</div>
    <p>Relay, the sync spirit: a friendly, floating companion that keeps your files and projects in flow.</p>
  </div>
</div>
<Row label="Version"><code>{version}</code></Row>
{#if rel}
  <Row label="Build"><code>{rel.commit && rel.commit !== "dev" ? rel.commit.slice(0, 12) : "from your working copy"}</code></Row>
  <Row label="Running on"><span>{PLATFORMS[rel.platform] ?? rel.platform} · {rel.arch} · Bun {rel.bun}{app.info?.dev ? " · dev mode (hot reload)" : ""}</span></Row>
{/if}
<Row label="Source and issues" hint="Report a bug or suggest an idea">
  <a class="btn small" href="https://github.com/anupam42/Ferry" target="_blank" rel="noopener noreferrer">Open on GitHub</a>
</Row>

<style lang="scss">
  @use "tokens" as *;
  @use "mixins" as *;

  .hero {
    display: flex; align-items: center; gap: space(4) + 2; padding: space(5) space(5) + 2; border-bottom: 1px solid var(--line);
    img { width: 120px; height: 90px; @include motion { animation: bob 3.2s ease-in-out infinite; } }
    p { margin: space(1) 0 0; color: var(--muted); max-width: 520px; }
  }
  .name { display: flex; align-items: center; gap: space(2) + 2; b { font-size: fs(lg) + 1; } }
  .ver { font-family: $font-mono; color: var(--muted); }
  @keyframes bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
</style>
