package tui

import (
	"path"
	"regexp"
	"strings"

	"github.com/charmbracelet/lipgloss"

	"github.com/anupam42/Ferry/internal/difftext"
)

// renderDiff draws m.diffLines unified or side by side, with light syntax
// highlighting for common languages.
func (m Model) renderDiff() string {
	if len(m.diffLines) == 0 {
		return sMuted.Render("no differences")
	}
	lang := langFor(m.diffPath)
	if m.sideBySide {
		return renderSideBySide(m.diffLines, lang, m.vp.Width)
	}
	add := lipgloss.NewStyle().Foreground(cGreen)
	del := lipgloss.NewStyle().Foreground(cRed)
	hunk := lipgloss.NewStyle().Foreground(cCyan)
	plain := lipgloss.NewStyle()
	var b strings.Builder
	for _, l := range m.diffLines {
		switch l.Op {
		case '+':
			b.WriteString(add.Render("+") + highlight(l.Text, lang, add))
		case '-':
			b.WriteString(del.Render("-") + highlight(l.Text, lang, del))
		case '@':
			b.WriteString(hunk.Render(l.Text))
		default:
			b.WriteString(" " + highlight(l.Text, lang, plain))
		}
		b.WriteByte('\n')
	}
	return b.String()
}

func renderSideBySide(lines []difftext.Line, lang *language, width int) string {
	col := (width - 3) / 2
	if col < 10 {
		col = 10
	}
	add := lipgloss.NewStyle().Foreground(cGreen)
	del := lipgloss.NewStyle().Foreground(cRed)
	hunk := lipgloss.NewStyle().Foreground(cCyan)
	plain := lipgloss.NewStyle()
	sep := sMuted.Render(" │ ")
	cell := func(text string, st lipgloss.Style) string {
		s := truncate(highlight(expandTabs(text), lang, st), col)
		if pad := col - lipgloss.Width(s); pad > 0 {
			s += strings.Repeat(" ", pad)
		}
		return s
	}
	blank := strings.Repeat(" ", col)
	var b strings.Builder
	var dels, adds []string
	flush := func() {
		for i := 0; i < len(dels) || i < len(adds); i++ {
			left, right := blank, blank
			if i < len(dels) {
				left = cell(dels[i], del)
			}
			if i < len(adds) {
				right = cell(adds[i], add)
			}
			b.WriteString(left + sep + right + "\n")
		}
		dels, adds = dels[:0], adds[:0]
	}
	for _, l := range lines {
		switch l.Op {
		case '-':
			dels = append(dels, l.Text)
		case '+':
			adds = append(adds, l.Text)
		case '@':
			flush()
			b.WriteString(hunk.Render(truncate(l.Text, width)) + "\n")
		default:
			flush()
			b.WriteString(cell(l.Text, plain) + sep + cell(l.Text, plain) + "\n")
		}
	}
	flush()
	return b.String()
}

func expandTabs(s string) string { return strings.ReplaceAll(s, "\t", "    ") }

// ---------- syntax highlighting ----------

type language struct {
	comment  string // line comment marker
	keywords map[string]bool
}

func words(s string) map[string]bool {
	m := map[string]bool{}
	for _, w := range strings.Fields(s) {
		m[w] = true
	}
	return m
}

var (
	cLike = words("if else for while do switch case default break continue return func function var let const " +
		"type struct interface class extends implements new delete this self super import export from package " +
		"public private protected static final void int string bool true false nil null undefined try catch " +
		"finally throw throws async await yield go defer select chan map range enum fn impl trait pub use mod " +
		"match mut where loop as in of typeof instanceof")
	pyLike = words("def class if elif else for while return import from as with try except finally raise " +
		"lambda yield pass break continue and or not in is None True False global nonlocal async await self " +
		"then fi do done case esac function local export echo")

	languages = map[string]*language{
		".go": {"//", cLike}, ".js": {"//", cLike}, ".jsx": {"//", cLike}, ".ts": {"//", cLike}, ".tsx": {"//", cLike},
		".java": {"//", cLike}, ".kt": {"//", cLike}, ".c": {"//", cLike}, ".h": {"//", cLike}, ".cpp": {"//", cLike},
		".cc": {"//", cLike}, ".hpp": {"//", cLike}, ".cs": {"//", cLike}, ".rs": {"//", cLike}, ".swift": {"//", cLike},
		".php": {"//", cLike}, ".scala": {"//", cLike}, ".dart": {"//", cLike},
		".py": {"#", pyLike}, ".rb": {"#", pyLike}, ".sh": {"#", pyLike}, ".bash": {"#", pyLike}, ".zsh": {"#", pyLike},
		".yaml": {"#", nil}, ".yml": {"#", nil}, ".toml": {"#", nil}, ".ps1": {"#", pyLike}, ".r": {"#", pyLike},
		".sql": {"--", words("select from where insert into update delete create table drop alter join left right inner outer on group by order having limit values set and or not null as")},
		".lua": {"--", cLike},
	}

	reToken = regexp.MustCompile("\"(?:[^\"\\\\]|\\\\.)*\"|'(?:[^'\\\\]|\\\\.)*'|`[^`]*`|\\b\\d+(?:\\.\\d+)?\\b|\\b[A-Za-z_][A-Za-z0-9_]*\\b")
)

func langFor(p string) *language {
	return languages[strings.ToLower(path.Ext(strings.ReplaceAll(p, `\`, "/")))]
}

// highlight colors keywords, strings, numbers and line comments; the rest
// of the line uses base.
func highlight(text string, lang *language, base lipgloss.Style) string {
	if lang == nil || themeName == "mono" {
		return base.Render(text)
	}
	code, comment := text, ""
	if lang.comment != "" {
		if i := commentStart(text, lang.comment); i >= 0 {
			code, comment = text[:i], text[i:]
		}
	}
	kw := lipgloss.NewStyle().Foreground(cPurple).Bold(true)
	str := lipgloss.NewStyle().Foreground(cYellow)
	num := lipgloss.NewStyle().Foreground(cCyan)
	var b strings.Builder
	last := 0
	for _, loc := range reToken.FindAllStringIndex(code, -1) {
		tok := code[loc[0]:loc[1]]
		var st *lipgloss.Style
		switch c := tok[0]; {
		case c == '"' || c == '\'' || c == '`':
			st = &str
		case c >= '0' && c <= '9':
			st = &num
		case lang.keywords[tok]:
			st = &kw
		}
		if st == nil {
			continue
		}
		if loc[0] > last {
			b.WriteString(base.Render(code[last:loc[0]]))
		}
		b.WriteString(st.Render(tok))
		last = loc[1]
	}
	if last < len(code) {
		b.WriteString(base.Render(code[last:]))
	}
	if comment != "" {
		b.WriteString(sMuted.Italic(true).Render(comment))
	}
	return b.String()
}

// commentStart finds a line comment marker that is not inside a string.
func commentStart(s, marker string) int {
	var quote byte
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case quote != 0:
			if c == '\\' {
				i++
			} else if c == quote {
				quote = 0
			}
		case c == '"' || c == '\'' || c == '`':
			quote = c
		case strings.HasPrefix(s[i:], marker):
			return i
		}
	}
	return -1
}
