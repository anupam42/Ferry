<script lang="ts">
  import Icon from "./Icon.svelte";
  import { fileIcon, folderIcon } from "../lib/fileicons.ts";
  import { fileIcons, loadFileIcons } from "../lib/fileicons.svelte.ts";

  /** A file's or folder's icon, like a code editor's file tree: Svelte, Rust, Angular, Docker and so on. */
  let {
    name,
    dir = false,
    up = false,
    size = 20,
  }: { name: string; dir?: boolean; up?: boolean; size?: number } = $props();
  loadFileIcons();
  const icon = $derived(up ? null : fileIcons.data?.[dir ? folderIcon(name) : fileIcon(name)]);
</script>

{#if icon}
  <svg class="ic" viewBox="0 0 {icon.w} {icon.h}" width={size} height={size} aria-hidden="true">
    <!-- the markup comes from our own generated icon table (fileicons.json, served as /icons.json), never from user text -->
    <!-- eslint-disable-next-line svelte/no-at-html-tags -->
    {@html icon.body}
  </svg>
{:else if up}
  <span class="ic up" style:width="{size}px" style:height="{size}px"><Icon name="up" size={size - 2} /></span>
{:else}
  <!-- the icons are still loading: keep the space, so nothing moves when they arrive -->
  <span class="ic" style:width="{size}px" style:height="{size}px"></span>
{/if}

<style lang="scss">
  .ic {
    flex: none;
    display: inline-grid;
    place-items: center;
  }
  .up {
    color: var(--muted);
  }
</style>
