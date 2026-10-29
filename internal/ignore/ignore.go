// Package ignore implements .gitignore-style path matching.
//
// Supported syntax: blank lines, # comments, ! negation, trailing / for
// directories, leading / or inner / to anchor, *, ?, [abc], and **.
// Rules can be scoped to a base directory, which is how nested .gitignore
// files work. Later rules win, as in git.
package ignore

import (
	"bufio"
	"os"
	"path"
	"regexp"
	"strings"
)

type rule struct {
	re      *regexp.Regexp
	negate  bool
	dirOnly bool
	base    string // slash path ("" = root)
}

// Matcher holds an ordered list of rules.
type Matcher struct {
	rules []rule
}

// New returns a matcher with the given root-level patterns.
func New(patterns ...string) *Matcher {
	m := &Matcher{}
	m.Add("", patterns)
	return m
}

// Clone returns an independent copy (rules are immutable, so a shallow copy of the slice is enough).
func (m *Matcher) Clone() *Matcher {
	c := &Matcher{rules: make([]rule, len(m.rules))}
	copy(c.rules, m.rules)
	return c
}

// Len reports the number of rules.
func (m *Matcher) Len() int { return len(m.rules) }

// AddFile reads a gitignore-format file; base is the slash path of the
// directory containing it, relative to the sync root. Missing files are fine.
func (m *Matcher) AddFile(file, base string) {
	f, err := os.Open(file)
	if err != nil {
		return
	}
	defer f.Close()
	var lines []string
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		lines = append(lines, sc.Text())
	}
	m.Add(base, lines)
}

// Add compiles patterns scoped to base.
func (m *Matcher) Add(base string, patterns []string) {
	base = strings.Trim(base, "/")
	for _, p := range patterns {
		if r, ok := compile(p, base); ok {
			m.rules = append(m.rules, r)
		}
	}
}

func compile(p, base string) (rule, bool) {
	p = strings.TrimRight(p, "\r")
	// trailing spaces are ignored unless escaped
	for strings.HasSuffix(p, " ") && !strings.HasSuffix(p, `\ `) {
		p = p[:len(p)-1]
	}
	if p == "" || strings.HasPrefix(p, "#") {
		return rule{}, false
	}
	r := rule{base: base}
	if strings.HasPrefix(p, "!") {
		r.negate = true
		p = p[1:]
	} else if strings.HasPrefix(p, `\!`) || strings.HasPrefix(p, `\#`) {
		p = p[1:]
	}
	if strings.HasSuffix(p, "/") {
		r.dirOnly = true
		p = strings.TrimRight(p, "/")
	}
	if p == "" {
		return rule{}, false
	}
	anchored := strings.Contains(p, "/")
	p = strings.TrimPrefix(p, "/")

	var sb strings.Builder
	sb.WriteString("^")
	if base != "" {
		sb.WriteString(regexp.QuoteMeta(base) + "/")
	}
	if !anchored {
		sb.WriteString("(?:.*/)?")
	}
	sb.WriteString(globToRegex(p))
	sb.WriteString("$")
	re, err := regexp.Compile(sb.String())
	if err != nil {
		return rule{}, false
	}
	r.re = re
	return r, true
}

func globToRegex(g string) string {
	var sb strings.Builder
	for i := 0; i < len(g); i++ {
		c := g[i]
		switch c {
		case '*':
			if i+1 < len(g) && g[i+1] == '*' {
				// "**/" => any number of dirs; "/**" at end => everything inside; "**" => anything
				if i+2 < len(g) && g[i+2] == '/' {
					sb.WriteString("(?:.*/)?")
					i += 2
				} else {
					sb.WriteString(".*")
					i++
				}
			} else {
				sb.WriteString("[^/]*")
			}
		case '?':
			sb.WriteString("[^/]")
		case '[':
			j := i + 1
			if j < len(g) && (g[j] == '!' || g[j] == '^') {
				j++
			}
			if j < len(g) && g[j] == ']' {
				j++
			}
			for j < len(g) && g[j] != ']' {
				j++
			}
			if j >= len(g) {
				sb.WriteString(`\[`)
				continue
			}
			class := g[i+1 : j]
			if strings.HasPrefix(class, "!") {
				class = "^" + class[1:]
			}
			sb.WriteString("[" + strings.ReplaceAll(class, `\`, `\\`) + "]")
			i = j
		case '\\':
			if i+1 < len(g) {
				i++
				sb.WriteString(regexp.QuoteMeta(string(g[i])))
			}
		default:
			sb.WriteString(regexp.QuoteMeta(string(c)))
		}
	}
	return sb.String()
}

// matchOne applies rules to exactly this path (no parent check).
func (m *Matcher) matchOne(rel string, isDir bool) bool {
	ignored := false
	for _, r := range m.rules {
		if r.dirOnly && !isDir {
			continue
		}
		if r.base != "" && !strings.HasPrefix(rel, r.base+"/") {
			continue
		}
		if r.re.MatchString(rel) {
			ignored = !r.negate
		}
	}
	return ignored
}

// Match reports whether rel (slash-separated, relative to root) is ignored,
// either directly or because one of its parent directories is.
func (m *Matcher) Match(rel string, isDir bool) bool {
	if m == nil || len(m.rules) == 0 {
		return false
	}
	rel = strings.Trim(rel, "/")
	// parents first: git can't re-include a file inside an excluded directory
	dir := path.Dir(rel)
	if dir != "." {
		parts := strings.Split(dir, "/")
		for i := range parts {
			if m.matchOne(strings.Join(parts[:i+1], "/"), true) {
				return true
			}
		}
	}
	return m.matchOne(rel, isDir)
}

// MatchDirect is Match without the parent check; use it during a walk where
// excluded parents have already been skipped.
func (m *Matcher) MatchDirect(rel string, isDir bool) bool {
	if m == nil {
		return false
	}
	return m.matchOne(rel, isDir)
}
