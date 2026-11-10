<script lang="ts">
  import { face } from "./lib/api.ts";
  import type { Mode } from "./lib/types.ts";

  /** Parts of Ferry that haven't moved to the new app yet: say so, and open them on the current page. */
  let { mode }: { mode: Mode } = $props();
  const name = $derived(mode === "git" ? "The Git client" : "Folder pairs");
  const open = () => {
    localStorage.setItem("ferry-mode", mode);
    location.href = "/";
  };
</script>

<section class="card moving">
  <img src={face("focused")} alt="" />
  <h1>{name} is moving in.</h1>
  <p>This new version of Ferry's app is being built one part at a time. Folder pairs and Settings are already here; {name.toLowerCase()} is still on the current page for now, and works exactly as before.</p>
  <button class="btn brand" onclick={open}>Open {name.toLowerCase()}</button>
</section>

<style lang="scss">
  @use "tokens" as *;

  .moving { text-align: center; padding: space(12) space(6); max-width: 720px; margin: space(10) auto 0; }
  img { width: 190px; height: 140px; }
  h1 { font-size: fs(xl); margin: space(3) 0 space(2); }
  p { color: var(--muted); max-width: 520px; margin: 0 auto space(5); }
</style>
