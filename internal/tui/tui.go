// Package tui is the interactive dashboard.
package tui

import (
	"fmt"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/textinput"
	"github.com/charmbracelet/bubbles/viewport"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"

	"github.com/anupam42/Ferry/internal/difftext"
	"github.com/anupam42/Ferry/internal/engine"
	"github.com/anupam42/Ferry/internal/gitx"
)

// EventMsg delivers an engine event to the dashboard.
type EventMsg engine.Event

type tickMsg time.Time

type flashMsg string

type diffMsg struct {
	title string
	path  string
	lines []difftext.Line
}

type historyMsg struct {
	batches []engine.Batch
	note    string
}

type mode int

const (
	modeMain mode = iota
	modeDiff
	modeCommit
	modeHelp
	modeSearch
	modeHistory
)

type row struct {
	text     string
	path     string // empty for directory rows
	kind     engine.Kind
	dir      string
	conflict bool
	depth    int
}

// Model is the bubbletea model.
type Model struct {
	engines  []*engine.Engine
	statuses []engine.Status
	version  string

	sel     int
	fileSel int
	rows    []row
	logs    []engine.Event
	logOff  int // lines scrolled up from the bottom

	w, h    int
	mode    mode
	vp      viewport.Model
	title   string
	input   textinput.Model
	push    bool
	staged  bool // commit only what's staged
	flash   string
	flashAt time.Time

	filter     string
	search     textinput.Model
	diffLines  []difftext.Line
	diffPath   string
	sideBySide bool
	batches    []engine.Batch
	undoArmed  bool
}

// New builds the dashboard for the given engines.
func New(engines []*engine.Engine, version string) Model {
	ti := textinput.New()
	ti.Placeholder = "commit message"
	ti.CharLimit = 200
	si := textinput.New()
	si.Placeholder = "filter files and activity"
	si.CharLimit = 100
	m := Model{engines: engines, version: version, input: ti, search: si, vp: viewport.New(80, 20)}
	m.refresh()
	return m
}

func tick() tea.Cmd {
	return tea.Tick(500*time.Millisecond, func(t time.Time) tea.Msg { return tickMsg(t) })
}

func (m Model) Init() tea.Cmd { return tick() }

// ---------- styles and themes ----------

var (
	cAccent, cMuted, cGreen, cYellow, cRed, cCyan, cPurple lipgloss.TerminalColor

	sTitle, sMuted, sBold, sSel, sBox, sBoxAct, sFlash lipgloss.Style

	themes    = []string{"auto", "dark", "light", "mono"}
	themeName = "auto"
	autoDark  *bool
)

func init() { SetTheme("auto") }

// SetTheme switches colors: auto (follow the terminal), dark, light or mono.
func SetTheme(name string) {
	switch name {
	case "dark", "light", "mono":
	default:
		name = "auto"
	}
	themeName = name
	ad := func(l, d string) lipgloss.TerminalColor { return lipgloss.AdaptiveColor{Light: l, Dark: d} }
	cAccent, cMuted = ad("#5A4FCF", "#9D8CFF"), ad("#777777", "#8A8A8A")
	cGreen, cYellow, cRed = ad("#18794E", "#4ADE80"), ad("#A15C00", "#FACC15"), ad("#C62828", "#F87171")
	cCyan, cPurple = ad("#00708A", "#67E8F9"), ad("#8E24AA", "#E879F9")
	switch name {
	case "mono":
		none := lipgloss.NoColor{}
		cAccent, cMuted, cGreen, cYellow, cRed, cCyan, cPurple = none, none, none, none, none, none, none
	case "dark":
		rememberAuto()
		lipgloss.SetHasDarkBackground(true)
	case "light":
		rememberAuto()
		lipgloss.SetHasDarkBackground(false)
	default:
		if autoDark != nil {
			lipgloss.SetHasDarkBackground(*autoDark)
		}
	}
	sTitle = lipgloss.NewStyle().Bold(true).Foreground(cAccent)
	sMuted = lipgloss.NewStyle().Foreground(cMuted)
	if name == "mono" {
		sMuted = sMuted.Faint(true)
	}
	sBold = lipgloss.NewStyle().Bold(true)
	sSel = lipgloss.NewStyle().Bold(true).Reverse(true)
	sBox = lipgloss.NewStyle().Border(lipgloss.RoundedBorder()).BorderForeground(cMuted).Padding(0, 1)
	sBoxAct = sBox.BorderForeground(cAccent)
	sFlash = lipgloss.NewStyle().Foreground(cYellow).Bold(true)
}

