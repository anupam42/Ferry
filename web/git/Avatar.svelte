<script lang="ts">
  import { avatar } from "../lib/graph.ts";
  let { author, email = "", size = 28 }: { author: string; email?: string; size?: number } = $props();
  const a = $derived(avatar(author, email));
</script>

<span class="avatar" style:background={a.colour} style:width="{size}px" style:height="{size}px" aria-hidden="true">{a.initials}</span>

<style lang="scss">
  @use "tokens" as *;
  .avatar { border-radius: 50%; display: grid; place-items: center; flex: none; color: #fff; font-size: 11px; font-weight: $weight-heavy; letter-spacing: .02em; }
</style>
