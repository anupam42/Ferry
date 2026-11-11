<script lang="ts" module>
  // which sections are collapsed, remembered (shared with the current page)
  const closed = $state<Record<string, boolean>>(
    Object.fromEntries((JSON.parse(localStorage.getItem("ferry-closed") || "[]") as string[]).map((k) => [k, true])),
  );
  function toggle(id: string) {
    closed[id] = !closed[id];
    localStorage.setItem("ferry-closed", JSON.stringify(Object.keys(closed).filter((k) => closed[k])));
  }
</script>

<script lang="ts">
  import type { Snippet } from "svelte";

  import Icon from "./Icon.svelte";

  /** A collapsible group like "Needs your decision 2". */
  let {
    id,
    title,
    count = null,
    tone = "",
    children,
    extra,
  }: {
    id: string;
    title: string;
    count?: number | null;
    tone?: "" | "blue" | "red";
    children: Snippet;
    extra?: Snippet;
  } = $props();
  const open = $derived(!closed[id]);
</script>

<section class="card section">
  <div class="section-head">
    <button class="section-toggle" aria-expanded={open} onclick={() => toggle(id)}>
      <span class="caret"><Icon name="caret" size={18} /></span>
      <span class="section-title"
        >{title}{#if count != null}<span class="count {tone}">{count}</span>{/if}</span
      >
    </button>
    <div class="grow"></div>
    {#if extra}{@render extra()}{/if}
  </div>
  {#if open}<div class="section-body">{@render children()}</div>{/if}
</section>
