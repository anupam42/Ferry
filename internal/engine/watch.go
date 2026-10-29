package engine

import (
	"io/fs"
	"path/filepath"
	"strings"
	"time"

	"github.com/fsnotify/fsnotify"
)

// watcher wakes the engine when something may have changed.
type watcher struct {
	c      chan struct{}
	kind   string
	fsw    *fsnotify.Watcher
	stop   chan struct{}
	ticker *time.Ticker
}

func (w *watcher) poke() {
	select {
	case w.c <- struct{}{}:
	default:
	}
}

func (w *watcher) Close() {
	close(w.stop)
	if w.fsw != nil {
		w.fsw.Close()
	}
	if w.ticker != nil {
		w.ticker.Stop()
	}
}

// newWatcher starts native file events (with a slow safety poll) or pure
// polling. In "auto" mode it falls back to polling if native events fail,
// e.g. on network drives or when the OS watch limit is hit.
func newWatcher(mode string, roots []string, interval time.Duration,
	skip func(root, rel string, isDir bool) bool, warn func(string)) *watcher {

	w := &watcher{c: make(chan struct{}, 1), stop: make(chan struct{})}

	if mode != "poll" {
		fsw, err := fsnotify.NewWatcher()
		if err == nil {
			for _, r := range roots {
				if err = addTree(fsw, r, skip); err != nil {
					break
				}
			}
		}
		if err == nil {
			w.fsw, w.kind = fsw, "native"
			safety := 10 * time.Second
			if mode == "native" {
				safety = 60 * time.Second
			}
			w.ticker = time.NewTicker(safety)
			go w.loopNative(roots, skip, warn)
			return w
		}
		if fsw != nil {
			fsw.Close()
		}
		if mode == "native" {
			warn("native file events unavailable (" + err.Error() + "); falling back to polling")
		} else {
			warn("using polling: native file events unavailable (" + err.Error() + ")")
		}
	}
	w.kind = "poll"
	w.ticker = time.NewTicker(interval)
	go func() {
		for {
			select {
			case <-w.stop:
				return
			case <-w.ticker.C:
				w.poke()
			}
		}
	}()
	return w
}

func addTree(fsw *fsnotify.Watcher, root string, skip func(root, rel string, isDir bool) bool) error {
	return filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			if p == root {
				return err
			}
			return nil
		}
		if !d.IsDir() {
			return nil
		}
		rel, _ := filepath.Rel(root, p)
		rel = filepath.ToSlash(rel)
		if rel != "." && skip(root, rel, true) {
			return filepath.SkipDir
		}
		return fsw.Add(p)
	})
}

func (w *watcher) loopNative(roots []string, skip func(root, rel string, isDir bool) bool, warn func(string)) {
	rootOf := func(p string) (string, string) {
		for _, r := range roots {
			if rel, err := filepath.Rel(r, p); err == nil && !strings.HasPrefix(rel, "..") {
				return r, filepath.ToSlash(rel)
			}
		}
		return "", ""
	}
	for {
		select {
		case <-w.stop:
			return
		case <-w.ticker.C:
			w.poke()
		case ev, ok := <-w.fsw.Events:
			if !ok {
				return
			}
			root, rel := rootOf(ev.Name)
			if root == "" || rel == "." {
				w.poke()
				continue
			}
			base := filepath.Base(ev.Name)
			if strings.HasPrefix(base, ".ferry-") {
				continue // our own temp files
			}
			if skip(root, rel, false) {
				continue
			}
			if ev.Op&fsnotify.Create != 0 {
				// new directory: start watching it too
				_ = addTree(w.fsw, ev.Name, func(_ string, r string, d bool) bool {
					full := rel
					if r != "." {
						full = rel + "/" + r
					}
					return skip(root, full, d)
				})
			}
			w.poke()
		case err, ok := <-w.fsw.Errors:
			if !ok {
				return
			}
			warn("watcher: " + err.Error())
			w.poke() // overflow etc: rescan
		}
	}
}
