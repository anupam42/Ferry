<script lang="ts">
  import Icon from "../components/Icon.svelte";

  /** A branch or tag name on a commit. Remote branches are "<remote>/<name>"; a local "feature/x" isn't one. */
  let { ref, remotes = [], current = "" }: { ref: string; remotes?: string[]; current?: string } = $props();
  const tag = $derived(ref.startsWith("tag: "));
  const remote = $derived(!tag && remotes.some((r) => ref.startsWith(r + "/")));
  const here = $derived(!tag && ref === current);
</script>

<span class="pill ref" class:amber={tag} class:violet={remote} class:blue={!tag && !remote} class:here
  title={tag ? "tag" : remote ? "branch on the remote" : here ? "the branch you're on" : "branch"}>
  {#if tag}<Icon name="tag" size={12} />{ref.slice(5)}{:else}{ref}{/if}
</span>

<style>
  .ref { flex: none; }
  .here { box-shadow: inset 0 0 0 1.5px currentColor; font-weight: 700; }
</style>
