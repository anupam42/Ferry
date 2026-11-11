<script lang="ts">
  import { face } from "../lib/api.ts";

  /** Relay while something loads. "comparing" is the animated diff art; other moods bob. */
  let {
    say,
    sub = "",
    mood = "focused",
    card = true,
  }: { say: string; sub?: string; mood?: string; card?: boolean } = $props();
</script>

<div class="loading" class:card role="status" aria-live="polite">
  <img src={face(mood)} alt="" class:wide={mood === "comparing"} />
  <div>
    <b>{say}<span class="dots" aria-hidden="true"><i></i><i></i><i></i></span></b>
    {#if sub}<small>{sub}</small>{/if}
  </div>
</div>

<style lang="scss">
  @use "tokens" as *;
  @use "mixins" as *;

  .loading {
    display: flex;
    align-items: center;
    gap: space(4) + 2;
    padding: space(5) space(6);
  }
  img {
    width: 92px;
    height: 68px;
    flex: none;
    @include motion {
      animation: bob 2.4s ease-in-out infinite;
    }
    &.wide {
      width: 150px;
      height: 71px;
      animation: none;
    }
  }
  b {
    display: block;
    font-size: 15px;
  }
  small {
    display: block;
    color: var(--muted);
    font-size: fs(sm);
    margin-top: 3px;
  }
  .dots i {
    display: inline-block;
    width: 5px;
    height: 5px;
    margin-left: 3px;
    border-radius: 50%;
    background: currentColor;
    opacity: 0.25;
    vertical-align: middle;
    @include motion {
      animation: dot 1.2s ease-in-out infinite;
    }
    &:nth-child(2) {
      animation-delay: 0.2s;
    }
    &:nth-child(3) {
      animation-delay: 0.4s;
    }
  }
  @keyframes bob {
    0%,
    100% {
      transform: translateY(0);
    }
    50% {
      transform: translateY(-6px);
    }
  }
  @keyframes dot {
    0%,
    100% {
      opacity: 0.25;
      transform: translateY(0);
    }
    40% {
      opacity: 1;
      transform: translateY(-3px);
    }
  }
</style>
