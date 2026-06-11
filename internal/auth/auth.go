// Package auth provides scribe's pluggable authentication. scribe can run open
// (mode "none", the default - for local dev or a trusted network) or as a full
// OpenID Connect client (mode "oidc") that logs users in against any compliant
// IdP using the Authorization Code flow with PKCE and refresh tokens.
//
// The design goal is that scribe owns its authorization rather than depending on
// a reverse-proxy gate: in "oidc" mode scribe redirects unauthenticated users to
// the IdP itself, establishes its own session, and enforces access on every
// request. This makes scribe a self-contained reference for "how an app should
// authorize" - point it at an issuer + client credentials and it just works.
//
// An Authenticator wraps the application handler (Wrap) and registers any routes
// it owns - /auth/login, /auth/callback, /auth/logout, and GET /api/me (Register).
// The internal/api package stays auth-free; main wires the Authenticator around
// its mux.
package auth

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
)

// Identity is the authenticated user, resolved from the IdP's ID token. In
// "none" mode it is the zero value (anonymous).
type Identity struct {
	Subject string   `json:"subject"`
	Email   string   `json:"email"`
	Name    string   `json:"name"`
	Groups  []string `json:"groups"`
}

// Authenticator enforces auth in front of the app and owns its login routes.
type Authenticator interface {
	// Wrap returns a handler that enforces authentication ahead of next.
	Wrap(next http.Handler) http.Handler
	// Register installs the authenticator's own routes (login/callback/logout,
	// /api/me) onto the top-level mux.
	Register(mux *http.ServeMux)
}

// Config is the auth configuration parsed from SCRIBE_* env/flags in main.
type Config struct {
	Mode string // "none" (default) or "oidc"

	// OIDC mode.
	Issuer        string
	ClientID      string
	ClientSecret  string
	RedirectURL   string
	Scopes        []string // default: openid profile email groups offline_access
	AllowedGroups []string // optional; if set, the user must be in one of these
	SessionSecret []byte   // HMAC key for the flow-state cookie + session ids
}

// New builds the Authenticator for cfg.Mode. The context is used for OIDC
// discovery and is not retained.
func New(ctx context.Context, cfg Config, log *slog.Logger) (Authenticator, error) {
	switch strings.ToLower(strings.TrimSpace(cfg.Mode)) {
	case "", "none":
		log.Info("auth mode: none (open - no login required)")
		return noneAuth{}, nil
	case "oidc":
		return newOIDC(ctx, cfg, log)
	default:
		return nil, fmt.Errorf("unknown SCRIBE_AUTH_MODE %q (want none|oidc)", cfg.Mode)
	}
}

// Validate checks that an oidc config has the required fields, so main can fail
// fast with a clear message instead of crashing mid-request.
func (c Config) Validate() error {
	if strings.ToLower(c.Mode) != "oidc" {
		return nil
	}
	var missing []string
	if c.Issuer == "" {
		missing = append(missing, "SCRIBE_OIDC_ISSUER")
	}
	if c.ClientID == "" {
		missing = append(missing, "SCRIBE_OIDC_CLIENT_ID")
	}
	if c.ClientSecret == "" {
		missing = append(missing, "SCRIBE_OIDC_CLIENT_SECRET")
	}
	if c.RedirectURL == "" {
		missing = append(missing, "SCRIBE_OIDC_REDIRECT_URL")
	}
	if len(c.SessionSecret) == 0 {
		missing = append(missing, "SCRIBE_SESSION_SECRET")
	}
	if len(missing) > 0 {
		return fmt.Errorf("auth mode oidc requires: %s", strings.Join(missing, ", "))
	}
	return nil
}

// ── none mode ───────────────────────────────────────────────────────────────

type noneAuth struct{}

func (noneAuth) Wrap(next http.Handler) http.Handler { return next }

func (noneAuth) Register(mux *http.ServeMux) {
	// Report unauthenticated so the UI can hide user-specific chrome (sign-out).
	mux.HandleFunc("GET /api/me", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"authenticated": false, "mode": "none"})
	})
}

// ── shared helpers ──────────────────────────────────────────────────────────

type ctxKey int

const identityKey ctxKey = 0

// IdentityFrom returns the authenticated identity stored on the request context
// by the OIDC middleware, if any.
func IdentityFrom(ctx context.Context) (Identity, bool) {
	id, ok := ctx.Value(identityKey).(Identity)
	return id, ok
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// wantsHTML reports whether an unauthenticated request should be redirected to
// the login flow (a browser navigation) rather than answered with 401 (an XHR /
// API call). Browsers send Accept: text/html on navigations; fetch/XHR does not.
func wantsHTML(r *http.Request) bool {
	if strings.HasPrefix(r.URL.Path, "/api/") {
		return false
	}
	return strings.Contains(r.Header.Get("Accept"), "text/html")
}
