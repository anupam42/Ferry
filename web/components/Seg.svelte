<script lang="ts" generics="T extends string">
  /** A segmented picker: one choice of a few, as a row of pill buttons. */
  let {
    options,
    value,
    label,
    onchange,
  }: { options: readonly (readonly [T, string])[]; value: T; label: string; onchange: (v: T) => void } = $props();
</script>

<div class="seg" role="radiogroup" aria-label={label}>
  {#each options as [id, name] (id)}
    <button class:on={value === id} role="radio" aria-checked={value === id} onclick={() => onchange(id)}>{name}</button
    >
  {/each}
</div>
