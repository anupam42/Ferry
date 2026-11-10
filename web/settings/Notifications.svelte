<script lang="ts">
  import Switch from "../components/Switch.svelte";
  import { toast } from "../lib/app.svelte.ts";
  import Row from "./Row.svelte";

  // shared with the current page's notification list
  type Prefs = { desktop: boolean; routine: boolean };
  const read = (): Prefs => { try { return { desktop: false, routine: false, ...JSON.parse(localStorage.getItem("ferry-note-prefs") || "{}") }; } catch { return { desktop: false, routine: false }; } };
  let prefs = $state(read());
  let start = $state(localStorage.getItem("ferry-start") || "");
  const save = () => localStorage.setItem("ferry-note-prefs", JSON.stringify(prefs));

  async function desktop(on: boolean): Promise<boolean> {
    if (on && "Notification" in window && Notification.permission !== "granted" && (await Notification.requestPermission()) !== "granted") {
      toast("Your browser didn't allow pop-ups. You can allow them in its site settings.", { error: true });
      return false;
    }
    prefs.desktop = on;
    save();
    return true;
  }
</script>

<Row label="Desktop pop-ups" hint="Conflicts and errors, while this tab is in the background">
  <Switch label="Desktop pop-ups" checked={prefs.desktop} onchange={desktop} />
</Row>
<Row label="Routine activity" hint="Show every sync in the notifications list, not just what needs you">
  <Switch label="Routine activity" checked={prefs.routine} onchange={(on) => { prefs.routine = on; save(); }} />
</Row>
<Row label="Open Ferry on" hint="What you see first when the page opens">
  <select aria-label="Open Ferry on" bind:value={start} onchange={() => (start ? localStorage.setItem("ferry-start", start) : localStorage.removeItem("ferry-start"))}>
    <option value="">Where I left off</option><option value="sync">Folder pairs</option><option value="git">Git</option>
  </select>
</Row>
<Row label="Unread notifications">
  <button class="btn small" onclick={() => { localStorage.setItem("ferry-read", String(Date.now())); toast("All caught up", { mood: "happy" }); }}>Mark all as read</button>
</Row>
