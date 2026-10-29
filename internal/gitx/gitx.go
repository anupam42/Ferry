// Package gitx wraps the git CLI for the few operations ferry needs.
// A dir may also be an ssh target (see package remote); git then runs on the
// remote host over ssh.
package gitx

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/anupam42/Ferry/internal/remote"
)

// Available reports whether git is on PATH.
func Available() bool {
	_, err := exec.LookPath("git")
	return err == nil
}

// Version returns "git version x.y.z", or "".
func Version() string {
	out, err := exec.Command("git", "--version").Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

func command(dir string, args ...string) *exec.Cmd {
	if remote.IsSpec(dir) {
		if sp, err := remote.Parse(dir); err == nil {
			q := make([]string, len(args))
			for i, a := range args {
				q[i] = remote.Quote(a)
			}
			return sp.Command(context.Background(), "GIT_TERMINAL_PROMPT=0 LC_ALL=C git -C "+sp.Dir()+" "+strings.Join(q, " "))
		}
	}
	cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0", "LC_ALL=C")
	return cmd
}

func run(dir string, args ...string) (string, error) {
	cmd := command(dir, args...)
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
	if !remote.IsSpec(dir) && !Available() {
		return false
	}
	out, err := run(dir, "rev-parse", "--is-inside-work-tree")
	return err == nil && strings.TrimSpace(out) == "true"
}

// ConfigGet returns a git config value as seen from dir ("" if unset).
func ConfigGet(dir, key string) string {
	out, err := run(dir, "config", "--get", key)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(out)
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

// StagedCount counts status lines with something in the index.
func StagedCount(lines []string) int {
	n := 0
	for _, l := range lines {
		if len(l) > 1 && l[0] != ' ' && l[0] != '?' {
			n++
		}
	}
	return n
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
// It is not checked for remote targets.
func InProgress(dir string) string {
	if remote.IsSpec(dir) {
		return ""
	}
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

// PullRebase pulls the upstream with --rebase --autostash. A failed rebase is
// aborted so the work tree is left as it was.
func PullRebase(dir string) error {
	if _, err := run(dir, "pull", "--rebase", "--autostash", "--quiet"); err != nil {
		_, _ = run(dir, "rebase", "--abort")
		return err
	}
	return nil
}

// CommitOptions tweak commits made by ferry.
type CommitOptions struct {
	Author string // "Name <email>"
	Sign   bool   // -S
}

// CommitAll stages everything under dir and commits. Returns the short hash,
// or "" when there was nothing to commit.
func CommitAll(dir, msg string, o CommitOptions) (string, error) {
	if _, err := run(dir, "add", "-A", "--", "."); err != nil {
		return "", err
	}
	return CommitStaged(dir, msg, o)
}

// CommitStaged commits whatever is already in the index.
func CommitStaged(dir, msg string, o CommitOptions) (string, error) {
	if _, err := run(dir, "diff", "--cached", "--quiet"); err == nil {
		return "", nil // nothing staged
	}
	args := []string{"commit", "-q"}
	if o.Sign {
		args = append(args, "-S")
	}
	if o.Author != "" {
		args = append(args, "--author="+o.Author)
	}
	if _, err := run(dir, append(args, "-m", msg)...); err != nil {
		return "", err
	}
	out, _ := run(dir, "rev-parse", "--short", "HEAD")
	return strings.TrimSpace(out), nil
}

// IsStaged reports whether rel has staged changes.
func IsStaged(dir, rel string) bool {
	_, err := run(dir, "diff", "--cached", "--quiet", "--", filepath.ToSlash(rel))
	return err != nil
}

// Stage adds rel (including a deletion) to the index.
func Stage(dir, rel string) error {
	_, err := run(dir, "add", "-A", "--", filepath.ToSlash(rel))
	return err
}

// Unstage removes rel from the index, keeping the working copy.
func Unstage(dir, rel string) error {
	if _, err := run(dir, "reset", "-q", "HEAD", "--", filepath.ToSlash(rel)); err != nil {
		// no commits yet: there is no HEAD to reset to
		_, err2 := run(dir, "rm", "--cached", "-q", "-r", "--", filepath.ToSlash(rel))
		if err2 != nil {
			return err
		}
	}
	return nil
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

// LFSAvailable reports whether git-lfs is installed.
func LFSAvailable(dir string) bool {
	_, err := run(dir, "lfs", "version")
	return err == nil
}

// LFSTrack adds a pattern to .gitattributes via git lfs track.
func LFSTrack(dir, pattern string) error {
	_, err := run(dir, "lfs", "track", pattern)
	return err
}

// EnsurePR opens a pull request for the current branch with the gh CLI,
// unless one is already open. It returns the PR URL.
func EnsurePR(dir, base string) (url string, created bool, err error) {
	if remote.IsSpec(dir) {
		return "", false, errors.New("pull requests need a local target")
	}
	if _, err := exec.LookPath("gh"); err != nil {
		return "", false, errors.New("the gh CLI is not installed (https://cli.github.com)")
	}
	gh := func(args ...string) (string, error) {
		cmd := exec.Command("gh", args...)
		cmd.Dir = dir
		cmd.Env = append(os.Environ(), "GH_PROMPT_DISABLED=1")
		out, err := cmd.CombinedOutput()
		return strings.TrimSpace(string(out)), err
	}
	if out, err := gh("pr", "view", "--json", "url,state", "-q", `select(.state == "OPEN") | .url`); err == nil && out != "" {
		return out, false, nil
	}
	args := []string{"pr", "create", "--fill"}
	if base != "" {
		args = append(args, "--base", base)
	}
	out, err := gh(args...)
	if err != nil {
		return "", false, errors.New(lastLine(out))
	}
	return lastLine(out), true, nil
}

func lastLine(s string) string {
	s = strings.TrimSpace(s)
	if i := strings.LastIndexByte(s, '\n'); i >= 0 {
		return s[i+1:]
	}
	return s
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
