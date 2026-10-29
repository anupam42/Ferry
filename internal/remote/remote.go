// Package remote runs shell commands on ssh targets, written either as
// "user@host:path" or "ssh://[user@]host[:port]/path". It shells out to the
// system ssh client, so keys, agents and ~/.ssh/config all work as usual.
package remote

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"os/exec"
	"regexp"
	"strings"
)

var scpLike = regexp.MustCompile(`^([A-Za-z0-9._-]+@[A-Za-z0-9._-]+):(.*)$`)

// IsSpec reports whether s names an ssh target rather than a local folder.
// Plain "host:path" is not accepted, so Windows drive letters never match.
func IsSpec(s string) bool {
	return strings.HasPrefix(s, "ssh://") || scpLike.MatchString(s)
}

// Spec is a parsed ssh target.
type Spec struct {
	Host string // may include user@
	Port string
	Path string // absolute, or starting with ~
}

// Parse reads "user@host:path" or "ssh://[user@]host[:port]/path".
// Relative paths are relative to the remote home folder.
func Parse(s string) (Spec, error) {
	if rest, ok := strings.CutPrefix(s, "ssh://"); ok {
		hostPart, p, found := strings.Cut(rest, "/")
		if !found || hostPart == "" || p == "" {
			return Spec{}, fmt.Errorf("remote %q: expected ssh://[user@]host[:port]/path", s)
		}
		sp := Spec{Host: hostPart}
		at := strings.LastIndex(hostPart, "@")
		if i := strings.LastIndex(hostPart, ":"); i > at {
			sp.Host, sp.Port = hostPart[:i], hostPart[i+1:]
		}
		if strings.HasPrefix(p, "~") {
			sp.Path = p
		} else {
			sp.Path = "/" + p
		}
		return sp, nil
	}
	m := scpLike.FindStringSubmatch(s)
	if m == nil {
		return Spec{}, fmt.Errorf("remote %q: expected user@host:path or ssh://user@host/path", s)
	}
	p := m[2]
	switch {
	case p == "" || p == "~":
		p = "~"
	case !strings.HasPrefix(p, "/") && !strings.HasPrefix(p, "~"):
		p = "~/" + p
	}
	return Spec{Host: m[1], Path: p}, nil
}

// String returns the canonical ssh:// form.
func (s Spec) String() string {
	host := s.Host
	if s.Port != "" {
		host += ":" + s.Port
	}
	return "ssh://" + host + "/" + strings.TrimPrefix(s.Path, "/")
}

// Dir is the remote path quoted for a POSIX shell.
func (s Spec) Dir() string { return QuotePath(s.Path) }

// Command builds an ssh command that runs shell on the remote host.
func (s Spec) Command(ctx context.Context, shell string) *exec.Cmd {
	args := []string{"-o", "BatchMode=yes", "-o", "ConnectTimeout=15"}
	if s.Port != "" {
		args = append(args, "-p", s.Port)
	}
	args = append(args, s.Host, shell)
	return exec.CommandContext(ctx, "ssh", args...)
}

// Run executes shell remotely and returns its combined output.
func (s Spec) Run(ctx context.Context, shell string, stdin io.Reader) (string, error) {
	cmd := s.Command(ctx, shell)
	cmd.Stdin = stdin
	var out bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &out
	err := cmd.Run()
	return out.String(), err
}

// Quote single-quotes s for a POSIX shell.
func Quote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}

// QuotePath quotes a path but keeps a leading ~ working.
func QuotePath(p string) string {
	switch {
	case p == "~":
		return `"$HOME"`
	case strings.HasPrefix(p, "~/"):
		return `"$HOME"/` + Quote(p[2:])
	}
	return Quote(p)
}
