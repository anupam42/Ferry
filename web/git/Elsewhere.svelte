<script lang="ts">
  import { face } from "../lib/api.ts";
  import { git } from "../lib/git.svelte.ts";

  /** A view that hasn't moved to the new app yet: open it on the current page. */
  let { name }: { name: string } = $props();
  function open() {
    localStorage.setItem("ferry-mode", "git");
    localStorage.setItem("ferry-repo", git.selected);
    location.href = "/";
  }
</script>

<div class="card elsewhere">
  <img src={face("focused")} alt="" />
  <div><b>{name} is still on the current page.</b><small>It's moving to this app soon. Everything works there as before.</small></div>
  <button class="btn brand" onclick={open}>Open {name.toLowerCase()}</button>
</div>

<style lang="scss">
  @use "tokens" as *;
  .elsewhere { display: flex; align-items: center; gap: space(4); padding: space(5) space(6); b { display: block; } small { display: block; color: var(--muted); }
    img { width: 92px; height: 68px; } div { flex: 1; } }
</style>
