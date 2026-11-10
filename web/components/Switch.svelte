<script lang="ts">
  /** An on/off switch. onchange may refuse (return false) and the switch flips back. */
  let { checked, label, onchange }: { checked: boolean; label: string; onchange: (on: boolean) => boolean | void | Promise<boolean | void> } = $props();
  // follows the prop, and can still flip locally while a change is being saved
  let on = $derived(checked);

  async function change(e: Event) {
    const el = e.currentTarget as HTMLInputElement;
    if ((await onchange(el.checked)) === false) on = !el.checked;
  }
</script>

<label class="switch"><input type="checkbox" role="switch" aria-label={label} bind:checked={on} onchange={change} /><span aria-hidden="true"></span></label>
