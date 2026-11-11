<script lang="ts">
  import Icon from "../components/Icon.svelte";
  import RelayLoading from "../components/RelayLoading.svelte";
  import { app } from "../lib/app.svelte.ts";
  import About from "./About.svelte";
  import Appearance from "./Appearance.svelte";
  import Connections from "./Connections.svelte";
  import Data from "./Data.svelte";
  import Git from "./Git.svelte";
  import Notifications from "./Notifications.svelte";
  import Updates from "./Updates.svelte";

  const SECTIONS = [
    { id: "appearance", name: "Appearance", icon: "palette", view: Appearance, needs: false },
    { id: "git", name: "Git", icon: "branch", view: Git, needs: true },
    { id: "notifications", name: "Notifications", icon: "bell", view: Notifications, needs: false },
    { id: "connections", name: "Connections", icon: "plug", view: Connections, needs: false },
    { id: "data", name: "Data", icon: "db", view: Data, needs: true },
    { id: "updates", name: "Updates", icon: "sparkle", view: Updates, needs: false },
    { id: "about", name: "About", icon: "info", view: About, needs: false },
  ];
  const current = $derived(SECTIONS.find((s) => s.id === app.section) ?? SECTIONS[0]!);

  function pick(id: string) {
    app.section = id;
    localStorage.setItem("ferry-settings-sec", id);
  }
</script>

<div class="page">
  <div class="eyebrow"><Icon name="gear" size={15} />Preferences</div>
  <h1>Settings</h1>
  <p class="sub">How Ferry looks, and how it works with git on this computer.</p>
  <div class="grid">
    <nav aria-label="Settings sections">
      {#each SECTIONS as s (s.id)}
        <button
          class:on={s.id === current.id}
          aria-current={s.id === current.id ? "page" : undefined}
          onclick={() => pick(s.id)}
        >
          <Icon name={s.icon} size={18} />{s.name}
        </button>
      {/each}
    </nav>
    <section class="card panel" aria-labelledby="set-title">
      <header>
        <span class="chip"><Icon name={current.icon} size={18} /></span>
        <h2 id="set-title">{current.name}</h2>
      </header>
      {#if current.needs && !app.settings && !app.settingsError}
        <RelayLoading say="Looking at your settings" card={false} />
      {:else if current.needs && app.settingsError}
        <p class="error">Couldn't read your settings: {app.settingsError}</p>
      {:else}
        <current.view />
      {/if}
    </section>
  </div>
</div>

<style lang="scss">
  @use "tokens" as *;
  @use "mixins" as *;

  .page {
    max-width: 1120px;
    margin: 0 auto;
    padding: space(3) + 2 space(6) space(10);
  }
  .eyebrow {
    display: flex;
    align-items: center;
    gap: space(2);
    color: var(--muted);
    font-size: fs(sm);
    font-weight: $weight-bold;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  h1 {
    margin: space(2) 0 space(1);
    font-size: fs(xxl);
    letter-spacing: -0.01em;
  }
  .sub {
    margin: 0 0 space(5) + 2;
    color: var(--muted);
  }
  .grid {
    display: grid;
    grid-template-columns: 220px minmax(0, 1fr);
    gap: space(6);
    align-items: start;
  }
  nav {
    display: flex;
    flex-direction: column;
    gap: space(1);
    position: sticky;
    top: space(4) + 2;
    button {
      display: flex;
      align-items: center;
      gap: space(3);
      padding: space(2) + 2 space(3) + 2;
      border: 0;
      border-radius: $radius-md;
      background: none;
      color: var(--muted);
      font-size: fs(md);
      font-weight: $weight-medium;
      text-align: left;
      cursor: pointer;
      &:hover {
        background: var(--card2);
        color: var(--text);
      }
      &.on {
        background: var(--accent-soft);
        color: var(--accent);
        font-weight: $weight-semibold;
      }
    }
  }
  .panel {
    overflow: hidden;
  }
  header {
    display: flex;
    align-items: center;
    gap: space(3);
    padding: space(4) space(5) + 2;
    border-bottom: 1px solid var(--line);
    h2 {
      font-size: fs(lg);
    }
  }
  .chip {
    width: 34px;
    height: 34px;
    border-radius: $radius-md - 2;
    display: grid;
    place-items: center;
    background: var(--accent-soft);
    color: var(--accent);
  }
  .error {
    padding: space(4) space(5) + 2;
    color: var(--red);
  }
  @include below(tablet) {
    .grid {
      grid-template-columns: 1fr;
    }
    nav {
      position: static;
      flex-direction: row;
      flex-wrap: wrap;
    }
  }
  @include below(phone) {
    .page {
      padding: space(1) + 2 space(1) space(8);
    }
  }
</style>
