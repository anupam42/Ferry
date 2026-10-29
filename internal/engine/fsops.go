package engine

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"

	"github.com/anupam42/Ferry/internal/ignore"
)

// FileStat is the cheap identity of a file used for change detection.
type FileStat struct {
	Size int64
	Mod  int64 // unix nanos
	Mode fs.FileMode
}

// Snapshot maps slash-separated relative paths to stats.
type Snapshot map[string]FileStat

func (a Snapshot) Equal(b Snapshot) bool {
	if len(a) != len(b) {
		return false
	}
	for k, v := range a {
		w, ok := b[k]
		if !ok || w.Size != v.Size || w.Mod != v.Mod || w.Mode != v.Mode {
			return false
		}
	}
	return true
}

// hardIgnores can never be turned off: syncing these would corrupt a repo or loop.
var hardIgnores = []string{".git", ".ferry-*", ".ferry"}

// DefaultIgnores is the built-in list (turn off with default_ignores: false).
var DefaultIgnores = []string{
	"node_modules", ".DS_Store", "Thumbs.db", "desktop.ini", ".syncignore",
	"*.swp", "*.swo", "*~", ".#*", "*.tmp", "~$*",
}

// scanDir walks root, applying m plus any nested .gitignore files. When only
// is set, files must also match it. symlinks is skip | follow | link.
func scanDir(root string, base *ignore.Matcher, nestedGitignore bool, only *ignore.Matcher, symlinks string) (Snapshot, error) {
	m := base.Clone()
	snap := Snapshot{}
	err := filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			if p == root {
				return err
			}
			return nil // vanished or unreadable: skip
		}
		rel, _ := filepath.Rel(root, p)
		if rel == "." {
			return nil
		}
		rel = filepath.ToSlash(rel)
		if m.MatchDirect(rel, d.IsDir()) {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if d.IsDir() {
			if nestedGitignore {
				m.AddFile(filepath.Join(p, ".gitignore"), rel)
			}
			return nil
		}
		if only != nil && only.Len() > 0 && !only.Match(rel, false) {
			return nil
		}
		var info fs.FileInfo
		switch {
		case d.Type().IsRegular():
			info, err = d.Info()
		case d.Type()&fs.ModeSymlink != 0 && symlinks == "follow":
			info, err = os.Stat(p) // what the link points to
			if err == nil && !info.Mode().IsRegular() {
				return nil // links to folders are not followed (they could loop)
			}
		case d.Type()&fs.ModeSymlink != 0 && symlinks == "link":
			if info, err = d.Info(); err == nil {
				snap[rel] = FileStat{info.Size(), info.ModTime().UnixNano(), fs.ModeSymlink | info.Mode().Perm()}
			}
			return nil
		default:
			return nil // sockets, devices, and symlinks unless enabled
		}
		if err != nil {
			return nil
		}
		snap[rel] = FileStat{info.Size(), info.ModTime().UnixNano(), info.Mode().Perm()}
		return nil
	})
	return snap, err
}

func hashFile(p string) (string, error) {
	f, err := os.Open(p)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// isBinaryFile checks for a NUL byte in the first 8KB.
func isBinaryFile(p string) bool {
	f, err := os.Open(p)
	if err != nil {
		return false
	}
	defer f.Close()
	buf := make([]byte, 8000)
	n, _ := io.ReadFull(f, buf)
	for _, c := range buf[:n] {
		if c == 0 {
			return true
		}
	}
	return false
}

func isSymlink(p string) bool {
	fi, err := os.Lstat(p)
	return err == nil && fi.Mode()&fs.ModeSymlink != 0
}

// copyLink recreates the symlink src at dst (pointing at the same target).
func copyLink(src, dst string) error {
	target, err := os.Readlink(src)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	if err := removeWithRetry(dst); err != nil {
		return err
	}
	return os.Symlink(target, dst)
}

// copyFile copies atomically (temp + rename), keeps mode and mtime, and
// returns the content hash.
func copyFile(src, dst string) (string, error) {
	info, err := os.Stat(src)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return "", err
	}
	in, err := os.Open(src)
	if err != nil {
		return "", err
	}
	defer in.Close()
	tmp, err := os.CreateTemp(filepath.Dir(dst), ".ferry-*")
	if err != nil {
		return "", err
	}
	tmpName := tmp.Name()
	h := sha256.New()
	if _, err := io.Copy(io.MultiWriter(tmp, h), in); err != nil {
		tmp.Close()
		os.Remove(tmpName)
		return "", err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmpName)
		return "", err
	}
	_ = os.Chmod(tmpName, info.Mode().Perm())
	_ = os.Chtimes(tmpName, time.Now(), info.ModTime())
	if err := replaceFile(tmpName, dst); err != nil {
		os.Remove(tmpName)
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// writeFileAtomic writes data to dst through a temp file. A zero mod time
// leaves the mtime as "now".
func writeFileAtomic(dst string, data []byte, perm fs.FileMode, mod time.Time) error {
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(dst), ".ferry-*")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		os.Remove(tmpName)
		return err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmpName)
		return err
	}
	if perm != 0 {
		_ = os.Chmod(tmpName, perm)
	}
	if !mod.IsZero() {
		_ = os.Chtimes(tmpName, time.Now(), mod)
	}
	if err := replaceFile(tmpName, dst); err != nil {
		os.Remove(tmpName)
		return err
	}
	return nil
}

