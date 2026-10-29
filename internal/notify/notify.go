// Package notify sends desktop notifications using whatever the OS ships with:
// osascript on macOS, notify-send on Linux, a PowerShell toast on Windows.
package notify

import (
	"os/exec"
	"runtime"
	"strings"
	"sync"
	"time"
)

var (
	mu      sync.Mutex
	last    = map[string]time.Time{}
	Enabled = true
	MinGap  = 5 * time.Second // per-key rate limit so a burst doesn't spam
)

// Send shows a notification asynchronously. key groups notifications for rate limiting.
func Send(key, title, msg string) {
	if !Enabled {
		return
	}
	mu.Lock()
	if t, ok := last[key]; ok && time.Since(t) < MinGap {
		mu.Unlock()
		return
	}
	last[key] = time.Now()
	mu.Unlock()
	go func() { _ = send(title, msg) }()
}

func send(title, msg string) error {
	switch runtime.GOOS {
	case "darwin":
		script := `display notification "` + esc(msg, `"`) + `" with title "` + esc(title, `"`) + `"`
		return exec.Command("osascript", "-e", script).Run()
	case "windows":
		ps := `[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null;` +
			`$t = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02);` +
			`$x = $t.GetElementsByTagName('text');` +
			`$x.Item(0).AppendChild($t.CreateTextNode('` + esc(title, "'") + `')) > $null;` +
			`$x.Item(1).AppendChild($t.CreateTextNode('` + esc(msg, "'") + `')) > $null;` +
			`$id = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe';` +
			`[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($id).Show([Windows.UI.Notifications.ToastNotification]::new($t))`
		cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", ps)
		hideWindow(cmd)
		return cmd.Run()
	default:
		if _, err := exec.LookPath("notify-send"); err != nil {
			return err
		}
		return exec.Command("notify-send", "-a", "ferry", title, msg).Run()
	}
}

func esc(s, quote string) string {
	s = strings.ReplaceAll(s, "\n", " ")
	if quote == `"` {
		s = strings.ReplaceAll(s, `\`, `\\`)
		return strings.ReplaceAll(s, `"`, `\"`)
	}
	return strings.ReplaceAll(s, `'`, `''`)
}
