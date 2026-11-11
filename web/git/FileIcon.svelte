<script lang="ts">
  import Icon from "../components/Icon.svelte";
  import { fileExt, fileKind } from "../lib/files.ts";
  let { name, dir = false, up = false }: { name: string; dir?: boolean; up?: boolean } = $props();
</script>

{#if dir || up}<span class="ic k-dir"><Icon name={up ? "up" : "folder"} size={18} /></span>
{:else}<span class="ic k-{fileKind(name)}"
    ><Icon name="files" size={18} />{#if fileExt(name)}<i>{fileExt(name)}</i>{/if}</span
  >{/if}

<style lang="scss">
  @use "tokens" as *;
  .ic {
    position: relative;
    display: inline-grid;
    place-items: center;
    width: 24px;
    height: 24px;
    flex: none;
    color: var(--muted);
    i {
      position: absolute;
      bottom: -3px;
      right: -5px;
      font-style: normal;
      font-size: 8px;
      font-weight: $weight-heavy;
      text-transform: uppercase;
      padding: 0 2px;
      border-radius: 3px;
      background: var(--card-solid);
      color: inherit;
    }
  }
  .k-dir {
    color: var(--accent);
  }
  .k-code {
    color: #2a78d6;
  }
  .k-doc {
    color: #22a06b;
  }
  .k-img {
    color: #d6457a;
  }
  .k-conf {
    color: #c99a1b;
  }
  .k-web {
    color: #8b5cf6;
  }
</style>