// replaceFile renames with retries; Windows briefly locks files that editors,
// antivirus or the indexer have open.
func replaceFile(from, to string) error {
	var err error
	for i := 0; i < 5; i++ {
		if err = os.Rename(from, to); err == nil {
			return nil
		}
		if runtime.GOOS == "windows" {
			_ = os.Remove(to)
		}
		time.Sleep(time.Duration(50*(i+1)) * time.Millisecond)
	}
	return err
}

func removeWithRetry(p string) error {
	var err error
	for i := 0; i < 5; i++ {
		if err = os.Remove(p); err == nil || errors.Is(err, fs.ErrNotExist) {
			return nil
		}
		time.Sleep(time.Duration(50*(i+1)) * time.Millisecond)
	}
	return err
}

// removeEmptyParents deletes now-empty directories up to (not including) root.
func removeEmptyParents(root, p string) {
	dir := filepath.Dir(p)
	for {
		rel, err := filepath.Rel(root, dir)
		if err != nil || rel == "." || strings.HasPrefix(rel, "..") {
			return
		}
		if os.Remove(dir) != nil {
			return
		}
		dir = filepath.Dir(dir)
	}
}

// ---------- backups ----------

const backupTimeFmt = "20060102-150405.000"

// BackupDir returns the backup root for a pair.
func BackupDir(dataDir, pairID string) string {
	return filepath.Join(dataDir, pairID, "backups")
}

// backupFile stores a copy of side/rel before it's overwritten or deleted,
// prunes old versions, and returns the path of the new copy ("" if none).
func backupFile(dir, side, rel, path string, keep int) (string, error) {
	if keep <= 0 {
		return "", nil
	}
	if _, err := os.Stat(path); err != nil {
		return "", nil
	}
	vdir := filepath.Join(dir, side, filepath.FromSlash(rel))
	if err := os.MkdirAll(vdir, 0o755); err != nil {
		return "", err
	}
	name := time.Now().Format(backupTimeFmt)
	dest := filepath.Join(vdir, name)
	if _, err := copyFile(path, dest); err != nil {
		return "", err
	}
	vs, _ := os.ReadDir(vdir)
	var names []string
	for _, v := range vs {
		if !v.IsDir() && !strings.HasPrefix(v.Name(), ".ferry-") {
			names = append(names, v.Name())
		}
	}
	sort.Strings(names)
	for len(names) > keep {
		os.Remove(filepath.Join(vdir, names[0]))
		names = names[1:]
	}
	return dest, nil
}

// Backup is one stored version.
type Backup struct {
	Side    string // "source" or "target"
	Rel     string
	Version string // timestamp name
	Path    string
	Time    time.Time
	Size    int64
}

// ListBackups returns versions (newest first), optionally filtered by rel.
func ListBackups(dataDir, pairID, filter string) ([]Backup, error) {
	root := BackupDir(dataDir, pairID)
	var out []Backup
	err := filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		rel, _ := filepath.Rel(root, p)
		parts := strings.Split(filepath.ToSlash(rel), "/")
		if len(parts) < 3 {
			return nil
		}
		b := Backup{Side: parts[0], Rel: strings.Join(parts[1:len(parts)-1], "/"), Version: parts[len(parts)-1], Path: p}
		if filter != "" && b.Rel != strings.Trim(filepath.ToSlash(filter), "/") {
			return nil
		}
		b.Time, _ = time.ParseInLocation(backupTimeFmt, b.Version, time.Local)
		if info, err := d.Info(); err == nil {
			b.Size = info.Size()
		}
		out = append(out, b)
		return nil
	})
	if errors.Is(err, fs.ErrNotExist) {
		err = nil
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Rel != out[j].Rel {
			return out[i].Rel < out[j].Rel
		}
		return out[i].Version > out[j].Version
	})
	return out, err
}

// RestoreBackup copies a stored version back over dest (backing up dest first).
func RestoreBackup(dataDir, pairID string, b Backup, dest string, keep int) error {
	_, _ = backupFile(BackupDir(dataDir, pairID), b.Side, b.Rel, dest, keep+1)
	_, err := copyFile(b.Path, dest)
	return err
}

// PruneBackups deletes versions older than maxAge, then the oldest versions
// until the pair's backups fit in maxSize. Zero disables either limit.
func PruneBackups(dataDir, pairID string, maxAge time.Duration, maxSize int64) (removed int, freed int64, err error) {
	if maxAge <= 0 && maxSize <= 0 {
		return 0, 0, nil
	}
	list, err := ListBackups(dataDir, pairID, "")
	if err != nil {
		return 0, 0, err
	}
	// oldest first
	sort.Slice(list, func(i, j int) bool { return list[i].Time.Before(list[j].Time) })
	var total int64
	for _, b := range list {
		total += b.Size
	}
	drop := func(b Backup) {
		if os.Remove(b.Path) == nil {
			removed++
			freed += b.Size
			total -= b.Size
			removeEmptyParents(BackupDir(dataDir, pairID), b.Path)
		}
	}
	var keep []Backup
	for _, b := range list {
		if maxAge > 0 && !b.Time.IsZero() && time.Since(b.Time) > maxAge {
			drop(b)
			continue
		}
		keep = append(keep, b)
	}
	for _, b := range keep {
		if maxSize <= 0 || total <= maxSize {
			break
		}
		drop(b)
	}
	return removed, freed, nil
}
