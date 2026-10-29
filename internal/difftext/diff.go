// Package difftext produces a unified-style line diff without external tools.
package difftext

import (
	"bytes"
	"fmt"
	"strings"
)

// Line is one rendered diff line. Op is ' ', '+', '-' or '@' (hunk header).
type Line struct {
	Op   byte
	Text string
}

const maxCells = 25_000_000 // guard against huge LCS tables

// IsBinary reports whether data looks binary (NUL byte in the first 8KB).
func IsBinary(data []byte) bool {
	if len(data) > 8000 {
		data = data[:8000]
	}
	return bytes.IndexByte(data, 0) >= 0
}

func split(b []byte) []string {
	s := strings.ReplaceAll(string(b), "\r\n", "\n")
	s = strings.TrimSuffix(s, "\n")
	if s == "" {
		return nil
	}
	return strings.Split(s, "\n")
}

// Diff returns unified diff lines with `context` lines around changes.
func Diff(a, b []byte, context int) []Line {
	if IsBinary(a) || IsBinary(b) {
		if bytes.Equal(a, b) {
			return nil
		}
		return []Line{{'@', fmt.Sprintf("binary files differ (%d → %d bytes)", len(a), len(b))}}
	}
	al, bl := split(a), split(b)

	// trim common prefix/suffix to keep the table small
	pre := 0
	for pre < len(al) && pre < len(bl) && al[pre] == bl[pre] {
		pre++
	}
	suf := 0
	for suf < len(al)-pre && suf < len(bl)-pre && al[len(al)-1-suf] == bl[len(bl)-1-suf] {
		suf++
	}
	am, bm := al[pre:len(al)-suf], bl[pre:len(bl)-suf]
	if len(am)*len(bm) > maxCells {
		return []Line{{'@', fmt.Sprintf("diff too large to display (%d vs %d changed lines)", len(am), len(bm))}}
	}

	// LCS table
	n, m := len(am), len(bm)
	dp := make([][]int32, n+1)
	for i := range dp {
		dp[i] = make([]int32, m+1)
	}
	for i := n - 1; i >= 0; i-- {
		for j := m - 1; j >= 0; j-- {
			if am[i] == bm[j] {
				dp[i][j] = dp[i+1][j+1] + 1
			} else if dp[i+1][j] >= dp[i][j+1] {
				dp[i][j] = dp[i+1][j]
			} else {
				dp[i][j] = dp[i][j+1]
			}
		}
	}

	type op struct {
		k      byte
		s      string
		ai, bi int // 1-based line numbers in a and b
	}
	var ops []op
	for i := 0; i < pre; i++ {
		ops = append(ops, op{' ', al[i], i + 1, i + 1})
	}
	i, j := 0, 0
	for i < n || j < m {
		switch {
		case i < n && j < m && am[i] == bm[j]:
			ops = append(ops, op{' ', am[i], pre + i + 1, pre + j + 1})
			i++
			j++
		case j < m && (i == n || dp[i][j+1] >= dp[i+1][j]):
			ops = append(ops, op{'+', bm[j], pre + i + 1, pre + j + 1})
			j++
		default:
			ops = append(ops, op{'-', am[i], pre + i + 1, pre + j + 1})
			i++
		}
	}
	for k := 0; k < suf; k++ {
		ops = append(ops, op{' ', al[len(al)-suf+k], len(al) - suf + k + 1, len(bl) - suf + k + 1})
	}

	// group into hunks
	var out []Line
	for k := 0; k < len(ops); {
		if ops[k].k == ' ' {
			k++
			continue
		}
		start := k - context
		if start < 0 {
			start = 0
		}
		end := k
		for end < len(ops) {
			if ops[end].k != ' ' {
				end++
				continue
			}
			// look ahead: a short run of context between changes stays in the hunk
			run := end
			for run < len(ops) && ops[run].k == ' ' {
				run++
			}
			if run < len(ops) && run-end <= 2*context {
				end = run
				continue
			}
			end += context
			if end > len(ops) {
				end = len(ops)
			}
			break
		}
		var aCount, bCount int
		for _, o := range ops[start:end] {
			if o.k != '+' {
				aCount++
			}
			if o.k != '-' {
				bCount++
			}
		}
		out = append(out, Line{'@', fmt.Sprintf("@@ -%d,%d +%d,%d @@", ops[start].ai, aCount, ops[start].bi, bCount)})
		for _, o := range ops[start:end] {
			out = append(out, Line{o.k, o.s})
		}
		k = end
	}
	return out
}
