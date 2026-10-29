// Package ui renders engine events as plain colored text or NDJSON.
package ui

import (
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"sync"

	"github.com/anupam42/Ferry/internal/engine"
)

// Printer writes events to a terminal/log file.
type Printer struct {
	mu       sync.Mutex
	Out      io.Writer
	Log      io.Writer // optional plain-text copy (no color)
	Color    bool
	Quiet    bool
	JSON     bool
	ShowGit  bool
	ShowPair bool
}

var styles = map[engine.Kind]struct{ tag, code string }{
	engine.KAdd:      {"ADD", "32"},
	engine.KUpdate:   {"UPDATE", "33"},
	engine.KDelete:   {"DELETE", "31"},
	engine.KRename:   {"RENAME", "35"},
	engine.KConflict: {"CONFLICT", "1;31"},
	engine.KResolved: {"RESOLVED", "32"},
	engine.KSkip:     {"SKIP", "90"},
	engine.KWarn:     {"WARN", "33"},
	engine.KError:    {"ERROR", "1;31"},
	engine.KSynced:   {"SYNCED", "36"},
	engine.KPaused:   {"PAUSED", "1;33"},
	engine.KResumed:  {"RESUMED", "32"},
	engine.KCommit:   {"COMMIT", "1;32"},
	engine.KInfo:     {"INFO", "34"},
	engine.KGit:      {"GIT", "36"},
	engine.KKept:     {"KEPT", "34"},
}

func paint(on bool, code, s string) string {
	if !on || code == "" {
		return s
	}
	return "\033[" + code + "m" + s + "\033[0m"
}

// Handle prints one event.
func (p *Printer) Handle(ev engine.Event) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.JSON {
		_ = json.NewEncoder(p.Out).Encode(ev)
		if p.Log != nil {
			_ = json.NewEncoder(p.Log).Encode(ev)
		}
		return
	}
	if p.Quiet {
		switch ev.Kind {
		case engine.KAdd, engine.KUpdate, engine.KDelete, engine.KRename, engine.KSkip, engine.KInfo:
			return
		}
	}
	if ev.Kind == engine.KGit && !p.ShowGit {
		return
	}
	fmt.Fprint(p.Out, p.format(ev, p.Color))
	if p.Log != nil {
		fmt.Fprint(p.Log, p.format(ev, false))
	}
}

func (p *Printer) format(ev engine.Event, color bool) string {
	st := styles[ev.Kind]
	var b strings.Builder
	b.WriteString(paint(color, "90", ev.Time.Format("15:04:05")) + " ")
	if p.ShowPair {
		b.WriteString(paint(color, "1", "["+ev.Pair+"]") + " ")
	}
	b.WriteString(paint(color, st.code, fmt.Sprintf("%-8s", st.tag)) + " ")
	if ev.Dir != "" {
		b.WriteString(ev.Dir + " ")
	}
	if ev.Kind == engine.KGit {
		if len(ev.Lines) == 0 {
			b.WriteString(paint(color, "90", "working tree clean"))
		} else {
			fmt.Fprintf(&b, "%d change(s) on %s", len(ev.Lines), orDash(ev.Msg))
			for i, l := range ev.Lines {
				if i == 15 {
					fmt.Fprintf(&b, "\n           … %d more", len(ev.Lines)-15)
					break
				}
				b.WriteString("\n           " + gitLine(color, l))
			}
		}
		return b.String() + "\n"
	}
	if ev.Path != "" {
		b.WriteString(ev.Path)
		if ev.To != "" {
			b.WriteString(" → " + ev.To)
		}
		if ev.Msg != "" {
			b.WriteString("  ")
		}
	}
	if ev.Msg != "" {
		if ev.Path != "" {
			b.WriteString(paint(color, "90", ev.Msg))
		} else {
			b.WriteString(ev.Msg)
		}
	}
	if ev.DryRun {
		b.WriteString(paint(color, "90", " (dry-run)"))
	}
	return b.String() + "\n"
}

func gitLine(color bool, l string) string {
	if len(l) < 2 {
		return l
	}
	code := "33"
	switch {
	case strings.HasPrefix(l, "??"):
		code = "32"
	case strings.Contains(l[:2], "D"):
		code = "31"
	case strings.Contains(l[:2], "R"):
		code = "35"
	}
	return paint(color, code, l)
}

func orDash(s string) string {
	if s == "" {
		return "(detached)"
	}
	return s
}
