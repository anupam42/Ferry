<script lang="ts">
  import Icon from "../components/Icon.svelte";
  import { face } from "../lib/api.ts";
  import { plural } from "../lib/format.ts";
  import { releases } from "../lib/releases.svelte.ts";
  import { countdown, noticeKey, relCount, type Notice } from "../lib/releases.ts";

  /**
   * A small card that hangs from the top edge on two strings: a new version,
   * a planned release counting down, or the one being built. It folds up into
   * a tag with Relay on it, or goes away until the next release.
   */
  let { n }: { n: Notice } = $props();
  const key = $derived(noticeKey(n));
  const folded = $derived(releases.folded === key);
  let swing = $state(false);
  let leaving = $state(false);
  let tag = $state<HTMLButtonElement>();
  let foldBtn = $state<HTMLButtonElement>();

  // a countdown ticks every second (and becomes "it may be out now" at zero)
  $effect(() => {
    if (n.kind !== "countdown") return;
    const t = setInterval(() => (releases.now = Date.now()), 1000);
    return () => clearInterval(t);
  });
  const left = $derived("at" in n ? n.at - releases.now : 0);
  const when = $derived("at" in n ? new Date(n.at) : null);

  const MOOD = { available: "excited", countdown: "excited", due: "surprised", soon: "excited", new: "party" } as const;
  const TAG = { available: "Update", countdown: "", due: "Out now?", soon: "Soon", new: "New" } as const;
  const action = $derived.by((): [string, () => void] => {
    switch (n.kind) {
      case "available":
        return ["How to update", () => releases.go("settings-updates")];
      case "countdown":
        return ["What's coming", () => releases.openWhatsNew(n.version)];
      case "due":
        return ["Check for updates", () => releases.go("settings-updates")];
      case "soon":
        return ["Preview", () => releases.openWhatsNew(n.version)];
      case "new":
        return ["See what's new", () => releases.openWhatsNew()];
    }
  });

  function setFolded(on: boolean) {
    releases.fold(key, on);
    swing = false;
    requestAnimationFrame(() => {
      swing = true;
      (on ? tag : foldBtn)?.focus();
    });
  }
  function dismiss() {
    leaving = true;
    setTimeout(() => releases.dismiss(key), 320);
  }
</script>

