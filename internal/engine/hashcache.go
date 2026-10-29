package engine

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
)

// hashCache remembers content hashes by path, size and mtime so unchanged
// files are not re-read on every comparison. It is saved between runs.
type hashCache struct {
	mu    sync.Mutex
	m     map[string]*hcEntry
	dirty bool
}

type hcEntry struct {
	Size int64  `json:"s"`
	Mod  int64  `json:"m"`
	Hash string `json:"h"`
	used bool
}

func newHashCache() *hashCache { return &hashCache{m: map[string]*hcEntry{}} }

func (c *hashCache) get(p string) (string, error) {
	fi, err := os.Stat(p)
	if err != nil {
		return "", err
	}
	size, mod := fi.Size(), fi.ModTime().UnixNano()
	c.mu.Lock()
	if en, ok := c.m[p]; ok && en.Size == size && en.Mod == mod {
		en.used = true
		h := en.Hash
		c.mu.Unlock()
		return h, nil
	}
	c.mu.Unlock()
	h, err := hashFile(p)
	if err != nil {
		return "", err
	}
	// only cache if the file didn't change while it was being read
	if fi2, err := os.Stat(p); err == nil && fi2.Size() == size && fi2.ModTime().UnixNano() == mod {
		c.mu.Lock()
		c.m[p] = &hcEntry{Size: size, Mod: mod, Hash: h, used: true}
		c.dirty = true
		c.mu.Unlock()
	}
	return h, nil
}

func (c *hashCache) clear() {
	c.mu.Lock()
	c.m = map[string]*hcEntry{}
	c.dirty = true
	c.mu.Unlock()
}

func (c *hashCache) load(path string) {
	data, err := os.ReadFile(path)
	if err != nil {
		return
	}
	var m map[string]*hcEntry
	if json.Unmarshal(data, &m) != nil || m == nil {
		return
	}
	c.mu.Lock()
	c.m = m
	c.mu.Unlock()
}

// save writes the entries used this session (so deleted files drop out).
func (c *hashCache) save(path string) {
	c.mu.Lock()
	if !c.dirty {
		c.mu.Unlock()
		return
	}
	keep := make(map[string]*hcEntry, len(c.m))
	for k, v := range c.m {
		if v.used {
			keep[k] = v
		}
	}
	c.dirty = false
	data, err := json.Marshal(keep)
	c.mu.Unlock()
	if err != nil {
		return
	}
	_ = os.MkdirAll(filepath.Dir(path), 0o755)
	tmp := path + ".tmp"
	if os.WriteFile(tmp, data, 0o644) == nil {
		_ = replaceFile(tmp, path)
	}
}

func (e *Engine) hashPath() string { return filepath.Join(e.dataDir, e.id, "hashes.json") }

// hash returns the content hash of p, from the cache when possible.
func (e *Engine) hash(p string) (string, error) { return e.hashes.get(p) }

// same reports whether two files have the same content. Symlinks (in link
// mode) compare their targets; with eol conversion on, line endings are
// ignored for text files.
func (e *Engine) same(a, b string) bool {
	if e.cfg.Symlinks == "link" {
		la, lb := isSymlink(a), isSymlink(b)
		if la || lb {
			if !la || !lb {
				return false
			}
			ta, err1 := os.Readlink(a)
			tb, err2 := os.Readlink(b)
			return err1 == nil && err2 == nil && ta == tb
		}
	}
	ia, err1 := os.Stat(a)
	ib, err2 := os.Stat(b)
	if err1 != nil || err2 != nil {
		return false
	}
	if ia.Size() == ib.Size() {
		ha, err1 := e.hash(a)
		hb, err2 := e.hash(b)
		if err1 == nil && err2 == nil && ha == hb {
			return true
		}
	}
	if e.cfg.EOL == "keep" {
		return false
	}
	return sameIgnoringEOL(a, b)
}
