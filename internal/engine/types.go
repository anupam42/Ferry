package engine

import (
	"strconv"
	"strings"
	"time"
)

// Kind classifies an Event.
type Kind string

const (
	KInfo     Kind = "info"
	KAdd      Kind = "add"
	KUpdate   Kind = "update"
	KDelete   Kind = "delete"
	KRename   Kind = "rename"
	KConflict Kind = "conflict"
	KResolved Kind = "resolved"
	KSkip     Kind = "skip"
	KWarn     Kind = "warn"
	KError    Kind = "error"
	KSynced   Kind = "synced"
	KPaused   Kind = "paused"
	KResumed  Kind = "resumed"
	KGit      Kind = "git"
	KCommit   Kind = "commit"
	KKept     Kind = "kept" // deleted on one side, intentionally kept on the other
)

// Event is what the engine reports to the UI / log / JSON output.
type Event struct {
	Time   time.Time `json:"time"`
	Pair   string    `json:"pair"`
	Kind   Kind      `json:"kind"`
	Path   string    `json:"path,omitempty"`
	To     string    `json:"to,omitempty"`        // rename destination / conflict copy
	Dir    string    `json:"direction,omitempty"` // "→" source→target, "←" target→source
	Msg    string    `json:"message,omitempty"`
	Lines  []string  `json:"lines,omitempty"` // git status lines
	DryRun bool      `json:"dry_run,omitempty"`
	Held   bool      `json:"held,omitempty"` // conflict is waiting for a decision
}

// ChangedFile is a file touched this session (for the dashboard tree).
type ChangedFile struct {
	Path string    `json:"path"`
	Kind Kind      `json:"kind"`
	Dir  string    `json:"direction,omitempty"`
	Time time.Time `json:"time"`
}

// Status is a point-in-time snapshot for the dashboard.
type Status struct {
	Name    string `json:"name"`
	Source  string `json:"source"`
	Target  string `json:"target"`
	Remote  string `json:"remote,omitempty"`
	Mode    string `json:"mode"`
	Watcher string `json:"watcher"`

	UserPaused   bool     `json:"user_paused"`
	GuardReason  string   `json:"guard_reason,omitempty"` // non-empty while auto-paused (merge, rebase, behind upstream, branch error, sync window)
	Conflicts    []string `json:"conflicts"`
	PendingBatch int      `json:"pending_batch"` // >0 while a large batch waits for approval
	Pending      bool     `json:"pending"`

	LastSync time.Time `json:"last_sync"`
	Added    int       `json:"added"`
	Updated  int       `json:"updated"`
	Deleted  int       `json:"deleted"`
	Renamed  int       `json:"renamed"`
	Skipped  int       `json:"skipped"`
	Failed   int       `json:"failed"`

	IsGit     bool          `json:"is_git"`
	Branch    string        `json:"branch,omitempty"`
	GitStatus []string      `json:"git_status"`
	Changed   []ChangedFile `json:"changed"`
}

// Paused reports whether syncing is currently held for any reason.
func (s Status) Paused() bool { return s.UserPaused || s.GuardReason != "" }

// State is a one-line description such as "watching" or "2 conflict(s)".
func (s Status) State() string {
	switch {
	case len(s.Conflicts) > 0:
		return plural(len(s.Conflicts), "conflict")
	case s.PendingBatch > 0:
		return plural(s.PendingBatch, "change") + " awaiting approval"
	case s.UserPaused:
		return "paused"
	case s.GuardReason != "":
		return "paused: " + s.GuardReason
	case s.Pending:
		return "settling…"
	}
	return "watching"
}

func plural(n int, word string) string {
	if n == 1 {
		return "1 " + word
	}
	return strconv.Itoa(n) + " " + word + "s"
}

// Choice resolves a conflict.
type Choice string

const (
	UseSource Choice = "source"
	UseTarget Choice = "target"
	UseNewer  Choice = "newer"
	KeepBoth  Choice = "keep-both"
	Merge     Choice = "merge" // three-way merge; overlapping edits get conflict markers
)

// ParseChoice accepts the long and short spellings used on the command line,
// in the dashboard and in the HTTP API.
func ParseChoice(s string) (Choice, bool) {
	c, ok := map[string]Choice{
		"source": UseSource, "s": UseSource,
		"target": UseTarget, "t": UseTarget,
		"newer": UseNewer, "n": UseNewer,
		"both": KeepBoth, "keep-both": KeepBoth, "b": KeepBoth,
		"merge": Merge, "m": Merge,
	}[strings.ToLower(strings.TrimSpace(s))]
	return c, ok
}
