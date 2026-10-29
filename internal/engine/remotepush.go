package engine

import (
	"archive/tar"
	"context"
	"fmt"
	"io"
	"io/fs"
	"os"
	"strings"
	"time"

	"github.com/anupam42/Ferry/internal/ignore"
	"github.com/anupam42/Ferry/internal/remote"
)

// Remote (ssh) pairs sync into a local shadow folder exactly like a local
// target. After each batch the changed files are streamed to the host as one
// tar archive over ssh, and deletions are applied with rm.

func (e *Engine) remoteQueue(rel string, deleted bool) {
	if e.cfg.Remote == "" || e.cfg.DryRun {
		return
	}
	if deleted {
		delete(e.remoteAdd, rel)
		e.remoteDel[rel] = true
	} else {
		delete(e.remoteDel, rel)
		e.remoteAdd[rel] = true
	}
}

// pushRemote sends queued changes to the ssh target. On failure the queue is
// kept and retried with the next pass.
func (e *Engine) pushRemote() error {
	if e.cfg.Remote == "" || e.cfg.DryRun {
		return nil
	}
	if e.remoteFull {
		snap, err := scanDir(e.cfg.Target, ignore.New(hardIgnores...), false, nil, "link")
		if err != nil {
			return err
		}
		for rel := range snap {
			e.remoteAdd[rel] = true
		}
	}
	if len(e.remoteAdd) == 0 && len(e.remoteDel) == 0 {
		e.remoteFull = false
		return nil
	}
	sp, err := remote.Parse(e.cfg.Remote)
	if err != nil {
		return err
	}
	adds, dels := sortedKeys(e.remoteAdd), sortedKeys(e.remoteDel)

	_ = os.MkdirAll(e.dataDir, 0o755)
	archive, err := os.CreateTemp(e.dataDir, "push-*.tar")
	if err != nil {
		return err
	}
	defer os.Remove(archive.Name())
	defer archive.Close()
	if err := e.writeTar(archive, adds); err != nil {
		return err
	}
	if _, err := archive.Seek(0, io.SeekStart); err != nil {
		return err
	}

	script := "mkdir -p " + sp.Dir() + " && tar -xf - -C " + sp.Dir()
	if len(dels) > 0 {
		q := make([]string, len(dels))
		for i, d := range dels {
			q[i] = remote.Quote(d)
		}
		script += " && cd " + sp.Dir() + " && rm -f -- " + strings.Join(q, " ")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
	defer cancel()
	out, err := sp.Run(ctx, script, archive)
	if err != nil {
		msg := strings.TrimSpace(out)
		if msg == "" {
			msg = err.Error()
		}
		return fmt.Errorf("push to %s failed: %s", e.cfg.Remote, firstLine(msg))
	}
	e.emit(Event{Kind: KInfo, Msg: fmt.Sprintf("pushed %d file(s) and removed %d on %s", len(adds), len(dels), e.cfg.Remote)})
	e.remoteAdd, e.remoteDel = map[string]bool{}, map[string]bool{}
	e.remoteFull = false
	return nil
}

func (e *Engine) writeTar(w io.Writer, rels []string) error {
	tw := tar.NewWriter(w)
	for _, rel := range rels {
		p := e.abs(dst, rel)
		fi, err := os.Lstat(p)
		if err != nil {
			continue // gone again since it was queued
		}
		link := ""
		if fi.Mode()&fs.ModeSymlink != 0 {
			if link, err = os.Readlink(p); err != nil {
				continue
			}
		} else if !fi.Mode().IsRegular() {
			continue
		}
		hdr, err := tar.FileInfoHeader(fi, link)
		if err != nil {
			return err
		}
		hdr.Name = rel
		hdr.Uid, hdr.Gid, hdr.Uname, hdr.Gname = 0, 0, "", ""
		if err := tw.WriteHeader(hdr); err != nil {
			return err
		}
		if fi.Mode().IsRegular() {
			f, err := os.Open(p)
			if err != nil {
				return err
			}
			_, err = io.Copy(tw, f)
			f.Close()
			if err != nil {
				return err
			}
		}
	}
	return tw.Close()
}
