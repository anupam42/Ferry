// Package service installs ferry as a per-user background service:
// systemd --user on Linux, a LaunchAgent on macOS, and a Task Scheduler
// logon task on Windows. No admin rights needed on any platform.
package service

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"

	"github.com/anupam42/Ferry/internal/config"
)

const (
	unitName = "ferry"
	launchID = "com.anupam42.ferry"
	taskName = "ferry"
)

// LogPath is where the service writes its log on every platform.
func LogPath() string { return filepath.Join(config.DataDir(), "service.log") }

// PIDPath is used to stop the Windows background process.
func PIDPath() string { return filepath.Join(config.DataDir(), "service.pid") }

func runCmd(name string, args ...string) (string, error) {
	out, err := exec.Command(name, args...).CombinedOutput()
	if err != nil {
		return string(out), fmt.Errorf("%s %s: %v\n%s", name, strings.Join(args, " "), err, strings.TrimSpace(string(out)))
	}
	return string(out), nil
}

func runArgs(exe, cfg string) []string {
	return []string{exe, "run", "--config", cfg, "--ui", "plain", "--no-color", "--log", LogPath(), "--pidfile", PIDPath()}
}

// Install registers and starts the service for config file cfg.
func Install(cfg string) (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	if exe, err = filepath.EvalSymlinks(exe); err != nil {
		return "", err
	}
	if cfg, err = filepath.Abs(cfg); err != nil {
		return "", err
	}
	if _, _, err := config.Load(cfg); err != nil {
		return "", fmt.Errorf("config check failed: %w", err)
	}
	_ = os.MkdirAll(config.DataDir(), 0o755)
	args := runArgs(exe, cfg)

	switch runtime.GOOS {
	case "linux":
		dir := filepath.Join(userConfigDir(), "systemd", "user")
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return "", err
		}
		unit := fmt.Sprintf(`[Unit]
Description=ferry - mirror folders into git repos
After=default.target

[Service]
Type=simple
ExecStart=%s
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
`, systemdQuote(args))
		p := filepath.Join(dir, unitName+".service")
		if err := os.WriteFile(p, []byte(unit), 0o644); err != nil {
			return "", err
		}
		if _, err := runCmd("systemctl", "--user", "daemon-reload"); err != nil {
			return p, err
		}
		_, err := runCmd("systemctl", "--user", "enable", "--now", unitName)
		return p, err

	case "darwin":
		home, _ := os.UserHomeDir()
		dir := filepath.Join(home, "Library", "LaunchAgents")
		_ = os.MkdirAll(dir, 0o755)
		var argXML strings.Builder
		for _, a := range args {
			argXML.WriteString("    <string>" + xmlEscape(a) + "</string>\n")
		}
		plist := fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>%s</string>
  <key>ProgramArguments</key>
  <array>
%s  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>StandardOutPath</key><string>%s</string>
  <key>StandardErrorPath</key><string>%s</string>
</dict>
</plist>
`, launchID, argXML.String(), xmlEscape(LogPath()+".stdout"), xmlEscape(LogPath()+".stderr"))
		p := filepath.Join(dir, launchID+".plist")
		if err := os.WriteFile(p, []byte(plist), 0o644); err != nil {
			return "", err
		}
		_, _ = runCmd("launchctl", "unload", p)
		_, err := runCmd("launchctl", "load", "-w", p)
		return p, err

	case "windows":
		// A tiny VBScript launcher runs ferry without a console window.
		vbs := filepath.Join(config.DataDir(), "ferry-service.vbs")
		var q []string
		for _, a := range args {
			q = append(q, `""`+a+`""`)
		}
		script := fmt.Sprintf("CreateObject(\"WScript.Shell\").Run \"%s\", 0, False\r\n", strings.Join(q, " "))
		if err := os.WriteFile(vbs, []byte(script), 0o644); err != nil {
			return "", err
		}
		tr := fmt.Sprintf(`wscript.exe "%s"`, vbs)
		if _, err := runCmd("schtasks", "/Create", "/TN", taskName, "/TR", tr, "/SC", "ONLOGON", "/RL", "LIMITED", "/F"); err != nil {
			return vbs, err
		}
		_, err := runCmd("schtasks", "/Run", "/TN", taskName)
		return vbs, err
	}
	return "", errors.New("background service not supported on " + runtime.GOOS)
}

// Uninstall stops and removes the service.
func Uninstall() error {
	_ = Stop()
	switch runtime.GOOS {
	case "linux":
		_, _ = runCmd("systemctl", "--user", "disable", unitName)
		_ = os.Remove(filepath.Join(userConfigDir(), "systemd", "user", unitName+".service"))
		_, err := runCmd("systemctl", "--user", "daemon-reload")
		return err
	case "darwin":
		home, _ := os.UserHomeDir()
		p := filepath.Join(home, "Library", "LaunchAgents", launchID+".plist")
		_, _ = runCmd("launchctl", "unload", "-w", p)
		return os.Remove(p)
	case "windows":
		_, err := runCmd("schtasks", "/Delete", "/TN", taskName, "/F")
		_ = os.Remove(filepath.Join(config.DataDir(), "ferry-service.vbs"))
		return err
	}
	return errors.New("unsupported OS")
}

func Start() error {
	switch runtime.GOOS {
	case "linux":
		_, err := runCmd("systemctl", "--user", "start", unitName)
		return err
	case "darwin":
		_, err := runCmd("launchctl", "start", launchID)
		return err
	case "windows":
		_, err := runCmd("schtasks", "/Run", "/TN", taskName)
		return err
	}
	return errors.New("unsupported OS")
}

func Stop() error {
	switch runtime.GOOS {
	case "linux":
		_, err := runCmd("systemctl", "--user", "stop", unitName)
		return err
	case "darwin":
		_, err := runCmd("launchctl", "stop", launchID)
		return err
	case "windows":
		pid, err := readPID()
		if err != nil {
			return errors.New("service is not running")
		}
		_, err = runCmd("taskkill", "/PID", strconv.Itoa(pid), "/T", "/F")
		_ = os.Remove(PIDPath())
		return err
	}
	return errors.New("unsupported OS")
}

// Status returns a human-readable status.
func Status() string {
	switch runtime.GOOS {
	case "linux":
		out, _ := runCmd("systemctl", "--user", "status", "--no-pager", "--lines=0", unitName)
		return strings.TrimSpace(out)
	case "darwin":
		out, err := runCmd("launchctl", "list", launchID)
		if err != nil {
			return "not installed or not running"
		}
		return strings.TrimSpace(out)
	case "windows":
		out, _ := runCmd("schtasks", "/Query", "/TN", taskName, "/FO", "LIST")
		state := "process: not running"
		if pid, err := readPID(); err == nil && processAlive(pid) {
			state = fmt.Sprintf("process: running (pid %d)", pid)
		}
		return strings.TrimSpace(out) + "\n" + state
	}
	return "unsupported OS"
}

// Logs prints the last n lines of the service log.
func Logs(w io.Writer, n int) error {
	f, err := os.Open(LogPath())
	if err != nil {
		return fmt.Errorf("no log yet at %s", LogPath())
	}
	defer f.Close()
	var lines []string
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		lines = append(lines, sc.Text())
		if len(lines) > n {
			lines = lines[1:]
		}
	}
	for _, l := range lines {
		fmt.Fprintln(w, l)
	}
	return nil
}

func readPID() (int, error) {
	b, err := os.ReadFile(PIDPath())
	if err != nil {
		return 0, err
	}
	return strconv.Atoi(strings.TrimSpace(string(b)))
}

func processAlive(pid int) bool {
	out, err := exec.Command("tasklist", "/FI", "PID eq "+strconv.Itoa(pid), "/NH").Output()
	return err == nil && strings.Contains(string(out), strconv.Itoa(pid))
}

func userConfigDir() string {
	if d := os.Getenv("XDG_CONFIG_HOME"); d != "" {
		return d
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".config")
}

func systemdQuote(args []string) string {
	var out []string
	for _, a := range args {
		if strings.ContainsAny(a, " \t\"'\\") {
			a = `"` + strings.ReplaceAll(strings.ReplaceAll(a, `\`, `\\`), `"`, `\"`) + `"`
		}
		out = append(out, a)
	}
	return strings.Join(out, " ")
}

func xmlEscape(s string) string {
	r := strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;")
	return r.Replace(s)
}
