package engine

import (
	"bytes"
	"os"

	"github.com/anupam42/Ferry/internal/difftext"
)

const eolMaxSize = 16 << 20

// convertEOL rewrites line endings to LF or CRLF.
func convertEOL(data []byte, eol string) []byte {
	lf := bytes.ReplaceAll(data, []byte("\r\n"), []byte("\n"))
	if eol == "crlf" {
		return bytes.ReplaceAll(lf, []byte("\n"), []byte("\r\n"))
	}
	return lf
}

// copyFileEOL copies a text file, converting its line endings, and keeps the
// source's mode and mtime.
func copyFileEOL(src, dst, eol string) error {
	info, err := os.Stat(src)
	if err != nil {
		return err
	}
	data, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	return writeFileAtomic(dst, convertEOL(data, eol), info.Mode().Perm(), info.ModTime())
}

// sameIgnoringEOL compares two text files with CRLF and LF treated alike.
func sameIgnoringEOL(a, b string) bool {
	ia, err1 := os.Stat(a)
	ib, err2 := os.Stat(b)
	if err1 != nil || err2 != nil || ia.Size() > eolMaxSize || ib.Size() > eolMaxSize {
		return false
	}
	da, err1 := os.ReadFile(a)
	db, err2 := os.ReadFile(b)
	if err1 != nil || err2 != nil || difftext.IsBinary(da) || difftext.IsBinary(db) {
		return false
	}
	return bytes.Equal(convertEOL(da, "lf"), convertEOL(db, "lf"))
}
