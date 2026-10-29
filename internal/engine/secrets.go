package engine

import (
	"io"
	"os"
	"path"
	"regexp"
	"strings"
)

const secretScanMax = 2 << 20 // only the first 2MB of a file are scanned

var secretFileNames = map[string]string{
	"id_rsa": "SSH private key", "id_dsa": "SSH private key", "id_ecdsa": "SSH private key",
	"id_ed25519": "SSH private key", ".pgpass": "PostgreSQL password file", ".netrc": "netrc credentials",
	"credentials.json": "credentials file", "service-account.json": "service account key",
	".htpasswd": "password file", "secrets.yml": "secrets file", "secrets.yaml": "secrets file",
}

var secretExts = []string{".pem", ".key", ".p12", ".pfx", ".keystore", ".jks", ".ppk", ".kdbx"}

var secretPatterns = []struct {
	name string
	re   *regexp.Regexp
}{
	{"private key", regexp.MustCompile(`-----BEGIN (?:[A-Z]+ )*PRIVATE KEY(?: BLOCK)?-----`)},
	{"AWS access key", regexp.MustCompile(`\b(?:AKIA|ASIA)[0-9A-Z]{16}\b`)},
	{"GitHub token", regexp.MustCompile(`\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})`)},
	{"GitLab token", regexp.MustCompile(`\bglpat-[A-Za-z0-9_\-]{20,}`)},
	{"Slack token", regexp.MustCompile(`\bxox[abposr]-[A-Za-z0-9-]{10,}`)},
	{"Stripe live key", regexp.MustCompile(`\b[sr]k_live_[A-Za-z0-9]{20,}`)},
	{"Google API key", regexp.MustCompile(`\bAIza[0-9A-Za-z_\-]{35}`)},
	{"API key (sk-…)", regexp.MustCompile(`\bsk-(?:ant-|proj-)?[A-Za-z0-9_\-]{32,}`)},
	{"password or token assignment", regexp.MustCompile(`(?i)\b(?:api[_-]?key|secret[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|passw(?:or)?d)["']?\s*[:=]\s*["'][^"'\s]{12,}["']`)},
}

// secretNameHit flags file names that usually hold credentials.
func secretNameHit(rel string) string {
	base := strings.ToLower(path.Base(rel))
	if base == ".env" {
		return "environment file"
	}
	if strings.HasPrefix(base, ".env.") {
		for _, ok := range []string{".example", ".sample", ".template", ".dist", ".defaults"} {
			if strings.HasSuffix(base, ok) {
				return ""
			}
		}
		return "environment file"
	}
	if what, ok := secretFileNames[base]; ok {
		return what
	}
	for _, ext := range secretExts {
		if strings.HasSuffix(base, ext) {
			return "key or certificate file (" + ext + ")"
		}
	}
	return ""
}

// scanSecretContent lists the kinds of credentials found in data.
func scanSecretContent(data []byte) []string {
	if len(data) > secretScanMax {
		data = data[:secretScanMax]
	}
	var hits []string
	for _, sp := range secretPatterns {
		if sp.re.Match(data) {
			hits = append(hits, sp.name)
		}
	}
	return hits
}

// checkSecrets returns what looks like a credential in the file about to be
// copied into the target, unless it matches secret_allow.
func (e *Engine) checkSecrets(rel, p string) []string {
	if e.secretAllow != nil && e.secretAllow.Match(rel, false) {
		return nil
	}
	var hits []string
	if h := secretNameHit(rel); h != "" {
		hits = append(hits, h)
	}
	if f, err := os.Open(p); err == nil {
		data, _ := io.ReadAll(io.LimitReader(f, secretScanMax))
		f.Close()
		hits = append(hits, scanSecretContent(data)...)
	}
	return hits
}
