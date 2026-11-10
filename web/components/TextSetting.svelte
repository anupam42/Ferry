<script lang="ts">
  /** A text field that saves on Enter or when you leave it; Escape puts it back. */
  let { value, placeholder = "", label, save }: { value: string; placeholder?: string; label: string; save: (v: string) => Promise<boolean> } = $props();
  // both follow the prop when it changes; locally, text is what you typed and saved what's stored
  let text = $derived(value);
  let saved = $derived(value);

  async function commit() {
    if (text.trim() === saved.trim()) return;
    if (await save(text.trim())) saved = text;
    else text = saved;
  }
  function key(e: KeyboardEvent) {
    const el = e.currentTarget as HTMLInputElement;
    if (e.key === "Enter") el.blur();
    if (e.key === "Escape") { text = saved; el.blur(); }
  }
</script>

<input type="text" bind:value={text} {placeholder} aria-label={label} spellcheck="false" onblur={commit} onkeydown={key} />