func rememberAuto() {
	if autoDark == nil {
		d := lipgloss.HasDarkBackground()
		autoDark = &d
	}
}

func nextTheme() string {
	for i, t := range themes {
		if t == themeName {
			return themes[(i+1)%len(themes)]
		}
	}
	return "auto"
}

func kindStyle(k engine.Kind) (string, lipgloss.Style) {
	switch k {
	case engine.KAdd:
		return "+", lipgloss.NewStyle().Foreground(cGreen)
	case engine.KUpdate:
		return "~", lipgloss.NewStyle().Foreground(cYellow)
	case engine.KDelete:
		return "-", lipgloss.NewStyle().Foreground(cRed)
	case engine.KRename:
		return "↻", lipgloss.NewStyle().Foreground(cPurple)
	case engine.KConflict:
		return "!", lipgloss.NewStyle().Foreground(cRed).Bold(true)
	case engine.KResolved, engine.KResumed:
		return "✓", lipgloss.NewStyle().Foreground(cGreen)
	case engine.KError:
		return "✗", lipgloss.NewStyle().Foreground(cRed).Bold(true)
	case engine.KWarn, engine.KPaused:
		return "⚠", lipgloss.NewStyle().Foreground(cYellow)
	case engine.KSkip:
		return "·", sMuted
	case engine.KKept:
		return "◇", lipgloss.NewStyle().Foreground(cCyan)
	case engine.KCommit:
		return "●", lipgloss.NewStyle().Foreground(cGreen).Bold(true)
	case engine.KSynced, engine.KGit:
		return "⇄", lipgloss.NewStyle().Foreground(cCyan)
	}
	return "•", lipgloss.NewStyle().Foreground(cAccent)
}

// ---------- update ----------

func (m *Model) refresh() {
	m.statuses = m.statuses[:0]
	for _, e := range m.engines {
		m.statuses = append(m.statuses, e.Status())
	}
	if m.sel >= len(m.statuses) {
		m.sel = 0
	}
	m.rows = buildRows(m.statuses[m.sel], m.filter)
	if m.fileSel >= len(m.rows) {
		m.fileSel = len(m.rows) - 1
	}
	if m.fileSel < 0 {
		m.fileSel = 0
	}
}

func matches(filter string, parts ...string) bool {
	if filter == "" {
		return true
	}
	f := strings.ToLower(filter)
	for _, p := range parts {
		if strings.Contains(strings.ToLower(p), f) {
			return true
		}
	}
	return false
}

