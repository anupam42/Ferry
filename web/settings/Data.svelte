<script lang="ts">
  import { app, ask, toast } from "../lib/app.svelte.ts";
  import Row from "./Row.svelte";

  async function copy(v: string) {
    try {
      await navigator.clipboard.writeText(v);
      toast("Copied", { mood: "wink" });
    } catch {
      toast("Couldn't copy; select the text instead", { error: true });
    }
  }

  async function reset() {
    const ok = await ask({ mood: "worried", title: "Reset this page's settings?", yes: "Reset", no: "Keep them", yesMood: "sad",
      text: "Theme, accent, notification choices and what's collapsed go back to how they started. Your pairs, repositories and git settings stay as they are." });
    if (!ok) return;
    for (const k of Object.keys(localStorage)) if (k.startsWith("ferry-")) localStorage.removeItem(k);
    location.reload();
  }
</script>

{#snippet path(v: string)}
  <div class="inline"><code title={v}>{v}</code><button class="btn small" onclick={() => copy(v)}>Copy</button></div>
{/snippet}

{#if app.settings!.config_file}
  <Row label="Config file" hint="Your folder pairs and opened repositories">{@render path(app.settings!.config_file)}</Row>
{/if}
<Row label="Data folder" hint="History, backups, connection tokens (readable only by you)">{@render path(app.settings!.data_dir)}</Row>
<Row label="This browser" hint="Theme, accent and other choices on this page are saved in this browser only">
  <button class="btn small ghost danger" onclick={reset}>Reset to defaults</button>
</Row>

<style lang="scss">
  @use "tokens" as *;
  @use "mixins" as *;

  .inline { display: flex; align-items: center; gap: space(2) + 2; min-width: 0; }
  code {
    max-width: 380px; font-size: fs(sm); padding: space(1) + 2 space(2) + 2; border-radius: $radius-sm; background: var(--card2);
    @include ellipsis; direction: rtl; text-align: left; unicode-bidi: plaintext; // long paths show their end
  }
</style>
