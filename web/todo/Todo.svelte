<script lang="ts">
  import Icon from "../components/Icon.svelte";
  import InlineMd from "../components/InlineMd.svelte";
  import RelayLoading from "../components/RelayLoading.svelte";
  import Section from "../components/Section.svelte";
  import Seg from "../components/Seg.svelte";
  import { face } from "../lib/api.ts";
  import { app } from "../lib/app.svelte.ts";
  import { git } from "../lib/git.svelte.ts";
  import { ms } from "../lib/look.svelte.ts";
  import { relay } from "../lib/relay.svelte.ts";
  import { dueLabel, isNew, isOverdue, isSoon, isStale, reminder, today, waited } from "../lib/todo.ts";
  import { todos } from "../lib/todo.svelte.ts";
  import type { TodoItem } from "../lib/types.ts";
  import { splitTodo } from "../../src/shared/todo.ts";
  import { fade, slide } from "svelte/transition";

  /**
   * Each project's todo list: the checklists in its README, by heading. Ticking an
   * item or giving it a date edits that line of the README, so the list stays in
   * the repository; Relay keeps an eye on the dates and on items left waiting.
   */
  let loading = $state(true);
  $effect(() => {
    void todos.loadAll().then(() => (loading = false));
  });
  // a README edited elsewhere shows up when you come back to the tab
  function refocus() {
    if (document.visibilityState === "visible" && todos.current) void todos.load(todos.current.id);
  }

  const repo = $derived(todos.current);
  const list = $derived(repo ? todos.lists[repo.id] : undefined);
  const items = $derived(list?.items ?? []);
  const now = $derived(today());
  const say = $derived(reminder(items, now));
  // "new" only stands out when most of the list isn't: a README rewritten this week marks nothing
  const markNew = $derived.by(() => {
    const open = items.filter((i) => !i.done);
    return open.filter((i) => isNew(i)).length <= open.length / 3;
  });

  type Show = "open" | "dated" | "done" | "all";
  let show = $state<Show>((localStorage.getItem("ferry-todo-show") as Show) || "open");
  const SHOW = [
    ["open", "Open"],
    ["dated", "With a date"],
    ["done", "Done"],
    ["all", "All"],
  ] as const;
  // an item just ticked stays a moment to celebrate before it leaves the Open list
  let cheering = $state<Record<number, boolean>>({});
  const shown = $derived(
    items.filter(
      (i) =>
        cheering[i.line] ||
        (show === "open" ? !i.done : show === "done" ? i.done : show === "dated" ? !i.done && !!i.due : true),
    ),
  );
  const groups = $derived.by(() => {
    const out: { name: string; items: TodoItem[] }[] = [];
    for (const it of shown) {
      const last = out[out.length - 1];
      if (last && last.name === it.group) last.items.push(it);
      else {
        const same = out.find((g) => g.name === it.group);
        if (same) same.items.push(it);
        else out.push({ name: it.group, items: [it] });
      }
    }
    return out;
  });
  // the timeline: open items with a date, soonest first
  const dated = $derived(
    items.filter((i) => !i.done && i.due).sort((a, b) => a.due!.localeCompare(b.due!) || a.line - b.line),
  );

  const stats = (id: string) => {
    const l = todos.lists[id]?.items ?? [];
    return {
      total: l.length,
      done: l.filter((i) => i.done).length,
      late: l.filter((i) => isOverdue(i, now)).length,
    };
  };

  // giving an item a date
  let dating = $state<number | null>(null);
  function setDue(it: TodoItem, due: string | null) {
    if (!repo) return;
    dating = null;
    void todos.edit(repo.id, it, { due });
  }
  async function tick(it: TodoItem) {
    if (!repo) return;
    const done = !it.done,
      line = it.line;
    if (done) cheering[line] = true;
    const ok = await todos.edit(repo.id, it, { done });
    if (ok && done) {
      // Relay on the rail joins in: a hop for one item, a party for the last one
      const left = (todos.lists[repo.id]?.items ?? []).filter((i) => !i.done).length;
      relay.react(left ? "happy" : "party", left ? 900 : 1600, { jump: true, burst: !left });
    }
    setTimeout(() => delete cheering[line], ok && done ? ms(900) : 0);
  }
  const isBusy = (it: TodoItem) => !!repo && !!todos.busy[`${repo.id}:${it.line}`];

  let opened = $state<Record<number, boolean>>({});
  const lede = (it: TodoItem) => splitTodo(it.text);
  const when = (it: TodoItem) =>
    it.uncommitted
      ? "not committed yet"
      : it.since === null
        ? ""
        : it.done
          ? `done ${ago(it.since)}`
          : `added ${ago(it.since)}${it.by ? ` by ${it.by}` : ""}`;
  const ago = (ms: number) => {
    const w = waited(ms);
    return w === "today" ? "today" : `${w} ago`;
  };
  const groupId = (name: string) => `todo-${repo?.id}-${name || "main"}`;
