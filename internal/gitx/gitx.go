// Package gitx wraps the git CLI for the few operations ferry needs.
package gitx

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
)

// Available reports whether git is on PATH.
func Available() bool {
	_, err := exec.LookPath("git")
	return err == nil
}

func run(dir string, args ...string) (string, error) {
	cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0", "LC_ALL=C")
	var out, errb bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &errb
	err := cmd.Run()
	if err != nil {
		msg := strings.TrimSpace(errb.String())
		if msg == "" {
			msg = err.Error()
		}
		return out.String(), errors.New(msg)
	}
	return out.String(), nil
}

// IsRepo reports whether dir is inside a git work tree.
func IsRepo(dir string) bool {
	if !Available() {
		return false
	}
	out, err := run(dir, "rev-parse", "--is-inside-work-tree")
	return err == nil && strings.TrimSpace(out) == "true"
}

// Status returns `git status --porcelain` lines limited to dir.
func Status(dir string) ([]string, error) {
	out, err := run(dir, "status", "--porcelain=v1", "--untracked-files=all", "--", ".")
	if err != nil {
		return nil, err
	}
	var lines []string
	for _, l := range strings.Split(strings.TrimRight(out, "\n"), "\n") {
		if l != "" {
			lines = append(lines, l)
		}
	}
	return lines, nil
}

// CurrentBranch returns the checked-out branch ("" if detached).
func CurrentBranch(dir string) string {
	out, err := run(dir, "symbolic-ref", "--quiet", "--short", "HEAD")
	if err != nil {
		return ""
	}
	return strings.TrimSpace(out)
}

// EnsureBranch switches to branch, creating it from HEAD if it doesn't exist.
// Returns true if it created the branch.
func EnsureBranch(dir, branch string) (bool, error) {
	if CurrentBranch(dir) == branch {
		return false, nil
	}
	if _, err := run(dir, "rev-parse", "--verify", "--quiet", "refs/heads/"+branch); err == nil {
		_, err := run(dir, "switch", branch)
		return false, err
	}
	// remote branch with the same name?
	if _, err := run(dir, "rev-parse", "--verify", "--quiet", "refs/remotes/origin/"+branch); err == nil {
		_, err := run(dir, "switch", "--track", "origin/"+branch)
		return false, err
	}
	_, err := run(dir, "switch", "-c", branch)
	return err == nil, err
}

// InProgress returns a description of an unfinished git operation, or "".
func InProgress(dir string) string {
	checks := []struct{ path, what string }{
		{"rebase-merge", "rebase"},
		{"rebase-apply", "rebase/am"},
		{"MERGE_HEAD", "merge"},
		{"CHERRY_PICK_HEAD", "cherry-pick"},
		{"REVERT_HEAD", "revert"},
		{"BISECT_LOG", "bisect"},
	}
	for _, c := range checks {
		out, err := run(dir, "rev-parse", "--git-path", c.path)
		if err != nil {
			return ""
		}
		p := strings.TrimSpace(out)
		if !filepath.IsAbs(p) {
			p = filepath.Join(dir, p)
		}
		if _, err := os.Stat(p); err == nil {
			return c.what + " in progress"
		}
	}
	if _, err := os.Stat(filepath.Join(gitDir(dir), "index.lock")); err == nil {
		return "index.lock present (another git command running)"
	}
	return ""
}

func gitDir(dir string) string {
	out, err := run(dir, "rev-parse", "--absolute-git-dir")
	if err != nil {
		return filepath.Join(dir, ".git")
	}
	return strings.TrimSpace(out)
}

// Fetch runs a quiet fetch of the current upstream's remote.
func Fetch(dir string) error {
	_, err := run(dir, "fetch", "--quiet", "--no-tags")
	return err
}

// Behind returns how many commits HEAD is behind its upstream (0 if none configured).
func Behind(dir string) int {
	out, err := run(dir, "rev-list", "--count", "HEAD..@{upstream}")
	if err != nil {
		return 0
	}
	n, _ := strconv.Atoi(strings.TrimSpace(out))
	return n
}

// CommitAll stages everything under dir and commits. Returns the short hash,
// or "" when there was nothing to commit.
func CommitAll(dir, msg string) (string, error) {
	if _, err := run(dir, "add", "-A", "--", "."); err != nil {
		return "", err
	}
	if _, err := run(dir, "diff", "--cached", "--quiet"); err == nil {
		return "", nil // nothing staged
	}
	if _, err := run(dir, "commit", "-q", "-m", msg); err != nil {
		return "", err
	}
	out, _ := run(dir, "rev-parse", "--short", "HEAD")
	return strings.TrimSpace(out), nil
}

// Push pushes the current branch, setting upstream if needed.
func Push(dir string) error {
	if _, err := run(dir, "push", "--quiet"); err != nil {
		b := CurrentBranch(dir)
		if b == "" {
			return err
		}
		if _, err2 := run(dir, "push", "--quiet", "-u", "origin", b); err2 != nil {
			return fmt.Errorf("%v; %v", err, err2)
		}
	}
	return nil
}

// ShowHead returns the committed content of rel (relative to dir) at HEAD.
// ok is false if the file isn't in HEAD.
func ShowHead(dir, rel string) (content []byte, ok bool) {
	out, err := run(dir, "show", "HEAD:./"+filepath.ToSlash(rel))
	if err != nil {
		return nil, false
	}
	return []byte(out), true
}