func buildRows(st engine.Status, filter string) []row {
	conf := map[string]bool{}
	for _, c := range st.Conflicts {
		conf[c] = true
	}
	files := map[string]engine.ChangedFile{}
	for _, c := range st.Changed {
		files[c.Path] = c
	}
	for c := range conf {
		if _, ok := files[c]; !ok {
			files[c] = engine.ChangedFile{Path: c, Kind: engine.KConflict}
		}
	}
	paths := make([]string, 0, len(files))
	for p := range files {
		if matches(filter, p) {
			paths = append(paths, p)
		}
	}
	// conflicts first, then alphabetical
	sort.Slice(paths, func(i, j int) bool {
		if conf[paths[i]] != conf[paths[j]] {
			return conf[paths[i]]
		}
		return paths[i] < paths[j]
	})
	var rows []row
	seen := map[string]bool{}
	for _, p := range paths {
		f := files[p]
		dir := path.Dir(p)
		if conf[p] {
			rows = append(rows, row{text: p, path: p, kind: engine.KConflict, conflict: true})
			continue
		}
		if dir != "." {
			parts := strings.Split(dir, "/")
			for i := range parts {
				d := strings.Join(parts[:i+1], "/")
				if !seen[d] {
					seen[d] = true
					rows = append(rows, row{text: parts[i] + "/", depth: i})
				}
			}
		}
		depth := 0
		if dir != "." {
			depth = strings.Count(dir, "/") + 1
		}
		rows = append(rows, row{text: path.Base(p), path: p, kind: f.Kind, dir: f.Dir, depth: depth})
	}
	return rows
}

func (m Model) selectedRow() (row, bool) {
	if m.fileSel < 0 || m.fileSel >= len(m.rows) {
		return row{}, false
	}
	return m.rows[m.fileSel], true
}

func (m *Model) say(s string) { m.flash, m.flashAt = s, time.Now() }

func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.w, m.h = msg.Width, msg.Height
		m.vp.Width, m.vp.Height = msg.Width-4, msg.Height-5
		if m.mode == modeDiff {
			m.vp.SetContent(m.renderDiff())
		}
		return m, nil
	case tickMsg:
		m.refresh()
		return m, tick()
	case flashMsg:
		if msg != "" {
			m.say(string(msg))
		}
		return m, nil
	case EventMsg:
		ev := engine.Event(msg)
		if ev.Kind == engine.KGit {
			return m, nil // shown in the files panel instead
		}
		m.logs = append(m.logs, ev)
		if len(m.logs) > 2000 {
			m.logs = m.logs[len(m.logs)-2000:]
		}
		if m.logOff > 0 {
			m.logOff++ // keep the view stable while scrolled up
		}
		return m, nil
	case diffMsg:
		m.title, m.diffPath, m.diffLines = msg.title, msg.path, msg.lines
		m.vp.SetContent(m.renderDiff())
		m.vp.GotoTop()
		m.mode = modeDiff
		return m, nil
	case historyMsg:
		m.batches = msg.batches
		m.undoArmed = false
		if msg.note != "" {
			m.say(msg.note)
		}
		m.vp.SetContent(m.renderHistory())
		m.vp.GotoTop()
		m.mode = modeHistory
		return m, nil
	case tea.KeyMsg:
		return m.handleKey(msg)
	}
	return m, nil
}