<div class="rn k-{n.kind}" class:collapsed={folded} class:swing class:leaving role="region" aria-label="Release notice">
  <span class="pin l" aria-hidden="true"></span><span class="pin r" aria-hidden="true"></span>
  <div class="card-rn">
    {#if folded}
      <button
        type="button"
        class="tag"
        bind:this={tag}
        aria-label="Ferry {n.version}: show the notice"
        onclick={() => setFolded(false)}
      >
        <img src={face(MOOD[n.kind])} alt="" />
        <span class="tag-text"
          ><b>{n.version}</b><small>{n.kind === "countdown" ? countdown(left, true) : TAG[n.kind]}</small></span
        >
      </button>
    {:else}
      <div class="full">
        <img class="face" src={face(MOOD[n.kind])} alt="" />
        <span class="text">
          {#if n.kind === "available"}Ferry <b>{n.version}</b> is out. You're on {n.current}.
          {:else if n.kind === "countdown"}On <b
              >{when!.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</b
            >
            at <b>{when!.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</b>, Ferry {n.version} will
            be released
          {:else if n.kind === "due"}Ferry <b>{n.version}</b> was planned for {when!.toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            })}: it may be out now
          {:else if n.kind === "soon"}Ferry <b>{n.version}</b> is on its way · {plural(relCount(n.release), "change")} so
            far
          {:else}Ferry <b>{n.version}</b> is here{#if n.release.summary}: <span class="sum">{n.release.summary}</span
              >{/if}{/if}
        </span>
        {#if n.kind === "countdown"}<span class="count" role="timer" aria-label="Time left">{countdown(left)}</span
          >{/if}
        <button type="button" class="btn small go" onclick={action[1]}>{action[0]}</button>
        <button
          type="button"
          class="rn-btn fold"
          bind:this={foldBtn}
          aria-label="Fold it up"
          title="Fold it up"
          onclick={() => setFolded(true)}><Icon name="caret" size={16} /></button
        >
        <button
          type="button"
          class="rn-btn"
          aria-label="Dismiss for this release"
          title="Dismiss for this release"
          onclick={dismiss}><Icon name="close" size={16} /></button
        >
      </div>
    {/if}
  </div>
</div>

<style lang="scss">
  @use "tokens" as *;
  @use "mixins" as *;
  // under drawers and dialogs, over the page
  .rn {
    --hang: 16px;
    position: fixed;
    top: 0;
    left: 50%;
    z-index: z(drawer) - 1;
    transform: translateX(-50%);
    padding-top: var(--hang);
    pointer-events: none;
    max-width: calc(100vw - 24px);
    > * {
      pointer-events: auto;
    }
  }
  .pin {
    position: absolute;
    top: 0;
    width: 2px;
    height: calc(var(--hang) + 6px);
    background: linear-gradient(var(--faint), color-mix(in srgb, var(--faint) 60%, transparent));
    border-radius: 2px;
    @include motion {
      transition:
        left 0.35s cubic-bezier(0.3, 1.3, 0.5, 1),
        right 0.35s cubic-bezier(0.3, 1.3, 0.5, 1),
        height 0.35s;
    }
    &::after {
      content: "";
      position: absolute;
      left: 50%;
      bottom: -3px;
      width: 8px;
      height: 8px;
      margin-left: -4px;
      border-radius: 50%;
      border: 2px solid var(--faint);
      background: var(--card-solid);
    }
    &.l {
      left: 26px;
    }
    &.r {
      right: 26px;
    }
  }
  .card-rn {
    position: relative;
    transform-origin: 50% calc(var(--hang) * -1);
    border-radius: $radius-lg;
    background: var(--card-solid);
    box-shadow:
      0 14px 34px rgba(9, 35, 72, 0.18),
      0 2px 6px rgba(9, 35, 72, 0.08);
    border: 1px solid color-mix(in srgb, var(--accent) 18%, var(--line));
    @include motion {
      animation: rn-drop 0.9s cubic-bezier(0.3, 1.25, 0.5, 1) backwards;
    }
  }
  @include motion {
    .rn.swing .card-rn {
      animation: rn-swing 0.8s cubic-bezier(0.3, 1.2, 0.5, 1);
    }
    .rn:not(.collapsed) .card-rn:hover {
      animation: rn-sway 2.4s ease-in-out infinite;
    }
    .rn.collapsed .card-rn {
      animation: rn-idle-sway 4s ease-in-out infinite;
    }
    .rn.collapsed.swing .card-rn {
      animation: rn-swing 0.8s cubic-bezier(0.3, 1.2, 0.5, 1);
    }
    .face {
      animation: relay-idle 5.5s ease-in-out infinite;
      transform-origin: 50% 85%;
    }
    .tag:hover img {
      animation: relay-wiggle 0.55s ease-in-out infinite alternate;
    }
  }
  .rn.leaving {
    .card-rn {
      animation: rn-up 0.32s cubic-bezier(0.5, 0, 0.75, 0) forwards;
    }
    .pin {
      opacity: 0;
      transition: opacity 0.2s;
    }
  }
  .full {
    display: flex;
    align-items: center;
    gap: space(2) + 2;
    padding: space(2) space(2) space(2) space(2) + 2;
    white-space: nowrap;
  }
  .face {
    width: 40px;
    height: 31px;
    flex: none;
  }
  .text {
    font-size: 13.5px;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
    b {
      font-weight: $weight-heavy;
    }
    .sum {
      color: var(--muted);
    }
  }
  .count {
    flex: none;
    font: $weight-heavy 13px $font-mono;
    color: #fff;
    padding: space(1) + 2 space(3);
    border-radius: $radius-pill;
    background: linear-gradient(135deg, #f28a3c, #ef5d5d);
    box-shadow: 0 4px 12px rgba(239, 93, 93, 0.3);
    font-variant-numeric: tabular-nums;
  }
  .go {
    flex: none;
  }
  .k-available .go,
  .k-new .go {
    @include brand-gradient;
    color: #fff;
  }
  .rn-btn {
    flex: none;
    width: 30px;
    height: 30px;
    border: 0;
    border-radius: 50%;
    background: none;
    color: var(--muted);
    display: grid;
    place-items: center;
    cursor: pointer;
    &:hover {
      background: var(--card2);
      color: var(--text);
    }
    &:focus-visible {
      outline: none;
      box-shadow: 0 0 0 2.5px var(--accent);
    }
    &.fold :global(svg) {
      transform: rotate(180deg);
    }
  }
  .tag {
    display: flex;
    align-items: center;
    gap: space(2);
    border: 0;
    background: none;
    padding: space(1) + 2 space(3) space(1) + 2 space(2);
    border-radius: $radius-lg;
    cursor: pointer;
    color: var(--text);
    font: inherit;
    img {
      width: 30px;
      height: 23px;
    }
    &:focus-visible {
      outline: none;
      box-shadow: 0 0 0 2.5px var(--accent);
    }
  }
  .tag-text {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    line-height: 1.1;
    b {
      font: $weight-heavy 12.5px $font-mono;
    }
    small {
      font-size: 11px;
      font-weight: $weight-bold;
      color: var(--accent);
      font-variant-numeric: tabular-nums;
    }
  }
  .k-countdown .tag-text small {
    color: #e0592a;
  }
  .rn.collapsed {
    --hang: 10px;
    .card-rn {
      border-radius: $radius-lg - 2;
    }
    .pin.l {
      left: 18px;
    }
    .pin.r {
      right: 18px;
    }
  }
  @include below(phone) {
    .text {
      white-space: normal;
    }
    .full {
      white-space: normal;
      flex-wrap: wrap;
    }
  }
  @keyframes rn-drop {
    0% {
      transform: translateY(-140%) rotate(0);
    }
    45% {
      transform: translateY(0) rotate(4deg);
    }
    65% {
      transform: rotate(-2.5deg);
    }
    82% {
      transform: rotate(1.2deg);
    }
    100% {
      transform: rotate(0);
    }
  }
  @keyframes rn-swing {
    0% {
      transform: rotate(0);
    }
    25% {
      transform: rotate(3.5deg);
    }
    50% {
      transform: rotate(-2.5deg);
    }
    75% {
      transform: rotate(1deg);
    }
    100% {
      transform: rotate(0);
    }
  }
  @keyframes rn-sway {
    0%,
    100% {
      transform: rotate(0);
    }
    30% {
      transform: rotate(0.8deg);
    }
    70% {
      transform: rotate(-0.8deg);
    }
  }
  @keyframes rn-idle-sway {
    0%,
    100% {
      transform: rotate(-1.5deg);
    }
    50% {
      transform: rotate(1.5deg);
    }
  }
  @keyframes rn-up {
    to {
      transform: translateY(-160%) rotate(-3deg);
      opacity: 0;
    }
  }
</style>
