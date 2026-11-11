<script lang="ts">
  import RelayLoading from "../components/RelayLoading.svelte";
  import Section from "../components/Section.svelte";
  import { api, face } from "../lib/api.ts";
  import { act } from "../lib/app.svelte.ts";
  import { plural } from "../lib/format.ts";
  import { git } from "../lib/git.svelte.ts";
  import { k, story } from "../lib/insights.ts";
  import type { InsightsResponse, RepoStateResponse } from "../lib/types.ts";
  import FileHeat from "./insights/FileHeat.svelte";
  import HotspotChart from "./insights/HotspotChart.svelte";
  import HourGrid from "./insights/HourGrid.svelte";
  import SyncChart from "./insights/SyncChart.svelte";
  import Together from "./insights/Together.svelte";
  import WeeklyChart from "./insights/WeeklyChart.svelte";
  import YearCalendar from "./insights/YearCalendar.svelte";

  /** A year on this branch: when and where the work happens, in words first and then in charts. */
  let { st }: { st: RepoStateResponse } = $props();
  let who = $state<"all" | "me">((sessionStorage.getItem("ferry-insights-who") as "all" | "me") || "all");
  let d = $state<InsightsResponse | null>(null);
  let loading = $state(true);

  // the repository's state is replaced every few seconds; reload only when these actually change
  const branch = $derived(st.branch);
  const head = $derived(st.head);
  $effect(() => {
    const w = who;
    void git.selected;
    void branch;
    void head;
    void git.bump;
    loading = true;
    act(null, () => api<InsightsResponse>("GET", git.url("insights") + (w === "me" ? "?author=me" : ""))).then((r) => {
      if (w !== who) return; // a newer choice is on its way
      d = r ?? d;
      loading = false;
    });
  });
  function pick(w: "all" | "me") {
    who = w;
    sessionStorage.setItem("ferry-insights-who", w);
  }

  const mine = $derived(who === "me");
  const tale = $derived(d && d.total ? story(d, mine) : null);
  const showWho = $derived(!!d && (d.authors.length > 1 || mine));
</script>

{#snippet whoSeg()}
  <div class="seg" role="radiogroup" aria-label="Whose commits">
    {#each [["all", "Everyone"], ["me", "Just me"]] as const as [id, name] (id)}
      <button role="radio" class:on={who === id} aria-checked={who === id} onclick={() => pick(id)}>{name}</button>
    {/each}
  </div>
{/snippet}

{#if !d}
  <RelayLoading say="Reading a year of history" mood="thinking" sub="Counting commits by day, hour and file." />
{:else if !d.total || !tale}
  <div class="card empty">
    <img class="float" src={face("sleepy")} alt="" />
    <h2>{mine ? "No commits from you this year." : "No commits in the last year."}</h2>
    <p>
      {mine
        ? `I looked for commits by ${d.me || "your git email"} on ${st.branch || "this branch"}.`
        : "Once there are commits on this branch, I'll show when and where the work happens."}
    </p>
    {#if showWho}{@render whoSeg()}{/if}
  </div>
{:else}
  <div class="insights" class:stale={loading}>
    <div class="card story">
      <img class="float" src={face(d.streak >= 3 ? "party" : "thinking")} alt="" />
      <div class="bubble" role="status">
        <div class="say">{tale.say}</div>
        <div class="hint">{tale.hint}</div>
      </div>
    </div>
    {#if showWho}<div class="who"><span class="muted">Showing commits from</span>{@render whoSeg()}</div>{/if}
    <div class="tiles five">
      <div class="tile">
        <div class="v">{k(d.total)}</div>
        <div class="l">commits this year</div>
      </div>
      <div class="tile">
        <div class="v">{d.activeDays}</div>
        <div class="l">days with commits</div>
      </div>
      <div class="tile">
        <div class="v">{plural(d.streak, "day")}</div>
        <div class="l">{d.streak ? "current streak" : "no streak right now"}</div>
      </div>
      <div class="tile">
        <div class="v">{plural(d.longestStreak, "day")}</div>
        <div class="l">longest streak</div>
      </div>
      <div class="tile">
        <div class="v">+{k(d.added)} −{k(d.removed)}</div>
        <div class="l">lines added, removed</div>
      </div>
    </div>
    {#if d.partial}<div class="callout amber">
        This branch has a lot of history, so I read the newest {(20000).toLocaleString()} commits of the year.
      </div>{/if}
    <div class="card">
      <Section id="i-cal" title="Commits in the last year" count={d.total} tone="blue">
        {#key d.today + who}<YearCalendar {d} branch={st.branch} {mine} start={tale.busiest} />{/key}
      </Section>
    </div>
    <div class="card"><Section id="i-weeks" title="Commits per week"><WeeklyChart {d} /></Section></div>
    <div class="card">
      <Section id="i-hours" title="When the work happens"
        ><HourGrid hours={d.hours} favDay={tale.favDay} favHour={tale.favHour} /></Section
      >
    </div>
    {#if d.sync}<div class="card">
        <Section id="i-sync" title="Work between commits"><SyncChart {d} open={st.files.length} /></Section>
      </div>{/if}
    <div class="card">
      <Section id="i-files" title="Busiest files" count={d.files.length}><FileHeat {d} /></Section>
    </div>
    <div class="card">
      <Section id="i-hot" title="Hotspots" count={d.hotspots.length ? null : 0}><HotspotChart {d} /></Section>
    </div>
    <div class="card">
      <Section id="i-together" title="Files that change together" count={d.together.length || null}
        ><Together together={d.together} /></Section
      >
    </div>
  </div>
{/if}

<style lang="scss">
  @use "tokens" as *;
  @use "mixins" as *;
  .insights {
    display: flex;
    flex-direction: column;
    gap: space(3) + 2;
    @include motion {
      transition: opacity $duration-base;
    }
    &.stale {
      opacity: 0.6;
    }
  }
  .story {
    display: flex;
    align-items: center;
    gap: space(4) + 2;
    padding: space(3) + 2 space(5) + 2;
    > img {
      width: 96px;
      height: 70px;
      flex: none;
    }
  }
  .who {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: space(2) + 2;
    font-size: 13px;
  }
  .tiles.five {
    grid-template-columns: repeat(5, minmax(0, 1fr));
    padding: 0;
    .v {
      font-size: 22px;
      overflow-wrap: anywhere;
    }
  }
  .callout {
    margin: 0;
  }
  @include below(laptop) {
    .tiles.five {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
</style>
