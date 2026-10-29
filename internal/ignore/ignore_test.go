package ignore

import "testing"

func TestMatcher(t *testing.T) {
	m := New(
		"node_modules",
		"*.log",
		"!keep.log",
		"/build",
		"docs/*.md",
		"**/tmp/**",
		"cache/",
		"a/**/z",
		"file[0-9].txt",
	)
	m.Add("sub", []string{"local.txt", "/only-here"})

	cases := []struct {
		path string
		dir  bool
		want bool
	}{
		{"node_modules", true, true},
		{"x/node_modules/pkg/index.js", false, true},
		{"app.log", false, true},
		{"deep/app.log", false, true},
		{"keep.log", false, false},
		{"build", true, true},
		{"build/out.js", false, true},
		{"src/build/out.js", false, false},
		{"docs/readme.md", false, true},
		{"docs/api/readme.md", false, false},
		{"x/tmp/y/z.txt", false, true},
		{"cache", true, true},
		{"cache", false, false},
		{"cache/item", false, true},
		{"a/z", false, true},
		{"a/b/c/z", false, true},
		{"file1.txt", false, true},
		{"fileA.txt", false, false},
		{"sub/local.txt", false, true},
		{"local.txt", false, false},
		{"sub/deeper/local.txt", false, true},
		{"sub/only-here", false, true},
		{"sub/x/only-here", false, false},
		{"src/main.go", false, false},
	}
	for _, c := range cases {
		if got := m.Match(c.path, c.dir); got != c.want {
			t.Errorf("Match(%q, dir=%v) = %v, want %v", c.path, c.dir, got, c.want)
		}
	}
}
