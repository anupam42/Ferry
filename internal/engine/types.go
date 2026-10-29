package engine

import "time"

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
	Path string
	Kind Kind
	Dir  string
	Time time.Time
}

// Status is a point-in-time snapshot for the dashboard.
type Status struct {
	Name, Source, Target, Mode, Watcher string

	UserPaused   bool
	GuardReason  string // non-empty while auto-paused (merge, rebase, behind upstream, branch error)
	Conflicts    []string
	PendingBatch int // >0 while a large batch waits for approval
	Pending      bool

	LastSync                                          time.Time
	Added, Updated, Deleted, Renamed, Skipped, Failed int

	IsGit     bool
	Branch    string
	GitStatus []string
	Changed   []ChangedFile
}

// Paused reports whether syncing is currently held for any reason.
func (s Status) Paused() bool { return s.UserPaused || s.GuardReason != "" }

// Choice resolves a conflict.
type Choice string

const (
	UseSource Choice = "source"
	UseTarget Choice = "target"
	UseNewer  Choice = "newer"
	KeepBoth  Choice = "keep-both"
)
