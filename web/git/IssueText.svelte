<script lang="ts">
  import { app } from "../lib/app.svelte.ts";

  /** Text with Jira issue keys (SHOP-42) turned into links, when Jira is connected. */
  let { text }: { text: string } = $props();
  const site = $derived(app.conns?.jira.connected ? app.conns.jira.where : "");
  const parts = $derived.by(() => {
    if (!site) return [{ t: text, key: "" }];
    const out: { t: string; key: string }[] = [];
    let last = 0;
    for (const m of text.matchAll(/\b[A-Z][A-Z0-9_]+-\d+\b/g)) {
      out.push({ t: text.slice(last, m.index), key: "" }, { t: m[0], key: m[0] });
      last = m.index! + m[0].length;
    }
    out.push({ t: text.slice(last), key: "" });
    return out;
  });
</script>

{#each parts as p, i (i)}{#if p.key}<a
      href="{site}/browse/{p.key}"
      target="_blank"
      rel="noopener noreferrer"
      onclick={(e) => e.stopPropagation()}>{p.t}</a
    >{:else}{p.t}{/if}{/each}
