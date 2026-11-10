<script lang="ts">
  /**
   * A reply box: one line until you click it, then a growing textarea with its
   * buttons; Ctrl+Enter (⌘+Enter) presses the last one. text is bindable, so
   * unsent words survive the conversation reloading.
   */
  let { text = $bindable(""), placeholder, actions }: {
    text?: string; placeholder: string;
    actions: { label: string; primary?: boolean; run: () => Promise<void> }[];
  } = $props();
  let open = $state(!!text);
  let busy = $state(false);
  let ta: HTMLTextAreaElement;
  $effect(() => { void text; if (!ta) return; ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 260) + "px"; });
  async function run(a: (typeof actions)[number]) {
    if (!text.trim() || busy) return;
    busy = true;
    try { await a.run(); } finally { busy = false; }
  }
</script>

<div class="compose">
  <textarea bind:this={ta} bind:value={text} rows={open ? 3 : 1} {placeholder} aria-label={placeholder} onfocus={() => (open = true)}
    onkeydown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void run(actions[actions.length - 1]!); } }}></textarea>
  {#if open || text}
    <div class="acts">
      <span class="muted hint">Markdown works · Ctrl+Enter sends</span>
      {#each actions as a (a.label)}
        <button class="btn small" class:brand={a.primary} disabled={busy || !text.trim()} onclick={() => run(a)}>{a.label}</button>
      {/each}
    </div>
  {/if}
</div>

<style lang="scss">
  @use "tokens" as *;
  .compose { margin-top: space(2); }
  textarea { width: 100%; resize: none; border: 1px solid var(--line); border-radius: $radius-md; padding: space(2) space(3); background: var(--card2); font: inherit; font-size: 13.5px; line-height: 1.5; min-height: 38px;
    &:focus { background: var(--card-solid); outline: none; border-color: var(--accent); } }
  .acts { display: flex; align-items: center; justify-content: flex-end; gap: space(2); margin-top: space(1) + 2; }
  .hint { margin-right: auto; font-size: 12px; }
</style>
