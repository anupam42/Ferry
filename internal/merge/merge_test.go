package merge

import (
	"strings"
	"testing"
)

var labels = Labels{Ours: "target", Theirs: "source"}

func TestCleanMerge(t *testing.T) {
	base := "a\nb\nc\nd\ne\n"
	ours := "a\nB\nc\nd\ne\n"
	theirs := "a\nb\nc\nD\ne\n"
	out, n, err := Merge3([]byte(base), []byte(ours), []byte(theirs), labels)
	if err != nil || n != 0 {
		t.Fatalf("n=%d err=%v", n, err)
	}
	if string(out) != "a\nB\nc\nD\ne\n" {
		t.Fatalf("got %q", out)
	}
}

func TestSameChangeBothSides(t *testing.T) {
	out, n, _ := Merge3([]byte("x\ny\n"), []byte("x\nz\n"), []byte("x\nz\n"), labels)
	if n != 0 || string(out) != "x\nz\n" {
		t.Fatalf("n=%d out=%q", n, out)
	}
}

func TestConflict(t *testing.T) {
	out, n, _ := Merge3([]byte("a\nb\nc\n"), []byte("a\nours\nc\n"), []byte("a\ntheirs\nc\n"), labels)
	if n != 1 {
		t.Fatalf("expected 1 conflict, got %d: %q", n, out)
	}
	s := string(out)
	for _, want := range []string{"<<<<<<< target\nours\n=======\ntheirs\n>>>>>>> source\n", "a\n", "c\n"} {
		if !strings.Contains(s, want) {
			t.Errorf("missing %q in %q", want, s)
		}
	}
}

func TestAppendsAndNoTrailingNewline(t *testing.T) {
	out, n, _ := Merge3([]byte("a\nb"), []byte("top\na\nb"), []byte("a\nb\nend"), labels)
	if n != 0 {
		t.Fatalf("unexpected conflict: %q", out)
	}
	if string(out) != "top\na\nb\nend" && string(out) != "top\na\nb\nend\n" {
		t.Logf("merged: %q", out)
	}
	if !strings.HasPrefix(string(out), "top\na\n") || !strings.Contains(string(out), "end") {
		t.Fatalf("got %q", out)
	}
}
