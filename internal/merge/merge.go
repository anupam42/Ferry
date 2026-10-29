// Package merge does line-based three-way merges (diff3) without external tools.
package merge

import (
	"bytes"
	"errors"
)

// Labels name the sides in conflict markers.
type Labels struct{ Ours, Theirs string }

// ErrTooLarge means the files have too many changed lines to merge in memory.
var ErrTooLarge = errors.New("merge: too many changed lines")

const maxCells = 4_000_000

// Merge3 applies both the base→ours and base→theirs changes to base.
// Changes that overlap (or touch adjacent lines, as in git) become conflict
// blocks with <<<<<<< ======= >>>>>>> markers; their number is returned.
func Merge3(base, ours, theirs []byte, l Labels) ([]byte, int, error) {
	B, O, T := splitLines(base), splitLines(ours), splitLines(theirs)
	mo, err := match(B, O)
	if err != nil {
		return nil, 0, err
	}
	mt, err := match(B, T)
	if err != nil {
		return nil, 0, err
	}
	var out bytes.Buffer
	conflicts := 0
	i, jo, jt := 0, 0, 0
	for {
		// next base line that survived unchanged on both sides
		k := i
		for k < len(B) && (mo[k] < 0 || mt[k] < 0) {
			k++
		}
		eo, et := len(O), len(T)
		if k < len(B) {
			eo, et = mo[k], mt[k]
		}
		bc, oc, tc := B[i:k], O[jo:eo], T[jt:et]
		switch {
		case equal(oc, tc):
			writeAll(&out, oc)
		case equal(bc, oc):
			writeAll(&out, tc)
		case equal(bc, tc):
			writeAll(&out, oc)
		default:
			conflicts++
			out.WriteString("<<<<<<< " + l.Ours + "\n")
			writeBlock(&out, oc)
			out.WriteString("=======\n")
			writeBlock(&out, tc)
			out.WriteString(">>>>>>> " + l.Theirs + "\n")
		}
		if k >= len(B) {
			break
		}
		out.Write(B[k])
		i, jo, jt = k+1, eo+1, et+1
	}
	return out.Bytes(), conflicts, nil
}

func splitLines(b []byte) []string {
	var out []string
	for len(b) > 0 {
		i := bytes.IndexByte(b, '\n')
		if i < 0 {
			out = append(out, string(b))
			break
		}
		out = append(out, string(b[:i+1]))
		b = b[i+1:]
	}
	return out
}

func equal(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func writeAll(w *bytes.Buffer, lines []string) {
	for _, l := range lines {
		w.WriteString(l)
	}
}

// writeBlock writes lines and makes sure the block ends with a newline so the
// next marker starts on its own line.
func writeBlock(w *bytes.Buffer, lines []string) {
	writeAll(w, lines)
	if n := len(lines); n > 0 && len(lines[n-1]) > 0 && lines[n-1][len(lines[n-1])-1] != '\n' {
		w.WriteByte('\n')
	}
}

// match returns, for each line of a, the index of the line of b it is paired
// with in a longest common subsequence, or -1.
func match(a, b []string) ([]int, error) {
	res := make([]int, len(a))
	for i := range res {
		res[i] = -1
	}
	pre := 0
	for pre < len(a) && pre < len(b) && a[pre] == b[pre] {
		res[pre] = pre
		pre++
	}
	suf := 0
	for suf < len(a)-pre && suf < len(b)-pre && a[len(a)-1-suf] == b[len(b)-1-suf] {
		res[len(a)-1-suf] = len(b) - 1 - suf
		suf++
	}
	am, bm := a[pre:len(a)-suf], b[pre:len(b)-suf]
	n, m := len(am), len(bm)
	if n == 0 || m == 0 {
		return res, nil
	}
	if n*m > maxCells {
		return nil, ErrTooLarge
	}
	dp := make([][]int32, n+1)
	for i := range dp {
		dp[i] = make([]int32, m+1)
	}
	for i := n - 1; i >= 0; i-- {
		for j := m - 1; j >= 0; j-- {
			switch {
			case am[i] == bm[j]:
				dp[i][j] = dp[i+1][j+1] + 1
			case dp[i+1][j] >= dp[i][j+1]:
				dp[i][j] = dp[i+1][j]
			default:
				dp[i][j] = dp[i][j+1]
			}
		}
	}
	i, j := 0, 0
	for i < n && j < m {
		switch {
		case am[i] == bm[j]:
			res[pre+i] = pre + j
			i++
			j++
		case dp[i+1][j] >= dp[i][j+1]:
			i++
		default:
			j++
		}
	}
	return res, nil
}
