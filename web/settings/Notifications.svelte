<script lang="ts">
  import Switch from "../components/Switch.svelte";
  import { toast } from "../lib/app.svelte.ts";
  import { notes } from "../lib/notes.svelte.ts";
  import Row from "./Row.svelte";

  let start = $state(localStorage.getItem("ferry-start") || "");
</script>

<Row label="Desktop pop-ups" hint="Conflicts and errors, while this tab is in the background">
  <Switch label="Desktop pop-ups" checked={notes.prefs.desktop} onchange={(on) => notes.setDesktop(on)} />
</Row>
<Row label="Routine activity" hint="Show every sync in the notifications list, not just what needs you">
  <Switch label="Routine activity" checked={notes.prefs.routine} onchange={(on) => notes.setPrefs({ routine: on })} />
</Row>
<Row label="Open Ferry on" hint="What you see first when the page opens">
  <select
    aria-label="Open Ferry on"
    bind:value={start}
    onchange={() => (start ? localStorage.setItem("ferry-start", start) : localStorage.removeItem("ferry-start"))}
  >
    <option value="">Where I left off</option><option value="sync">Folder pairs</option><option value="git">Git</option>
  </select>
</Row>
<Row label="Unread notifications" hint={notes.unread ? `${notes.unread} new` : "Nothing new"}>
  <button
    class="btn small"
    disabled={!notes.unread}
    onclick={() => {
      notes.markAllRead();
      toast("All caught up", { mood: "happy" });
    }}>Mark all as read</button
  >
</Row>
