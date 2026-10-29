// Package tui is the interactive dashboard.
package tui

import (
	"fmt"
	"path"
	"sort"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/textinput"
	"github.com/charmbracelet/bubbles/viewport"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"

	"github.com/anupam42/Ferry/internal/difftext"
	"github.com/anupam42/Ferry/internal/engine"
)

// EventMsg delivers an engine event to the dashboard.
type EventMsg engine.Event

type tickMsg time.Time

type diffMsg struct {
	title string
	lines []difftext.Line
}

type mode int

const (
	modeMain mode = iota
	modeDiff
	modeCommit
	modeHelp
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
	flash   string
	flashAt time.Time
}

// New builds the dashboard for the given engines.
func New(engines []*engine.Engine, version string) Model {
	ti := textinput.New()
	ti.Placeholder = "commit message"
	ti.CharLimit = 200
	m := Model{engines: engines, version: version, input: ti, vp: viewport.New(80, 20)}
	m.refresh()
	return m
}

func tick() tea.Cmd {
	return tea.Tick(500*time.Millisecond, func(t time.Time) tea.Msg { return tickMsg(t) })
}

func (m Model) Init() tea.Cmd { return tick() }

// ---------- styles ----------

var (
	cAccent = lipgloss.AdaptiveColor{Light: "#5A4FCF", Dark: "#9D8CFF"}
	cMuted  = lipgloss.AdaptiveColor{Light: "#777777", Dark: "#8A8A8A"}
	cGreen  = lipgloss.AdaptiveColor{Light: "#18794E", Dark: "#4ADE80"}
	cYellow = lipgloss.AdaptiveColor{Light: "#A15C00", Dark: "#FACC15"}
	cRed    = lipgloss.AdaptiveColor{Light: "#C62828", Dark: "#F87171"}
	cCyan   = lipgloss.AdaptiveColor{Light: "#00708A", Dark: "#67E8F9"}
	cPurple = lipgloss.AdaptiveColor{Light: "#8E24AA", Dark: "#E879F9"}

	sTitle  = lipgloss.NewStyle().Bold(true).Foreground(cAccent)
	sMuted  = lipgloss.NewStyle().Foreground(cMuted)
	sBold   = lipgloss.NewStyle().Bold(true)
	sSel    = lipgloss.NewStyle().Bold(true).Reverse(true)
	sBox    = lipgloss.NewStyle().Border(lipgloss.RoundedBorder()).BorderForeground(cMuted).Padding(0, 1)
	sBoxAct = sBox.BorderForeground(cAccent)
	sFlash  = lipgloss.NewStyle().Foreground(cYellow).Bold(true)
)

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
	m.rows = buildRows(m.statuses[m.sel])
	if m.fileSel >= len(m.rows) {
		m.fileSel = len(m.rows) - 1
	}
	if m.fileSel < 0 {
		m.fileSel = 0
	}
}