func (m Model) handleKey(k tea.KeyMsg) (tea.Model, tea.Cmd) {
	if k.String() == "ctrl+c" {
		return m, tea.Quit
	}
	e := m.engines[m.sel]
	switch m.mode {
	case modeHelp:
		m.mode = modeMain
		return m, nil
	case modeDiff:
		switch k.String() {
		case "esc", "q", "d", "enter":
			m.mode = modeMain
			return m, nil
		case "v":
			m.sideBySide = !m.sideBySide
			m.vp.SetContent(m.renderDiff())
			return m, nil
		}
		var cmd tea.Cmd
		m.vp, cmd = m.vp.Update(k)
		return m, cmd
	case modeHistory:
		switch k.String() {
		case "esc", "q", "H":
			m.mode = modeMain
			return m, nil
		case "u":
			if !m.undoArmed {
				m.undoArmed = true
				m.say("press u again to undo the newest batch (backups are kept)")
				return m, nil
			}
			m.undoArmed = false
			return m, func() tea.Msg {
				b, problems, err := e.UndoLast()
				if err != nil {
					return flashMsg("undo: " + err.Error())
				}
				note := fmt.Sprintf("undid the batch from %s", b.Time.Format("15:04:05"))
				if len(problems) > 0 {
					note += fmt.Sprintf(" (%d file(s) couldn't be restored: %s)", len(problems), problems[0])
				}
				return historyMsg{batches: e.History(), note: note}
			}
		}
		var cmd tea.Cmd
		m.vp, cmd = m.vp.Update(k)
		return m, cmd
	case modeSearch:
		switch k.String() {
		case "esc":
			m.mode = modeMain
			m.filter = ""
			m.search.Blur()
			m.refresh()
			return m, nil
		case "enter":
			m.mode = modeMain
			m.search.Blur()
			return m, nil
		}
		var cmd tea.Cmd
		m.search, cmd = m.search.Update(k)
		m.filter = strings.TrimSpace(m.search.Value())
		m.fileSel = 0
		m.refresh()
		return m, cmd
	case modeCommit:
		switch k.String() {
		case "esc":
			m.mode = modeMain
			m.input.Blur()
			return m, nil
		case "enter":
			msg := strings.TrimSpace(m.input.Value())
			if msg == "" {
				msg = m.input.Placeholder
			}
			if m.staged {
				e.CommitStaged(msg, m.push)
			} else {
				e.Commit(msg, m.push)
			}
			m.mode = modeMain
			m.input.Blur()
			m.say("committing…")
			return m, nil
		}
		var cmd tea.Cmd
		m.input, cmd = m.input.Update(k)
		return m, cmd
	}

	switch k.String() {
	case "q":
		return m, tea.Quit
	case "?", "h":
		m.mode = modeHelp
	case "esc":
		if m.filter != "" {
			m.filter = ""
			m.search.SetValue("")
			m.refresh()
		}
	case "/":
		m.mode = modeSearch
		m.search.SetValue(m.filter)
		m.search.Focus()
		return m, textinput.Blink
	case "tab", "]":
		m.sel = (m.sel + 1) % len(m.engines)
		m.fileSel = 0
		m.refresh()
	case "shift+tab", "[":
		m.sel = (m.sel - 1 + len(m.engines)) % len(m.engines)
		m.fileSel = 0
		m.refresh()
	case "up", "k":
		for i := m.fileSel - 1; i >= 0; i-- {
			if m.rows[i].path != "" {
				m.fileSel = i
				break
			}
		}
	case "down", "j":
		for i := m.fileSel + 1; i < len(m.rows); i++ {
			if m.rows[i].path != "" {
				m.fileSel = i
				break
			}
		}
	case "pgup":
		m.logOff += 10
	case "pgdown":
		m.logOff -= 10
		if m.logOff < 0 {
			m.logOff = 0
		}
	case "end", "G":
		m.logOff = 0
	case "p", " ":
		e.TogglePause()
		m.say("toggled pause")
	case "r":
		e.Resync()
		m.say("full resync requested")
	case "y":
		if m.statuses[m.sel].PendingBatch > 0 {
			e.ApproveBatch()
			m.say("batch approved")
		}
	case "T":
		SetTheme(nextTheme())
		m.say("theme: " + themeName)
	case "H":
		return m, func() tea.Msg { return historyMsg{batches: e.History()} }
	case "c", "C":
		st := m.statuses[m.sel]
		if !st.IsGit {
			m.say("target is not a git repo")
			return m, nil
		}
		m.push = k.String() == "C"
		m.staged = gitx.StagedCount(st.GitStatus) > 0
		m.mode = modeCommit
		m.input.SetValue("")
		m.input.Placeholder = "sync: " + engine.SummarizeStatus(st.GitStatus)
		m.input.Focus()
		return m, textinput.Blink
	case "a":
		r, ok := m.selectedRow()
		if !ok || r.path == "" {
			m.say("select a file first (↑/↓)")
			return m, nil
		}
		if !m.statuses[m.sel].IsGit {
			m.say("target is not a git repo")
			return m, nil
		}
		rel := r.path
		return m, func() tea.Msg {
			staged, err := e.ToggleStage(rel)
			switch {
			case err != nil:
				return flashMsg("stage: " + err.Error())
			case staged:
				return flashMsg("staged " + rel + " — c commits only staged files")
			}
			return flashMsg("unstaged " + rel)
		}
	case "e":
		r, ok := m.selectedRow()
		if !ok || r.path == "" {
			m.say("select a file first (↑/↓)")
			return m, nil
		}
		p := e.TargetPath(r.path)
		if _, err := os.Stat(p); err != nil {
			p = e.SourcePath(r.path)
		}
		return m, openInEditor(p)
	case "d", "enter":
		r, ok := m.selectedRow()
		if !ok || r.path == "" {
			m.say("select a file first (↑/↓)")
			return m, nil
		}
		rel, conflict := r.path, r.conflict
		return m, func() tea.Msg {
			t, l := e.Diff(rel, conflict)
			return diffMsg{t, rel, l}
		}
	case "s", "t", "n", "b", "m":
		r, ok := m.selectedRow()
		if !ok || !r.conflict {
			m.say("select a conflict (!) to resolve")
			return m, nil
		}
		choice, _ := engine.ParseChoice(k.String())
		e.Resolve(r.path, choice)
		m.say("resolving " + r.path + " → " + string(choice))
	}
	return m, nil
}

