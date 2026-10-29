// Package api serves a small local HTTP API for editors and scripts:
//
//	GET  /status                     every pair's status (JSON)
//	GET  /events                     live events (server-sent events)
//	GET  /pairs/{name}/diff?path=…   diff of one file (text); &conflict=1 for target vs source
//	GET  /pairs/{name}/history       recorded sync batches (JSON)
//	POST /pairs/{name}/pause|resume|resync|approve
//	POST /pairs/{name}/commit        ?message=…&push=1
//	POST /pairs/{name}/resolve       {"path": "...", "choice": "source|target|newer|both|merge"}
//	POST /pairs/{name}/undo          undo the last sync batch
//
// Without a token it only answers requests addressed to localhost, and POSTs
// must carry an X-Ferry header, which a web page can't send cross-site.
package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/anupam42/Ferry/internal/engine"
)

// Server exposes running engines over HTTP.
type Server struct {
	engines []*engine.Engine
	token   string
	mu      sync.Mutex
	subs    map[chan engine.Event]struct{}
}

// New creates a server for engines. token may be empty.
func New(engines []*engine.Engine, token string) *Server {
	return &Server{engines: engines, token: token, subs: map[chan engine.Event]struct{}{}}
}

// Broadcast forwards an event to every /events subscriber without blocking.
func (s *Server) Broadcast(ev engine.Event) {
	if s == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for ch := range s.subs {
		select {
		case ch <- ev:
		default: // slow client: drop
		}
	}
}

// ListenAndServe runs until ctx is cancelled.
func (s *Server) ListenAndServe(ctx context.Context, addr string) error {
	srv := &http.Server{Addr: addr, Handler: s.Handler(), ReadHeaderTimeout: 10 * time.Second}
	go func() {
		<-ctx.Done()
		_ = srv.Close()
	}()
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

// Handler returns the API's HTTP handler.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /status", s.handleStatus)
	mux.HandleFunc("GET /events", s.handleEvents)
	mux.HandleFunc("GET /pairs/{name}/diff", s.handleDiff)
	mux.HandleFunc("GET /pairs/{name}/history", s.handleHistory)
	mux.HandleFunc("POST /pairs/{name}/{action}", s.handleAction)
	return s.guard(mux)
}

func (s *Server) guard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if s.token != "" {
			got := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
			if got == "" {
				got = r.URL.Query().Get("token")
			}
			if got != s.token {
				http.Error(w, "missing or wrong token", http.StatusUnauthorized)
				return
			}
		} else {
			// no token: refuse anything not addressed to localhost (DNS rebinding)
			host := r.Host
			if h, _, err := net.SplitHostPort(r.Host); err == nil {
				host = h
			}
			if host != "localhost" && host != "127.0.0.1" && host != "::1" && host != "[::1]" {
				http.Error(w, "set serve_token to use the API from other hosts", http.StatusForbidden)
				return
			}
			if r.Method == http.MethodPost && r.Header.Get("X-Ferry") == "" {
				http.Error(w, "POST requests need an X-Ferry header", http.StatusForbidden)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) find(w http.ResponseWriter, r *http.Request) *engine.Engine {
	name := r.PathValue("name")
	for _, e := range s.engines {
		if e.Name() == name {
			return e
		}
	}
	http.Error(w, fmt.Sprintf("no pair named %q", name), http.StatusNotFound)
	return nil
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	_ = enc.Encode(v)
}

func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	out := make([]engine.Status, 0, len(s.engines))
	for _, e := range s.engines {
		out = append(out, e.Status())
	}
	writeJSON(w, out)
}

func (s *Server) handleEvents(w http.ResponseWriter, r *http.Request) {
	fl, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	ch := make(chan engine.Event, 256)
	s.mu.Lock()
	s.subs[ch] = struct{}{}
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		delete(s.subs, ch)
		s.mu.Unlock()
	}()
	fmt.Fprint(w, ": connected\n\n")
	fl.Flush()
	ping := time.NewTicker(30 * time.Second)
	defer ping.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-ping.C:
			fmt.Fprint(w, ": ping\n\n")
			fl.Flush()
		case ev := <-ch:
			data, _ := json.Marshal(ev)
			fmt.Fprintf(w, "event: %s\ndata: %s\n\n", ev.Kind, data)
			fl.Flush()
		}
	}
}

func (s *Server) handleDiff(w http.ResponseWriter, r *http.Request) {
	e := s.find(w, r)
	if e == nil {
		return
	}
	rel := r.URL.Query().Get("path")
	if rel == "" {
		http.Error(w, "path is required", http.StatusBadRequest)
		return
	}
	title, lines := e.Diff(rel, r.URL.Query().Get("conflict") == "1")
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	fmt.Fprintln(w, title)
	for _, l := range lines {
		if l.Op == '@' {
			fmt.Fprintln(w, l.Text)
		} else {
			fmt.Fprintf(w, "%c%s\n", l.Op, l.Text)
		}
	}
}

func (s *Server) handleHistory(w http.ResponseWriter, r *http.Request) {
	if e := s.find(w, r); e != nil {
		writeJSON(w, e.History())
	}
}

func (s *Server) handleAction(w http.ResponseWriter, r *http.Request) {
	e := s.find(w, r)
	if e == nil {
		return
	}
	q := r.URL.Query()
	switch action := r.PathValue("action"); action {
	case "pause":
		e.SetPaused(true)
	case "resume":
		e.SetPaused(false)
	case "resync":
		e.Resync()
	case "approve":
		e.ApproveBatch()
	case "commit", "push":
		msg := q.Get("message")
		if msg == "" {
			msg = "sync: {summary}"
		}
		e.Commit(msg, action == "push" || q.Get("push") == "1")
	case "resolve":
		var body struct{ Path, Choice string }
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Path == "" {
			http.Error(w, `expected {"path": "...", "choice": "source|target|newer|both|merge"}`, http.StatusBadRequest)
			return
		}
		c, ok := engine.ParseChoice(body.Choice)
		if !ok {
			http.Error(w, "choice must be source, target, newer, both or merge", http.StatusBadRequest)
			return
		}
		e.Resolve(body.Path, c)
	case "undo":
		b, problems, err := e.UndoLast()
		if err != nil {
			http.Error(w, err.Error(), http.StatusConflict)
			return
		}
		writeJSON(w, map[string]any{"undone": b.ID, "time": b.Time, "problems": problems})
		return
	default:
		http.Error(w, "unknown action "+action, http.StatusNotFound)
		return
	}
	writeJSON(w, map[string]string{"ok": r.PathValue("action")})
}
