<script lang="ts">
  import Icon from "../components/Icon.svelte";
  import RelayLoading from "../components/RelayLoading.svelte";
  import { api, face } from "../lib/api.ts";
  import { toast } from "../lib/app.svelte.ts";
  import { intro } from "../lib/intro.svelte.ts";
  import { canPlay, opening, OPENINGS, openingSound, setOpeningSound, type OpeningSound } from "../lib/sound.ts";
  import { releases } from "../lib/releases.svelte.ts";
  import { INSTALL_NAME, PLATFORM_NAME } from "../lib/releases.ts";
  import type { Health } from "../lib/types.ts";

  // which sound the introduction opens with; choosing one plays it
  let openWith = $state<OpeningSound>(openingSound());
  let stopPreview = () => {};
  async function preview() {
    setOpeningSound(openWith);
    stopPreview();
    if (await canPlay()) stopPreview = opening(openWith);
  }
  $effect(() => () => stopPreview());

  /** This copy of Ferry: version and build, diagnostics to copy into a bug report, and the tools it needs. */
  $effect(() => {
    void releases.load();
  });
  let health = $state<Health[] | null | "error">(null);
  $effect(() => {
    api<Health[]>("GET", "/release/health").then(
      (h) => (health = h),
      () => (health = "error"),
    );
  });
  const rel = $derived(releases.info);
  const inDev = $derived(!!rel && (rel.dev || rel.commit === "dev"));
  const ver = $derived(rel?.version || "unknown");
  const facts = $derived(
    !rel
      ? []
      : [
          ["Version", ver + (inDev ? " (development)" : "")],
          ["Build", rel.commit && rel.commit !== "dev" ? rel.commit.slice(0, 12) : "from your working copy"],
          ["Built", rel.built ? new Date(rel.built).toLocaleString() : inDev ? "live, from source" : "unknown"],
          ["Installed", INSTALL_NAME[rel.install.method] ?? rel.install.method],
          ["Running on", `${PLATFORM_NAME[rel.platform] ?? rel.platform} · ${rel.arch} · Bun ${rel.bun}`],
        ],
  );

  async function diagnostics() {
    const hl = Array.isArray(health) ? health : await api<Health[]>("GET", "/release/health").catch(() => []);
    const text = [
      `Ferry ${ver}${inDev ? " (development)" : ""}`,
      ...facts.slice(1).map(([k, v]) => `${k}: ${v}`),
      `Location: ${rel?.install.where ?? ""}`,
      "",
      ...hl.map((x) => `${x.ok ? "ok  " : "miss"} ${x.name}: ${x.detail}`),
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast("Copied the diagnostics", { mood: "wink" });
    } catch {
      toast("Couldn't copy to the clipboard", { error: true });
    }
  }
</script>