// openInEditor opens p in $VISUAL/$EDITOR (in this terminal), or else in VS
// Code or the OS default app.
func openInEditor(p string) tea.Cmd {
	ed := strings.TrimSpace(os.Getenv("VISUAL"))
	if ed == "" {
		ed = strings.TrimSpace(os.Getenv("EDITOR"))
	}
	if ed != "" {
		return execEditor(ed, p)
	}
	return func() tea.Msg {
		var c *exec.Cmd
		if code, err := exec.LookPath("code"); err == nil {
			c = exec.Command(code, "-g", p)
		} else {
			switch runtime.GOOS {
			case "darwin":
				c = exec.Command("open", p)
			case "windows":
				c = exec.Command("rundll32", "url.dll,FileProtocolHandler", p)
			default:
				c = exec.Command("xdg-open", p)
			}
		}
		if err := c.Start(); err != nil {
			return flashMsg("open: " + err.Error())
		}
		go func() { _ = c.Wait() }()
		return flashMsg("opened " + filepath.Base(p))
	}
}

func execEditor(ed, p string) tea.Cmd {
	parts := strings.Fields(ed)
	c := exec.Command(parts[0], append(parts[1:], p)...)
	return tea.ExecProcess(c, func(err error) tea.Msg {
		if err != nil {
			return flashMsg("editor: " + err.Error())
		}
		return flashMsg("")
	})
}