func buildRows(st engine.Status) []row {
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
		paths = append(paths, p)
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
		return m, nil
	case tickMsg:
		m.refresh()
		return m, tick()
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
		m.title = msg.title
		m.vp.SetContent(renderDiff(msg.lines))
		m.vp.GotoTop()
		m.mode = modeDiff
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
	switch m.mode {
	case modeHelp:
		m.mode = modeMain
		return m, nil
	case modeDiff:
		switch k.String() {
		case "esc", "q", "d", "enter":
			m.mode = modeMain
			return m, nil
		}
		var cmd tea.Cmd
		m.vp, cmd = m.vp.Update(k)
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
			m.engines[m.sel].Commit(msg, m.push)
			m.mode = modeMain
			m.input.Blur()
			m.say("committing…")
			return m, nil
		}
		var cmd tea.Cmd
		m.input, cmd = m.input.Update(k)
		return m, cmd
	}

	e := m.engines[m.sel]
	switch k.String() {
	case "q":
		return m, tea.Quit
	case "?", "h":
		m.mode = modeHelp
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
	case "c", "C":
		if !m.statuses[m.sel].IsGit {
			m.say("target is not a git repo")
			return m, nil
		}
		m.push = k.String() == "C"
		m.mode = modeCommit
		m.input.SetValue("")
		m.input.Placeholder = fmt.Sprintf("sync: %d file(s) from %s", len(m.statuses[m.sel].GitStatus), shortName(m.statuses[m.sel].Source))
		m.input.Focus()
		return m, textinput.Blink
	case "d", "enter":
		r, ok := m.selectedRow()
		if !ok || r.path == "" {
			m.say("select a file first (↑/↓)")
			return m, nil
		}
		rel, conflict := r.path, r.conflict
		return m, func() tea.Msg {
			t, l := e.Diff(rel, conflict)
			return diffMsg{t, l}
		}
	case "s", "t", "n", "b":
		r, ok := m.selectedRow()
		if !ok || !r.conflict {
			m.say("select a conflict (!) to resolve")
			return m, nil
		}
		choice := map[string]engine.Choice{"s": engine.UseSource, "t": engine.UseTarget, "n": engine.UseNewer, "b": engine.KeepBoth}[k.String()]
		e.Resolve(r.path, choice)
		m.say("resolving " + r.path + " → " + string(choice))
	}
	return m, nil
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
		head := sTitle.Render(" diff ") + " " + sBold.Render(m.title)
		foot := sMuted.Render(fmt.Sprintf(" ↑/↓ PgUp/PgDn scroll · esc back · %d%%", int(m.vp.ScrollPercent()*100)))
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
		state := "watching"
		switch {
		case len(st.Conflicts) > 0:
			icon, style, state = "!", lipgloss.NewStyle().Foreground(cRed).Bold(true), fmt.Sprintf("%d conflict(s)", len(st.Conflicts))
		case st.PendingBatch > 0:
			icon, style, state = "?", lipgloss.NewStyle().Foreground(cYellow), fmt.Sprintf("%d changes awaiting approval (y)", st.PendingBatch)
		case st.UserPaused:
			icon, style, state = "‖", lipgloss.NewStyle().Foreground(cYellow), "paused"
		case st.GuardReason != "":
			icon, style, state = "‖", lipgloss.NewStyle().Foreground(cYellow), "paused: "+st.GuardReason
		case st.Pending:
			icon, style, state = "◌", lipgloss.NewStyle().Foreground(cCyan), "settling…"
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
	lines = append(lines, sBold.Render("Changed this session")+sMuted.Render(fmt.Sprintf("  (%d)", countFiles(m.rows))))

	gitLines := 0
	if st.IsGit {
		gitLines = min(len(st.GitStatus), 6) + 2
	}
	listH := inner - 1 - gitLines
	if listH < 3 {
		listH = 3
	}
	if len(m.rows) == 0 {
		lines = append(lines, sMuted.Render("  nothing yet — edit a file in the source"))
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
				label = r.path + "  " + "(s/t/n/b to resolve)"
			}
			line = indent + style.Render(sym) + " " + label
			if r.dir != "" {
				line += sMuted.Render(" " + r.dir)
			}
			if i == m.fileSel {
				line = sSel.Render(truncate(stripLen(indent+sym+" "+label), w-6))
			}
		}
		lines = append(lines, truncate(line, w-4))
	}
	for len(lines) < listH+1 {
		lines = append(lines, "")
	}
	if st.IsGit {
		lines = append(lines, "")
		head := fmt.Sprintf("git ⎇ %s · %d uncommitted", orDash(st.Branch), len(st.GitStatus))
		if len(st.GitStatus) == 0 {
			head = fmt.Sprintf("git ⎇ %s · clean", orDash(st.Branch))
		}
		lines = append(lines, sBold.Render(head)+sMuted.Render("  c commit · C commit+push"))
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

func stripLen(s string) string { return s }

func (m Model) logView(w, h int) string {
	inner := h - 2
	title := sBold.Render("Activity")
	if m.logOff > 0 {
		title += sMuted.Render(fmt.Sprintf("  (scrolled ↑%d · End to follow)", m.logOff))
	}
	var all []string
	multi := len(m.engines) > 1
	for _, ev := range m.logs {
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
	if m.mode == modeCommit {
		label := "commit"
		if m.push {
			label = "commit + push"
		}
		return sTitle.Render(" "+label+": ") + m.input.View() + sMuted.Render("  enter ok · esc cancel")
	}
	if m.flash != "" && time.Since(m.flashAt) < 3*time.Second {
		return " " + sFlash.Render(m.flash)
	}
	keys := []string{"tab pair", "↑↓ file", "d diff", "p pause", "r resync", "c commit", "y approve", "s/t/n/b resolve", "PgUp/PgDn log", "? help"}
	return truncate(sMuted.Render(" "+strings.Join(keys, " · ")), m.w)
}

func (m Model) helpView() string {
	help := `
  Navigation
    tab / ]       next pair            shift+tab / [   previous pair
    ↑ ↓ / k j     select file          PgUp PgDn       scroll activity log
    End / G       follow log           q / ctrl+c      quit

  Sync
    p / space     pause or resume the selected pair
    r             full resync (compare every file by content)
    y             approve a large batch waiting for confirmation

  Files
    d / enter     diff selected file (vs last commit, or source vs target for a conflict)

  Conflicts (two-way mode, select a ! file)
    s  keep source     t  keep target     n  keep newer     b  keep both

  Git
    c  commit everything in the target     C  commit and push

  Legend:  + added  ~ updated  - deleted  ↻ renamed  ◇ kept (deleted on the other side)
           ! conflict  → to target  ← to source

  press any key to go back`
	return sTitle.Render(" ferry help") + "\n" + help
}

func renderDiff(lines []difftext.Line) string {
	if len(lines) == 0 {
		return sMuted.Render("no differences")
	}
	add := lipgloss.NewStyle().Foreground(cGreen)
	del := lipgloss.NewStyle().Foreground(cRed)
	hunk := lipgloss.NewStyle().Foreground(cCyan)
	var b strings.Builder
	for _, l := range lines {
		switch l.Op {
		case '+':
			b.WriteString(add.Render("+" + l.Text))
		case '-':
			b.WriteString(del.Render("-" + l.Text))
		case '@':
			b.WriteString(hunk.Render(l.Text))
		default:
			b.WriteString(" " + l.Text)
		}
		b.WriteByte('\n')
	}
	return b.String()
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
