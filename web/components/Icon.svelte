<script lang="ts">
  import { ICONS } from "../lib/icons.ts";

  let { name, size = 20 }: { name: string; size?: number } = $props();
</script>

<!-- the markup comes from our own icon table, never from user text -->
<svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  {@html ICONS[name] ?? ""}
</svg>
