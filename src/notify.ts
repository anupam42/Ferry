// Desktop notifications with whatever the OS ships: osascript on macOS,
// notify-send on Linux, a PowerShell toast on Windows.
import { exec, which } from "./proc.ts";

export const notifySettings = {
  enabled: true,
  minGapMs: 5000, // per-key rate limit so a burst doesn't spam
};

const last = new Map<string, number>();

/** Shows a notification in the background. key groups notifications for rate limiting. */
export function send(key: string, title: string, msg: string): void {
  if (!notifySettings.enabled) return;
  const t = last.get(key);
  if (t !== undefined && Date.now() - t < notifySettings.minGapMs) return;
  last.set(key, Date.now());
  void show(title, msg).catch(() => {});
}

async function show(title: string, msg: string): Promise<void> {
  switch (process.platform) {
    case "darwin": {
      const script = `display notification "${esc(msg, '"')}" with title "${esc(title, '"')}"`;
      await exec(["osascript", "-e", script]);
      return;
    }
    case "win32": {
      const ps =
        "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null;" +
        "$t = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02);" +
        "$x = $t.GetElementsByTagName('text');" +
        `$x.Item(0).AppendChild($t.CreateTextNode('${esc(title, "'")}')) > $null;` +
        `$x.Item(1).AppendChild($t.CreateTextNode('${esc(msg, "'")}')) > $null;` +
        "$id = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe';" +
        "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($id).Show([Windows.UI.Notifications.ToastNotification]::new($t))";
      await exec(["powershell", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", ps]);
      return;
    }
    default:
      if (!which("notify-send")) return;
      await exec(["notify-send", "-a", "ferry", title, msg]);
  }
}

function esc(s: string, quote: string): string {
  s = s.replaceAll("\n", " ");
  if (quote === '"') return s.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  return s.replaceAll("'", "''");
}
