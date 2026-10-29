package engine

import (
	"os"
	"path/filepath"

	"github.com/anupam42/Ferry/internal/difftext"
	"github.com/anupam42/Ferry/internal/merge"
)

// With merge: true, two-way pairs keep a copy of the last-synced version of
// each text file (up to mergeMaxSize). That common ancestor makes a
// three-way merge possible when both sides change.
const mergeMaxSize = 2 << 20

func (e *Engine) baseCopyPath(rel string) string {
	return filepath.Join(e.dataDir, e.id, "base", filepath.FromSlash(rel))
}

func (e *Engine) saveBaseCopy(rel, p string, size int64) {
	if size > mergeMaxSize || isBinaryFile(p) {
		e.dropBaseCopy(rel)
		return
	}
	_, _ = copyFile(p, e.baseCopyPath(rel))
}

func (e *Engine) dropBaseCopy(rel string) {
	if e.cfg.Merge {
		_ = os.Remove(e.baseCopyPath(rel))
	}
}

// mergeOp tries a three-way merge of rel. With clean=true it fails when
// edits overlap; otherwise overlapping edits get conflict markers.
func (e *Engine) mergeOp(rel string, clean bool) (op, bool) {
	baseData, err := os.ReadFile(e.baseCopyPath(rel))
	if err != nil {
		return op{}, false
	}
	s, err1 := os.ReadFile(e.abs(src, rel))
	t, err2 := os.ReadFile(e.abs(dst, rel))
	if err1 != nil || err2 != nil || len(s) > mergeMaxSize || len(t) > mergeMaxSize ||
		difftext.IsBinary(s) || difftext.IsBinary(t) {
		return op{}, false
	}
	out, n, err := merge.Merge3(baseData, t, s, merge.Labels{Ours: "target", Theirs: "source"})
	if err != nil || (clean && n > 0) {
		return op{}, false
	}
	return op{kind: opMerge, rel: rel, data: out, markers: n}, true
}
