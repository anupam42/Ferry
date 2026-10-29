package engine

import (
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// moveToTrash sends a file to the OS trash / recycle bin. Callers fall back
// to a plain delete when it fails (ferry's own backup exists either way).
func moveToTrash(p string) error {
	abs, err := filepath.Abs(p)
	if err != nil {
		return err
	}
	switch runtime.GOOS {
	case "darwin":
		esc := strings.ReplaceAll(strings.ReplaceAll(abs, `\`, `\\`), `"`, `\"`)
		return exec.Command("osascript", "-e", `tell application "Finder" to delete POSIX file "`+esc+`"`).Run()
	case "windows":
		ps := `Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile('` +
			strings.ReplaceAll(abs, "'", "''") + `', 'OnlyErrorDialogs', 'SendToRecycleBin')`
		cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-Command", ps)
		hideWindow(cmd)
		return cmd.Run()
	default:
		if _, err := exec.LookPath("gio"); err == nil {
			if exec.Command("gio", "trash", abs).Run() == nil {
				return nil
			}
		}
		return freedesktopTrash(abs)
	}
}

// freedesktopTrash implements the XDG trash spec for the home trash.
func freedesktopTrash(abs string) error {
	dir := os.Getenv("XDG_DATA_HOME")
	if dir == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return err
		}
		dir = filepath.Join(home, ".local", "share")
	}
	trash := filepath.Join(dir, "Trash")
	files, info := filepath.Join(trash, "files"), filepath.Join(trash, "info")
	if err := os.MkdirAll(files, 0o700); err != nil {
		return err
	}
	if err := os.MkdirAll(info, 0o700); err != nil {
		return err
	}
	base := filepath.Base(abs)
	name := base
	for i := 1; ; i++ {
		if _, err := os.Lstat(filepath.Join(files, name)); os.IsNotExist(err) {
			if _, err := os.Lstat(filepath.Join(info, name+".trashinfo")); os.IsNotExist(err) {
				break
			}
		}
		name = fmt.Sprintf("%s.%d", base, i)
	}
	meta := "[Trash Info]\nPath=" + (&url.URL{Path: abs}).EscapedPath() + "\nDeletionDate=" + time.Now().Format("2006-01-02T15:04:05") + "\n"
	infoPath := filepath.Join(info, name+".trashinfo")
	if err := os.WriteFile(infoPath, []byte(meta), 0o600); err != nil {
		return err
	}
	if err := os.Rename(abs, filepath.Join(files, name)); err != nil {
		os.Remove(infoPath)
		return err // e.g. on another filesystem; the caller deletes instead
	}
	return nil
}