{#if releases.error}<p class="muted pad">{releases.error}</p>
{:else if !rel}<div class="pad"><RelayLoading say="Looking at this copy of Ferry" card={false} /></div>
{:else}
  <div class="hero">
    <img class="face float" src={face("happy")} alt="Relay" />
    <div class="main">
      <div class="name">
        <b>Ferry</b><span class="ver">{ver}</span>{#if inDev}<span class="pill amber">development build</span>{/if}
      </div>
      <p>Relay, the sync spirit: a friendly, floating companion that keeps your files and projects in flow.</p>
      <div class="acts">
        <button class="btn small brand" onclick={diagnostics}><Icon name="copy" size={16} />Copy diagnostics</button>
        <button class="btn small" onclick={() => releases.openWhatsNew()}
          ><Icon name="sparkle" size={16} />What's new</button
        >
        <button
          class="btn small"
          onclick={() => {
            stopPreview();
            intro.show();
          }}><Icon name="play" size={16} />Meet Relay again</button
        >
        <a
          class="btn small ghost"
          href="https://github.com/anupam42/Ferry/issues/new/choose"
          target="_blank"
          rel="noopener noreferrer">Report a problem</a
        >
      </div>
      <div class="opening">
        <label for="opening-sound">The introduction opens with</label>
        <select id="opening-sound" bind:value={openWith} onchange={preview}>
          {#each OPENINGS as [k, name] (k)}<option value={k}>{name}</option>{/each}
        </select>
        <button class="btn small ghost" onclick={preview}><Icon name="sound" size={16} />Play it</button>
      </div>
    </div>
    <dl class="facts">
      {#each facts as [k, v] (k)}<dt>{k}</dt>
        <dd>{v}</dd>{/each}
    </dl>
  </div>
  <section class="block">
    <div class="head">
      <span class="ic"><Icon name="shield" size={16} /></span><b>Health</b><span class="grow"></span><span
        class="muted small">What Ferry uses on this computer</span
      >
    </div>
    {#if health === null}<span class="muted">Checking…</span>
    {:else if health === "error"}<span class="muted">Couldn't check</span>
    {:else}
      <div class="health">
        {#each health as x (x.name)}
          <div class="h" class:ok={x.ok} class:bad={!x.ok && x.needed} class:warn={!x.ok && !x.needed}>
            <span class="h-ic"><Icon name={x.ok ? "check" : "warn"} size={14} /></span>
            <div><b>{x.name}</b><small title={x.detail}>{x.detail}</small></div>
          </div>
        {/each}
      </div>
    {/if}
  </section>
  <section class="block">
    <div class="head"><span class="ic"><Icon name="info" size={16} /></span><b>Source and issues</b></div>
    <p class="muted src">Ferry is open source. Report a bug or suggest an idea, and include the diagnostics.</p>
    <div class="acts">
      <a class="btn small" href="https://github.com/anupam42/Ferry" target="_blank" rel="noopener noreferrer"
        >Open on GitHub</a
      >
      <button class="btn small ghost" onclick={() => releases.go("settings-updates")}
        ><Icon name="sparkle" size={16} />Updates and release notes</button
      >
    </div>
  </section>
{/if}

<style lang="scss">
  @use "tokens" as *;
  @use "mixins" as *;
  .opening {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: space(2);
    margin-top: space(3);
    font-size: 13px;
    color: var(--muted);
    select {
      width: auto;
      max-width: 100%;
      padding: space(1) + 2 space(3);
    }
  }
  .pad {
    padding: space(5);
  }
  .hero {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) minmax(220px, 300px);
    gap: space(4) + 2;
    align-items: center;
    padding: space(5) space(5) + 2;
    border-bottom: 1px solid var(--line);
    background: radial-gradient(90% 140% at 0% 0%, color-mix(in srgb, var(--accent) 12%, transparent), transparent 60%);
    p {
      margin: space(1) 0 space(3);
      color: var(--muted);
      font-size: 13.5px;
    }
  }
  .face {
    width: 84px;
    height: 64px;
  }
  .name {
    display: flex;
    align-items: baseline;
    gap: space(2) + 2;
    flex-wrap: wrap;
    b {
      font-size: 24px;
      letter-spacing: -0.02em;
    }
  }
  .ver {
    font: $weight-bold 15px $font-mono;
    color: var(--accent);
    background: var(--accent-soft);
    padding: 2px space(2) + 2;
    border-radius: $radius-pill;
  }
  .acts {
    display: flex;
    gap: space(2);
    flex-wrap: wrap;
  }
  .facts {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 5px space(3);
    margin: 0;
    padding: space(3) space(3) + 2;
    border-radius: $radius-lg;
    background: var(--card2);
    font-size: 12.5px;
    dt {
      color: var(--faint);
    }
    dd {
      margin: 0;
      font-weight: $weight-semibold;
      overflow-wrap: anywhere;
    }
  }
  .block {
    padding: space(4) space(5) + 2 space(4) + 2;
    border-bottom: 1px solid var(--line);
    &:last-child {
      border-bottom: 0;
    }
  }
  .head {
    display: flex;
    align-items: center;
    gap: space(2) + 2;
    margin-bottom: space(2) + 2;
    flex-wrap: wrap;
    .grow {
      flex: 1;
    }
    b {
      font-size: 15px;
    }
  }
  .ic {
    width: 30px;
    height: 30px;
    border-radius: $radius-sm + 2;
    display: grid;
    place-items: center;
    background: var(--accent-soft);
    color: var(--accent);
  }
  .small {
    font-size: 12.5px;
  }
  .src {
    margin: 0 0 space(2) + 2;
    font-size: 13.5px;
  }
  .health {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: space(2);
  }
  .h {
    display: flex;
    gap: space(2) + 2;
    align-items: center;
    padding: space(2) + 2 space(3);
    border-radius: $radius-md + 2;
    background: var(--card2);
    min-width: 0;
    > div {
      min-width: 0;
      display: flex;
      flex-direction: column;
    }
    b {
      font-size: 13.5px;
    }
    small {
      color: var(--muted);
      font-size: 12px;
      @include ellipsis;
    }
    &.ok .h-ic {
      background: var(--green-soft);
      color: var(--green);
    }
    &.warn .h-ic {
      background: var(--amber-soft);
      color: var(--amber);
    }
    &.bad .h-ic {
      background: var(--red-soft);
      color: var(--red);
    }
  }
  .h-ic {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    flex: none;
  }
  @include below(tablet) {
    .hero {
      grid-template-columns: auto minmax(0, 1fr);
    }
    .facts {
      grid-column: 1 / -1;
    }
  }
</style>