</script>

<svelte:document onvisibilitychange={refocus} />

{#snippet row(it: TodoItem)}
  {@const l = lede(it)}
  {@const due = it.due && !it.done ? dueLabel(it.due, now) : null}
  <li
    class="item"
    class:done={it.done}
    class:cheer={cheering[it.line] && it.done}
    class:busy={isBusy(it)}
    style:--depth={it.depth}
    transition:slide={{ duration: ms(260) }}
  >
    <button
      type="button"
      class="box"
      role="checkbox"
      aria-checked={it.done}
      aria-label={(it.done ? "Not done: " : "Done: ") + l.title.replace(/[*`_]/g, "")}
      disabled={isBusy(it)}
      onclick={() => tick(it)}
      ><Icon name="check" size={15} />{#if cheering[it.line] && it.done}<span class="burst" aria-hidden="true"
          >{#each [0, 1, 2, 3, 4, 5, 6, 7] as n (n)}<i style:--a="{n * 45}deg"></i>{/each}</span
        >{/if}</button
    >
    <div class="body">
      <div class="title">
        <span class="t"><InlineMd text={l.title} /></span>
        {#if due}<span class="pill due {due.tone}"><Icon name="calendar" size={12} />{due.text}</span>{/if}
        {#if markNew && isNew(it)}<span class="pill blue">new</span>{/if}
        {#if isStale(it)}<span class="pill muted" title="Open for over a month">waiting {waited(it.since!)}</span>{/if}
      </div>
      {#if l.rest}
        <button
          type="button"
          class="rest"
          class:open={opened[it.line]}
          aria-expanded={!!opened[it.line]}
          onclick={() => (opened[it.line] = !opened[it.line])}><InlineMd text={l.rest} /></button
        >
      {/if}
      <div class="meta">
        {when(it)}{#if it.done && it.due}{when(it) ? " · " : ""}was due {it.due}{/if}
        <span class="line">{list?.file}:{it.line}</span>
      </div>
      {#if dating === it.line}
        <div class="dating" transition:slide={{ duration: ms(180) }}>
          <input
            type="date"
            value={it.due ?? ""}
            min={it.due && it.due < now ? it.due : now}
            aria-label="Due date"
            onchange={(e) =>
              (e.currentTarget as HTMLInputElement).value && setDue(it, (e.currentTarget as HTMLInputElement).value)}
            onkeydown={(e) => e.key === "Escape" && (dating = null)}
          />
          {#if it.due}<button type="button" class="btn small ghost" onclick={() => setDue(it, null)}>No date</button
            >{/if}
          <button type="button" class="btn small ghost" onclick={() => (dating = null)}>Cancel</button>
        </div>
      {/if}
    </div>
    {#if !it.done}
      <button
        type="button"
        class="date-btn"
        class:set={!!it.due}
        aria-label={it.due ? `Change the date (${it.due})` : "Give it a date"}
        title={it.due ? "Change the date" : "Give it a date"}
        onclick={() => (dating = dating === it.line ? null : it.line)}><Icon name="calendar" size={17} /></button
      >
    {/if}
  </li>
{/snippet}

<div class="todo">
  <aside class="col">
    <div class="card">
      <div class="head">
        <h2>Projects</h2>
        <span class="count blue">{git.repos.length}</span>
      </div>
      <div class="list">
        {#each git.repos as r (r.id)}
          {@const s = stats(r.id)}
          {@const sel = r.id === repo?.id}
          <button class="proj" class:sel aria-current={sel ? "true" : undefined} onclick={() => todos.select(r.id)}>
            <img src={face(todos.lists[r.id] ? reminder(todos.lists[r.id]!.items, now).face : "thinking")} alt="" />
            <div>
              <div class="name">
                {r.name}{#if s.late}<span class="pill red">{s.late} late</span>{/if}
              </div>
              {#if !todos.lists[r.id]}<div class="sub">{todos.errors[r.id] ? "can't read it" : "reading…"}</div>
              {:else if !s.total}<div class="sub">no todo list</div>
              {:else}
                <div class="sub">{s.done} of {s.total} done</div>
                <div class="bar" aria-hidden="true"><span style:width="{(s.done / s.total) * 100}%"></span></div>
              {/if}
            </div>
          </button>
        {:else}
          <div class="none">
            No projects yet. Open a repository in the Git tab and its README's todo list shows up here.
          </div>
        {/each}
      </div>
    </div>
  </aside>

  <div class="main">
    {#if loading && !list}
      <RelayLoading say="Reading your READMEs" />
    {:else if !repo}
      <div class="card empty">
        <img src={face("excited")} alt="Relay" class="float" />
        <h2>Let's find your todo lists.</h2>
        <p>
          I read the checklists in each project's README. Open a repository in the Git tab first, or let a folder pair
          sync into one.
        </p>
        <button class="btn brand" onclick={() => app.go("git")}>Go to Git</button>
      </div>
    {:else}
      <div class="card top">
        <div class="narrator">
          {#key say.face}<img src={face(say.face)} alt="" class="face" />{/key}
          <div class="bubble" role="status">
            {#key say.say}<div class="said" in:fade={{ duration: ms(220) }}>
                <div class="say">{say.say}</div>
                <div class="hint">{say.hint}</div>
              </div>{/key}
          </div>
        </div>
        {#if list?.file && items.length}
          <div class="bar-row">
            <Seg
              options={SHOW}
              value={show}
              label="Show"
              onchange={(v) => {
                show = v;
                localStorage.setItem("ferry-todo-show", v);
              }}
            />
            <span class="where muted">
              <Icon name="files" size={14} />{list.file}{#if list.via}
                · edits go through {list.via}{/if}
            </span>
          </div>
        {/if}
      </div>

      {#if todos.errors[repo.id]}
        <div class="card pad muted">{todos.errors[repo.id]}</div>
      {:else if list && !list.file}
        <div class="card pad muted">{repo.name} has no README yet.</div>
      {:else if list && items.length}
        {#if dated.length && show !== "done"}
          <Section id="todo-timeline-{repo.id}" title="Coming up" count={dated.length}>
            <ol class="timeline">
              {#each dated as it (it.line)}
                {@const d = dueLabel(it.due!, now)}
                <li
                  class:late={isOverdue(it, now)}
                  class:soon={isSoon(it, now)}
                  transition:slide={{ duration: ms(240) }}
                >
                  <span class="dot" aria-hidden="true"></span>
                  <span class="date mono">{it.due}</span>
                  <span class="tt"><InlineMd text={lede(it).title} /></span>
                  <span class="pill {d.tone}">{d.text}</span>
                </li>
              {/each}
            </ol>
          </Section>
        {/if}
        {#key repo.id + show}
          {#each groups as g, gi (g.name)}
            <div class="enter" style:--i={Math.min(gi, 6)}>
              <Section id={groupId(g.name)} title={g.name || list.heading || "Todo"} count={g.items.length}>
                <ul class="items">
                  {#each g.items as it (it.line)}{@render row(it)}{/each}
                </ul>
              </Section>
            </div>
          {:else}
            <div class="card pad muted">
              {show === "done"
                ? "Nothing ticked off yet."
                : show === "dated"
                  ? "No open item has a date yet: use the calendar button on one."
                  : "Nothing open. Nice."}
            </div>
          {/each}
        {/key}
      {/if}
    {/if}
  </div>
</div>

<style lang="scss">
  @use "tokens" as *;
  @use "mixins" as *;

  .todo {
    display: grid;
    grid-template-columns: 320px minmax(0, 1fr);
    gap: space(4) + 2;
    align-items: start;
  }
  .main {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: space(3) + 2;
  }
  .col {
    position: sticky;
    top: space(4) + 2;
  }
  .head {
    padding: space(4) + 2 space(4) + 2 space(3);
    display: flex;
    align-items: center;
    gap: space(2) + 2;
    h2 {
      font-size: fs(lg);
      flex: 1;
    }
  }
  .list {
    padding: 0 space(2) + 2 space(3);
    display: flex;
    flex-direction: column;
    gap: space(1);
  }
  .proj {
    display: grid;
    grid-template-columns: 44px 1fr;
    gap: space(2) + 2;
    align-items: center;
    padding: space(2);
    width: 100%;
    border-radius: $radius-lg;
    border: 2px solid transparent;
    background: none;
    text-align: left;
    cursor: pointer;
    &:hover {
      background: var(--accent-soft);
    }
    &.sel {
      @include gradient-border;
      box-shadow: 0 6px 18px color-mix(in srgb, var(--accent) 18%, transparent);
    }
    img {
      width: 44px;
      height: 32px;
    }
    > div {
      min-width: 0;
    }
  }
  .name {
    font-weight: 650;
    display: flex;
    align-items: center;
    gap: space(2);
    min-width: 0;
    .pill {
      font-size: 11px;
    }
  }
  .sub {
    font-size: 12px;
    color: var(--muted);
    @include ellipsis;
  }
  .bar {
    height: 5px;
    margin-top: 4px;
    border-radius: $radius-pill;
    background: var(--card2);
    overflow: hidden;
    span {
      display: block;
      height: 100%;
      border-radius: inherit;
      background: var(--green);
      @include motion {
        transition: width $duration-slow $ease-out;
      }
    }
  }
  .none {
    padding: space(1) space(4) + 2 space(4) + 2;
    color: var(--muted);
    font-size: 13px;
  }
  .top {
    padding: space(4) space(4) + 2;
    .narrator {
      margin-bottom: 0;
    }
    .bubble {
      background: var(--card2);
      box-shadow: none;
      &::before {
        border-right-color: var(--card2);
      }
    }
  }
  .bar-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: space(2) space(4);
    margin-top: space(3) + 2;
  }
  .where {
    display: inline-flex;
    align-items: center;
    gap: space(1) + 2;
    font-size: 12.5px;
    margin-left: auto;
  }
  .pad {
    padding: space(4) space(5);
  }

  // the timeline of dated items
  .timeline {
    list-style: none;
    margin: 0;
    padding: 0 space(3) 0 space(4);
    li {
      position: relative;
      display: grid;
      grid-template-columns: 14px 96px minmax(0, 1fr) auto;
      gap: space(2) + 2;
      align-items: center;
      padding: space(2) 0;
      font-size: 13.5px;
      // the line joining the dots
      &::before {
        content: "";
        position: absolute;
        left: 6px;
        top: 0;
        bottom: 0;
        width: 2px;
        background: var(--line);
      }
      &:first-child::before {
        top: 50%;
      }
      &:last-child::before {
        bottom: 50%;
      }
      &:only-child::before {
        display: none;
      }
    }
    .dot {
      position: relative;
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: var(--card-solid);
      border: 3px solid var(--line);
    }
    .soon .dot {
      border-color: var(--amber);
    }
    .late .dot {
      border-color: var(--red);
      background: var(--red-soft);
    }
    .date {
      font-size: 12.5px;
      color: var(--muted);
    }
    .tt {
      font-weight: $weight-semibold;
      @include ellipsis;
    }
  }

  // an item
  .items {
    list-style: none;
    margin: 0;
    padding: 0 space(2);
  }
  .item {
    display: grid;
    grid-template-columns: 26px minmax(0, 1fr) auto;
    gap: space(3);
    align-items: start;
    padding: space(3) space(2) space(3) calc(space(2) + var(--depth, 0) * 26px);
    border-top: 1px solid var(--line);
    &:first-child {
      border-top: 0;
    }
    &.busy {
      opacity: 0.6;
    }
  }
  .box {
    width: 24px;
    height: 24px;
    margin-top: 1px;
    padding: 0;
    border-radius: 8px;
    border: 2px solid var(--faint);
    background: var(--card-solid);
    color: transparent;
    display: grid;
    place-items: center;
    cursor: pointer;
    @include motion {
      transition:
        background 0.15s,
        border-color 0.15s,
        color 0.15s,
        transform 0.12s;
    }
    &:hover {
      border-color: var(--green);
      color: color-mix(in srgb, var(--green) 45%, transparent);
    }
    &:active {
      transform: scale(0.88);
    }
    &:focus-visible {
      outline: none;
      box-shadow: 0 0 0 2.5px var(--accent);
    }
    .done & {
      background: var(--green);
      border-color: var(--green);
      color: #fff;
      @include motion {
        animation: pop 0.28s $ease-out;
      }
    }
  }
  @keyframes pop {
    40% {
      transform: scale(1.18);
    }
  }

  // ---------- motion (none of it plays when motion is reduced) ----------
  .box {
    position: relative;
    :global(svg) {
      clip-path: inset(0 0 0 0);
    }
  }
  // a burst of dots around the box when an item is ticked
  .burst {
    position: absolute;
    inset: 50% auto auto 50%;
    pointer-events: none;
    i {
      position: absolute;
      left: -3px;
      top: -3px;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--green);
      opacity: 0;
      transform: rotate(var(--a)) translateY(0);
      &:nth-child(3n + 2) {
        background: var(--accent);
      }
      &:nth-child(3n) {
        background: var(--amber);
      }
    }
  }
  @include motion {
    // ticked just now: the tick draws itself, the title is struck through, the row glows green, dots fly out
    .cheer .box :global(svg) {
      animation: draw-tick 0.35s ease-out 0.08s backwards;
    }
    .cheer .title .t {
      animation: strike 0.4s ease-out 0.15s backwards;
    }
    .cheer {
      animation: glow 0.9s ease-out;
    }
    .burst i {
      animation: fly 0.6s cubic-bezier(0.2, 0.7, 0.3, 1);
    }
    // a date appears with a little pop
    .pill.due {
      animation: pop-in 0.3s cubic-bezier(0.3, 1.6, 0.5, 1);
    }
    // Relay's face bounces in when it has something new to say
    .narrator .face {
      animation: face-in 0.5s cubic-bezier(0.3, 1.5, 0.5, 1);
    }
    // groups rise in one after another when you change project or filter
    .enter {
      animation: rise 0.35s $ease-out calc(var(--i, 0) * 45ms) backwards;
    }
    // late dates keep a soft pulse on the timeline
    .timeline .late .dot::after {
      content: "";
      position: absolute;
      inset: -3px;
      border-radius: 50%;
      border: 2px solid var(--red);
      animation: pulse 2s ease-out infinite;
    }
    .date-btn :global(svg) {
      transition: transform 0.2s cubic-bezier(0.3, 1.6, 0.5, 1);
    }
    .date-btn:hover :global(svg) {
      transform: rotate(-10deg) scale(1.12);
    }
  }
  @keyframes draw-tick {
    from {
      clip-path: inset(0 100% 0 0);
    }
  }
  @keyframes strike {
    from {
      background-size: 0 1.5px;
    }
  }
  @keyframes glow {
    0% {
      background: color-mix(in srgb, var(--green) 16%, transparent);
    }
    100% {
      background: transparent;
    }
  }
  @keyframes fly {
    0% {
      opacity: 1;
      transform: rotate(var(--a)) translateY(-8px) scale(1);
    }
    100% {
      opacity: 0;
      transform: rotate(var(--a)) translateY(-22px) scale(0.4);
    }
  }
  @keyframes pop-in {
    from {
      transform: scale(0.6);
      opacity: 0;
    }
  }
  @keyframes face-in {
    0% {
      transform: scale(0.8) rotate(-6deg);
    }
    60% {
      transform: scale(1.06) rotate(2deg);
    }
    100% {
      transform: none;
    }
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(10px);
    }
  }
  @keyframes pulse {
    0% {
      transform: scale(1);
      opacity: 0.7;
    }
    100% {
      transform: scale(2.2);
      opacity: 0;
    }
  }
  .body {
    min-width: 0;
  }
  .title {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: space(1) + 2 space(2);
    font-size: 14.5px;
    .t {
      font-weight: $weight-semibold;
      min-width: 0;
      overflow-wrap: anywhere;
      :global(strong) {
        font-weight: inherit;
      }
    }
    .pill {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 11.5px;
    }
    .done & .t {
      color: var(--muted);
      background: linear-gradient(currentColor, currentColor) no-repeat 0 55% / 100% 1.5px;
    }
  }
  .rest {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
    margin-top: 3px;
    padding: 0;
    border: 0;
    background: none;
    text-align: left;
    color: var(--muted);
    font: inherit;
    font-size: 13px;
    line-height: 1.5;
    cursor: pointer;
    &.open {
      -webkit-line-clamp: unset;
      line-clamp: unset;
      display: block;
    }
    &:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
      border-radius: 4px;
    }
  }
  .meta {
    margin-top: 4px;
    font-size: 12px;
    color: var(--faint);
    display: flex;
    gap: space(2);
    .line {
      margin-left: auto;
      font-family: $font-mono;
      opacity: 0;
      @include motion {
        transition: opacity 0.15s;
      }
    }
  }
  .item:hover .meta .line {
    opacity: 1;
  }
  .dating {
    display: flex;
    align-items: center;
    gap: space(2);
    margin-top: space(2);
    input {
      border: 1px solid var(--line);
      border-radius: $radius-md + 2;
      background: var(--card-solid);
      color: var(--text);
      padding: space(1) + 2 space(3);
      font: inherit;
      font-size: 13px;
    }
  }
  .date-btn {
    width: 34px;
    height: 34px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: none;
    color: var(--faint);
    display: grid;
    place-items: center;
    cursor: pointer;
    opacity: 0;
    @include motion {
      transition:
        opacity 0.15s,
        background 0.15s;
    }
    &.set {
      color: var(--accent);
    }
    &:hover {
      background: var(--accent-soft);
      color: var(--text);
    }
    &:focus-visible {
      opacity: 1;
      outline: none;
      box-shadow: 0 0 0 2.5px var(--accent);
    }
  }
  .item:hover .date-btn,
  .item:focus-within .date-btn {
    opacity: 1;
  }
  @media (hover: none) {
    .date-btn,
    .meta .line {
      opacity: 1;
    }
  }
  @include below(laptop) {
    .todo {
      grid-template-columns: minmax(0, 1fr);
    }
    .col {
      position: static;
    }
  }
</style>
