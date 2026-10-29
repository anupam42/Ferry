// Package webhook posts selected engine events to Slack, Discord, ntfy or any
// HTTP endpoint.
package webhook

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/anupam42/Ferry/internal/config"
	"github.com/anupam42/Ferry/internal/engine"
)

// DefaultEvents are sent when a webhook doesn't list its own.
var DefaultEvents = []string{"conflict", "error", "paused", "commit"}

// MinGap rate-limits identical messages per webhook.
var MinGap = 10 * time.Second

// Dispatcher fans events out to webhooks. A nil Dispatcher does nothing.
type Dispatcher struct {
	hooks  []config.Webhook
	client *http.Client
	mu     sync.Mutex
	last   map[string]time.Time
}

// New returns nil when there are no webhooks.
func New(hooks []config.Webhook) *Dispatcher {
	if len(hooks) == 0 {
		return nil
	}
	return &Dispatcher{hooks: hooks, client: &http.Client{Timeout: 10 * time.Second}, last: map[string]time.Time{}}
}

// Handle sends ev to every webhook that wants it, in the background.
func (d *Dispatcher) Handle(ev engine.Event) {
	if d == nil {
		return
	}
	for _, h := range d.hooks {
		if !wants(h, ev) {
			continue
		}
		key := h.URL + "|" + ev.Pair + "|" + string(ev.Kind) + "|" + ev.Path
		d.mu.Lock()
		if t, ok := d.last[key]; ok && time.Since(t) < MinGap {
			d.mu.Unlock()
			continue
		}
		d.last[key] = time.Now()
		d.mu.Unlock()
		go func(h config.Webhook) { _ = d.send(h, ev) }(h)
	}
}

func wants(h config.Webhook, ev engine.Event) bool {
	events := h.Events
	if len(events) == 0 {
		events = DefaultEvents
	}
	for _, k := range events {
		if k == "all" || k == string(ev.Kind) {
			return true
		}
	}
	return false
}

// Format picks the payload style from the URL when format is auto/empty.
func Format(h config.Webhook) string {
	if h.Format != "" && h.Format != "auto" {
		return h.Format
	}
	u, err := url.Parse(h.URL)
	if err != nil {
		return "json"
	}
	host := strings.ToLower(u.Host)
	switch {
	case strings.Contains(host, "hooks.slack.com"):
		return "slack"
	case strings.Contains(host, "discord.com") || strings.Contains(host, "discordapp.com"):
		return "discord"
	case strings.Contains(host, "ntfy"):
		return "ntfy"
	}
	return "json"
}

// Text is the human-readable line used by chat formats.
func Text(ev engine.Event) string {
	what := strings.TrimSpace(ev.Path + " " + ev.Msg)
	if ev.To != "" {
		what = strings.TrimSpace(ev.Path + " → " + ev.To + " " + ev.Msg)
	}
	return fmt.Sprintf("ferry [%s] %s: %s", ev.Pair, ev.Kind, what)
}

func (d *Dispatcher) send(h config.Webhook, ev engine.Event) error {
	var body []byte
	contentType := "application/json"
	headers := map[string]string{}
	switch Format(h) {
	case "slack":
		body, _ = json.Marshal(map[string]string{"text": Text(ev)})
	case "discord":
		body, _ = json.Marshal(map[string]string{"content": Text(ev)})
	case "ntfy":
		body = []byte(strings.TrimSpace(ev.Path + " " + ev.Msg))
		contentType = "text/plain; charset=utf-8"
		headers["Title"] = "ferry: " + ev.Pair + " " + string(ev.Kind)
		headers["Tags"] = string(ev.Kind)
		if ev.Kind == engine.KError || ev.Kind == engine.KConflict {
			headers["Priority"] = "high"
		}
	default:
		body, _ = json.Marshal(ev)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, h.URL, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("User-Agent", "ferry")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := d.client.Do(req)
	if err != nil {
		return err
	}
	resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("webhook %s: %s", h.URL, resp.Status)
	}
	return nil
}
