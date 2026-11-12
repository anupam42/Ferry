<script lang="ts">
  import Icon from "../components/Icon.svelte";
  import { api } from "../lib/api.ts";
  import { git } from "../lib/git.svelte.ts";
  import type { RepoVisibility } from "../lib/types.ts";

  /**
   * Public, Private, Internal or Local only, beside a repository's name: who can see it on its
   * host. Asked once per repository (the server keeps the answer for ten minutes); nothing shows
   * while it's being asked or when the host can't tell.
   */
  let { id, size = "small" }: { id: string; size?: "small" | "large" } = $props();

  $effect(() => {
    if (id in git.visibility) return;
    git.visibility[id] = null; // asking
    api<RepoVisibility>("GET", `/git/${id}/visibility`).then(
      (v) => (git.visibility[id] = v),
      () => (git.visibility[id] = { visibility: "unknown", host: "", sure: false }),
    );
  });

  const v = $derived(git.visibility[id]);
  const LOOK = {
    public: { icon: "globe", text: "Public" },
    private: { icon: "lock", text: "Private" },
    internal: { icon: "lock", text: "Internal" },
    local: { icon: "folder", text: "Local only" },
  } as const;
  const look = $derived(v && v.visibility !== "unknown" ? LOOK[v.visibility] : null);
  const why = $derived.by(() => {
    if (!v) return "";
    const on = v.host || "its host";
    switch (v.visibility) {
      case "public":
        return `Anyone can see this repository on ${on}.`;
      case "private":
        return v.sure
          ? `Only people you've given access can see this repository on ${on}.`
          : `${on} doesn't show this repository to anyone signed out, so it's private (or the address is wrong). Sign in (gh auth login, or Connections for GitLab) to be sure.`;
      case "internal":
        return `Anyone in your organisation on ${on} can see this repository.`;
      case "local":
        return "This repository has no remote: it's only on this computer.";
      default:
        return "";
    }
  });
</script>

{#if look}
  <span
    class="vis {v!.visibility} {size}"
    class:unsure={!v!.sure}
    title={why}
    aria-label="{look.text}{v!.sure ? '' : ' (probably)'}: {why}"
  >
    <Icon name={look.icon} size={size === "large" ? 14 : 11} />{look.text}
  </span>
{/if}

<style lang="scss">
  @use "tokens" as *;
  .vis {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    flex: none;
    border: 1px solid var(--line);
    border-radius: $radius-pill;
    color: var(--muted);
    font-weight: $weight-semibold;
    white-space: nowrap;
    line-height: 1;
    &.small {
      font-size: 10.5px;
      padding: 3px 7px;
    }
    &.large {
      font-size: 12.5px;
      padding: 5px 10px;
    }
    // public is the one worth noticing: anyone can read it
    &.public {
      color: var(--amber);
      border-color: color-mix(in srgb, var(--amber) 45%, transparent);
    }
    &.local {
      border-style: dashed;
    }
    &.unsure {
      border-style: dashed;
    }
  }
</style>