func shortName(p string) string { return path.Base(strings.ReplaceAll(p, `\`, "/")) }

// ---------- view ----------

func (m Model) View() string {
	if m.w == 0 {
		return "starting…"
	}
	switch m.mode {
	case modeHelp:
		return m.helpView()
	case modeDiff:
		layout := "unified"
		if m.sideBySide {
			layout = "side by side"
		}
		head := sTitle.Render(" diff ") + " " + sBold.Render(m.title)
		foot := sMuted.Render(fmt.Sprintf(" ↑/↓ PgUp/PgDn scroll · v %s · esc back · %d%%", layout, int(m.vp.ScrollPercent()*100)))
		return head + "\n" + sBoxAct.Width(m.w-2).Render(m.vp.View()) + "\n" + foot
	case modeHistory:
		head := sTitle.Render(" history ") + " " + sBold.Render(m.statuses[m.sel].Name)
		foot := sMuted.Render(" ↑/↓ scroll · u undo newest batch · esc back")
		if m.flash != "" && time.Since(m.flashAt) < 3*time.Second {
			foot = " " + sFlash.Render(m.flash)
		}
		return head + "\n" + sBoxAct.Width(m.w-2).Render(m.vp.View()) + "\n" + foot
	}

	header := m.headerView()
	pairs := m.pairsView()
	footer := m.footerView()
	bodyH := m.h - lipgloss.Height(header) - lipgloss.Height(pairs) - lipgloss.Height(footer)
	if bodyH < 6 {
		bodyH = 6
	}
	leftW := m.w * 45 / 100
	if leftW < 30 {
		leftW = 30
	}
	rightW := m.w - leftW
	left := m.filesView(leftW, bodyH)
	right := m.logView(rightW, bodyH)
	body := lipgloss.JoinHorizontal(lipgloss.Top, left, right)
	return lipgloss.JoinVertical(lipgloss.Left, header, pairs, body, footer)
}

func (m Model) headerView() string {
	left := sTitle.Render("⇄ ferry") + sMuted.Render(" "+m.version)
	right := sMuted.Render(fmt.Sprintf("%d pair(s) · ? help · q quit", len(m.engines)))
	gap := m.w - lipgloss.Width(left) - lipgloss.Width(right) - 1
	if gap < 1 {
		gap = 1
	}
	return left + strings.Repeat(" ", gap) + right
}

func (m Model) pairsView() string {
	var lines []string
	for i, st := range m.statuses {
		icon, style := "●", lipgloss.NewStyle().Foreground(cGreen)
		state := st.State()
		switch {
		case len(st.Conflicts) > 0:
			icon, style = "!", lipgloss.NewStyle().Foreground(cRed).Bold(true)
		case st.PendingBatch > 0:
			icon, style, state = "?", lipgloss.NewStyle().Foreground(cYellow), state+" (y)"
		case st.Paused():
			icon, style = "‖", lipgloss.NewStyle().Foreground(cYellow)
		case st.Pending:
			icon, style = "◌", lipgloss.NewStyle().Foreground(cCyan)
		}
		branch := ""
		if st.IsGit {
			branch = " ⎇ " + orDash(st.Branch)
		}
		last := "never"
		if !st.LastSync.IsZero() {
			last = st.LastSync.Format("15:04:05")
		}
		name := st.Name
		if st.Remote != "" {
			name += sMuted.Render(" → " + st.Remote)
		}
		cursor := "  "
		if i == m.sel {
			cursor = sTitle.Render("▸ ")
			name = sBold.Render(name)
		}
		line := fmt.Sprintf("%s%s %s  %s%s  %s  %s  %s",
			cursor, style.Render(icon), name,
			sMuted.Render(st.Mode+" · "+orDash(st.Watcher)), sMuted.Render(branch),
			fmt.Sprintf("+%d ~%d -%d ↻%d", st.Added, st.Updated, st.Deleted, st.Renamed),
			sMuted.Render("last "+last), style.Render(state))
		lines = append(lines, truncate(line, m.w-4))
	}
	return sBox.Width(m.w - 2).Render(strings.Join(lines, "\n"))
}

func orDash(s string) string {
	if s == "" {
		return "–"
	}
	return s
}

func (m Model) filesView(w, h int) string {
	st := m.statuses[m.sel]
	inner := h - 2
	var lines []string
	head := sBold.Render("Changed this session") + sMuted.Render(fmt.Sprintf("  (%d)", countFiles(m.rows)))
	if m.filter != "" {
		head += sFlash.Render("  /" + m.filter) + sMuted.Render(" esc clears")
	}
	lines = append(lines, head)

	gitLines := 0
	if st.IsGit {
		gitLines = min(len(st.GitStatus), 6) + 2
	}
	listH := inner - 1 - gitLines
	if listH < 3 {
		listH = 3
	}
	if len(m.rows) == 0 {
		if m.filter != "" {
			lines = append(lines, sMuted.Render("  no files match the filter"))
		} else {
			lines = append(lines, sMuted.Render("  nothing yet — edit a file in the source"))
		}
	}
	start := 0
	if m.fileSel >= listH {
		start = m.fileSel - listH + 1
	}
	for i := start; i < len(m.rows) && i < start+listH; i++ {
		r := m.rows[i]
		indent := strings.Repeat("  ", r.depth)
		var line string
		if r.path == "" {
			line = sMuted.Render(indent + r.text)
		} else {
			sym, style := kindStyle(r.kind)
			label := r.text
			if r.conflict {
				label = r.path + "  " + "(s/t/n/b/m to resolve)"
			}
			line = indent + style.Render(sym) + " " + label
			if r.dir != "" {
				line += sMuted.Render(" " + r.dir)
			}
			if i == m.fileSel {
				line = sSel.Render(truncate(indent+sym+" "+label, w-6))
			}
		}
		lines = append(lines, truncate(line, w-4))
	}
	for len(lines) < listH+1 {
		lines = append(lines, "")
	}
	if st.IsGit {
		lines = append(lines, "")
		staged := gitx.StagedCount(st.GitStatus)
		head := fmt.Sprintf("git ⎇ %s · %d uncommitted", orDash(st.Branch), len(st.GitStatus))
		if staged > 0 {
			head += fmt.Sprintf(" · %d staged", staged)
		}
		if len(st.GitStatus) == 0 {
			head = fmt.Sprintf("git ⎇ %s · clean", orDash(st.Branch))
		}
		lines = append(lines, sBold.Render(head)+sMuted.Render("  a stage · c commit · C commit+push"))
		for i, g := range st.GitStatus {
			if i == 6 {
				break
			}
			lines = append(lines, truncate(sMuted.Render("  "+g), w-4))
		}
	}
	if len(lines) > inner {
		lines = lines[:inner]
	}
	return sBoxAct.Width(w - 2).Height(inner).Render(strings.Join(lines, "\n"))
}

func countFiles(rows []row) int {
	n := 0
	for _, r := range rows {
		if r.path != "" {
			n++
		}
	}
	return n
}

func (m Model) logView(w, h int) string {
	inner := h - 2
	title := sBold.Render("Activity")
	if m.logOff > 0 {
		title += sMuted.Render(fmt.Sprintf("  (scrolled ↑%d · End to follow)", m.logOff))
	}
	var all []string
	multi := len(m.engines) > 1
	for _, ev := range m.logs {
		if !matches(m.filter, ev.Path, ev.To, ev.Msg) {
			continue
		}
		sym, style := kindStyle(ev.Kind)
		var b strings.Builder
		b.WriteString(sMuted.Render(ev.Time.Format("15:04:05")) + " ")
		if multi {
			b.WriteString(sMuted.Render("[" + ev.Pair + "] "))
		}
		b.WriteString(style.Render(sym) + " ")
		if ev.Dir != "" {
			b.WriteString(sMuted.Render(ev.Dir) + " ")
		}
		if ev.Path != "" {
			b.WriteString(ev.Path)
			if ev.To != "" {
				b.WriteString(" → " + ev.To)
			}
			if ev.Msg != "" {
				b.WriteString(" " + sMuted.Render(ev.Msg))
			}
		} else {
			b.WriteString(style.Render(ev.Msg))
		}
		if ev.DryRun {
			b.WriteString(sMuted.Render(" (dry-run)"))
		}
		all = append(all, truncate(b.String(), w-4))
	}
	avail := inner - 1
	end := len(all) - m.logOff
	if end < 0 {
		end = 0
	}
	start := end - avail
	if start < 0 {
		start = 0
	}
	lines := append([]string{title}, all[start:end]...)
	return sBox.Width(w - 2).Height(inner).Render(strings.Join(lines, "\n"))
}

func (m Model) footerView() string {
	switch m.mode {
	case modeCommit:
		label := "commit"
		if m.staged {
			label = "commit staged"
		}
		if m.push {
			label += " + push"
		}
		return sTitle.Render(" "+label+": ") + m.input.View() + sMuted.Render("  enter ok · esc cancel")
	case modeSearch:
		return sTitle.Render(" / ") + m.search.View() + sMuted.Render("  enter keep · esc clear")
	}
	if m.flash != "" && time.Since(m.flashAt) < 3*time.Second {
		return " " + sFlash.Render(m.flash)
	}
	keys := []string{"tab pair", "↑↓ file", "/ filter", "d diff", "e edit", "a stage", "c commit", "p pause", "r resync", "H history", "s/t/n/b/m resolve", "? help"}
	return truncate(sMuted.Render(" "+strings.Join(keys, " · ")), m.w)
}

func (m Model) helpView() string {
	help := `
  Navigation
    tab / ]       next pair            shift+tab / [   previous pair
    ↑ ↓ / k j     select file          PgUp PgDn       scroll activity log
    End / G       follow log           q / ctrl+c      quit
    /             filter files and activity (esc clears)

  Sync
    p / space     pause or resume the selected pair
    r             full resync (compare every file by content)
    y             approve a large batch waiting for confirmation
    H             sync history; u (twice) undoes the newest batch

  Files
    d / enter     diff selected file (vs last commit, or source vs target for a conflict)
                  in the diff: v toggles side-by-side
    e             open the file in $EDITOR, VS Code or the default app

  Conflicts (two-way mode, select a ! file)
    s  keep source     t  keep target     n  keep newer     b  keep both
    m  three-way merge (overlapping edits get <<<<<<< markers)

  Git
    a  stage / unstage the selected file
    c  commit (only staged files if anything is staged, else everything)
    C  commit and push

  Look
    T  cycle theme: auto → dark → light → mono

  Legend:  + added  ~ updated  - deleted  ↻ renamed  ◇ kept (deleted on the other side)
           ! conflict  → to target  ← to source  ⇄ merged

  press any key to go back`
	return sTitle.Render(" ferry help") + sMuted.Render("  theme: "+themeName) + "\n" + help
}

func (m Model) renderHistory() string {
	if len(m.batches) == 0 {
		return sMuted.Render("no sync batches recorded yet")
	}
	var b strings.Builder
	for i, bt := range m.batches {
		if i == 100 {
			b.WriteString(sMuted.Render(fmt.Sprintf("… %d older batches (see: ferry history)", len(m.batches)-100)))
			break
		}
		a, u, d, r := bt.Counts()
		line := fmt.Sprintf("%s  +%d ~%d -%d ↻%d", bt.Time.Format("2006-01-02 15:04:05"), a, u, d, r)
		switch {
		case bt.Undone:
			line = sMuted.Render(line + "  (undone)")
		case i == 0 || allUndone(m.batches[:i]):
			line = sBold.Render(line) + sFlash.Render("  ← u undoes this")
		}
		b.WriteString(line + "\n")
		for j, en := range bt.Entries {
			if j == 6 {
				b.WriteString(sMuted.Render(fmt.Sprintf("      … %d more\n", len(bt.Entries)-6)))
				break
			}
			sym, style := opStyle(en.Op)
			target := en.Path
			if en.To != "" {
				target += " → " + en.To
			}
			b.WriteString("    " + style.Render(sym) + " " + target + sMuted.Render(" ("+en.Side+")") + "\n")
		}
	}
	return b.String()
}

func allUndone(bs []engine.Batch) bool {
	for _, b := range bs {
		if !b.Undone {
			return false
		}
	}
	return true
}

func opStyle(op string) (string, lipgloss.Style) {
	switch op {
	case "add":
		return kindStyle(engine.KAdd)
	case "delete":
		return kindStyle(engine.KDelete)
	case "rename":
		return kindStyle(engine.KRename)
	}
	return kindStyle(engine.KUpdate)
}

// truncate cuts a (possibly styled) string to width cells.
func truncate(s string, w int) string {
	if w <= 0 {
		return ""
	}
	if lipgloss.Width(s) <= w {
		return s
	}
	return lipgloss.NewStyle().MaxWidth(w).Render(s)
}
