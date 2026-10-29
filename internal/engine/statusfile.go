package engine

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"time"

	"github.com/anupam42/Ferry/internal/gitx"
)

// PairStatus is what a running ferry process publishes about each pair, so
// "ferry status", editors and scripts can see it from outside the process.
type PairStatus struct {
	ID           string    `json:"id"`
	Name         string    `json:"name"`
	Source       string    `json:"source"`
	Target       string    `json:"target"`
	Remote       string    `json:"remote,omitempty"`
	Mode         string    `json:"mode"`
	PID          int       `json:"pid"`
	Running      bool      `json:"running"`
	State        string    `json:"state"`
	Paused       bool      `json:"paused"`
	GuardReason  string    `json:"guard_reason,omitempty"`
	Conflicts    []string  `json:"conflicts"`
	PendingBatch int       `json:"pending_batch,omitempty"`
	Watcher      string    `json:"watcher,omitempty"`
	IsGit        bool      `json:"is_git"`
	Branch       string    `json:"branch,omitempty"`
	Uncommitted  int       `json:"uncommitted"`
	Staged       int       `json:"staged"`
	LastSync     time.Time `json:"last_sync"`
	Added        int       `json:"added"`
	Updated      int       `json:"updated"`
	Deleted      int       `json:"deleted"`
	Renamed      int       `json:"renamed"`
	Skipped      int       `json:"skipped"`
	Failed       int       `json:"failed"`
	UpdatedAt    time.Time `json:"updated_at"`
}

func statusPath(dataDir, id string) string { return filepath.Join(dataDir, id, "status.json") }

func (e *Engine) writeStatus(running bool) {
	if e.cfg.DryRun {
		return
	}
	st := e.Status()
	ps := PairStatus{
		ID: e.id, Name: st.Name, Source: st.Source, Target: st.Target, Remote: e.cfg.Remote, Mode: st.Mode,
		PID: os.Getpid(), Running: running, State: st.State(), Paused: st.Paused(), GuardReason: st.GuardReason,
		Conflicts: st.Conflicts, PendingBatch: st.PendingBatch, Watcher: st.Watcher, IsGit: st.IsGit,
		Branch: st.Branch, Uncommitted: len(st.GitStatus), Staged: gitx.StagedCount(st.GitStatus),
		LastSync: st.LastSync, Added: st.Added, Updated: st.Updated, Deleted: st.Deleted,
		Renamed: st.Renamed, Skipped: st.Skipped, Failed: st.Failed, UpdatedAt: time.Now(),
	}
	if !running {
		ps.State = "stopped"
	}
	data, err := json.MarshalIndent(ps, "", "  ")
	if err != nil {
		return
	}
	p := statusPath(e.dataDir, e.id)
	_ = os.MkdirAll(filepath.Dir(p), 0o755)
	tmp := p + ".tmp"
	if os.WriteFile(tmp, data, 0o644) == nil {
		_ = replaceFile(tmp, p)
	}
}

// maybeWriteStatus publishes the status at most once a second while running.
func (e *Engine) maybeWriteStatus() {
	if !e.running || time.Since(e.lastStatus) < time.Second {
		return
	}
	e.lastStatus = time.Now()
	e.writeStatus(true)
}

// ReadStatuses returns the last published status of every pair that has run.
func ReadStatuses(dataDir string) []PairStatus {
	entries, _ := os.ReadDir(dataDir)
	var out []PairStatus
	for _, en := range entries {
		if !en.IsDir() {
			continue
		}
		data, err := os.ReadFile(statusPath(dataDir, en.Name()))
		if err != nil {
			continue
		}
		var ps PairStatus
		if json.Unmarshal(data, &ps) != nil {
			continue
		}
		if ps.Running && !processAlive(ps.PID) {
			ps.Running = false
			ps.State = "stopped (process exited)"
		}
		out = append(out, ps)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}
