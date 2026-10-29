package difftext

import "testing"

func TestDiff(t *testing.T) {
	a := []byte("a\nb\nc\nd\ne\nf\ng\nh\ni\nj\n")
	b := []byte("a\nB\nc\nd\ne\nf\ng\nh\ni\nj\nk\n")
	lines := Diff(a, b, 1)
	var adds, dels, hunks int
	for _, l := range lines {
		switch l.Op {
		case '+':
			adds++
		case '-':
			dels++
		case '@':
			hunks++
		}
	}
	if adds != 2 || dels != 1 || hunks != 2 {
		t.Fatalf("adds=%d dels=%d hunks=%d: %+v", adds, dels, hunks, lines)
	}
	if Diff(a, a, 3) != nil {
		t.Fatal("identical input should give no diff")
	}
	if l := Diff([]byte("x\x00"), []byte("y\x00"), 3); len(l) != 1 {
		t.Fatal("binary should give one summary line")
	}
}
