package auth

import (
	"context"
	"fmt"
	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const (
	sessionCookie = "scribe_session"
	flowCookie    = "scribe_oidc_flow"
	flowTTL       = 10 * time.Minute
	// Absolute session lifetime. The access token is refreshed within this
	// window via the refresh token; when this elapses the user logs in again.
	sessionTTL = 30 * 24 * time.Hour
)

type oidcAuth struct {
	log           *slog.Logger
	provider      *oidc.Provider
	verifier      *oidc.IDTokenVerifier
	oauth2        oauth2.Config
	sessions      sessionStore
	secret        []byte
	allowedGroups map[string]struct{}
	endSession    string // RP-initiated logout endpoint from discovery, if any
	secure        bool   // mark cookies Secure (true when the redirect URL is https)
}

func newOIDC(ctx context.Context, cfg Config, log *slog.Logger) (*oidcAuth, error) {
	provider, err := oidc.NewProvider(ctx, cfg.Issuer)
	if err != nil {
		return nil, fmt.Errorf("oidc discovery (%s): %w", cfg.Issuer, err)
	}
	scopes := cfg.Scopes
	if len(scopes) == 0 {
		scopes = []string{oidc.ScopeOpenID, "profile", "email", "groups", oidc.ScopeOfflineAccess}
	}
	allowed := map[string]struct{}{}
	for _, g := range cfg.AllowedGroups {
		if g = strings.TrimSpace(g); g != "" {
			allowed[g] = struct{}{}
		}
	}
	var disco struct {
		EndSession string `json:"end_session_endpoint"`
	}
	_ = provider.Claims(&disco)

	log.Info("auth mode: oidc", "issuer", cfg.Issuer, "client_id", cfg.ClientID,
		"scopes", scopes, "allowed_groups", cfg.AllowedGroups)
	return &oidcAuth{
		log:      log,
		provider: provider,
		verifier: provider.Verifier(&oidc.Config{ClientID: cfg.ClientID}),
		oauth2: oauth2.Config{
			ClientID:     cfg.ClientID,
			ClientSecret: cfg.ClientSecret,
			Endpoint:     provider.Endpoint(),
			RedirectURL:  cfg.RedirectURL,
			Scopes:       scopes,
		},
		sessions:      newMemStore(),
		secret:        cfg.SessionSecret,
		allowedGroups: allowed,
		endSession:    disco.EndSession,
		secure:        strings.HasPrefix(strings.ToLower(cfg.RedirectURL), "https://"),
	}, nil
}

// Register installs the auth-owned routes on the top-level mux.
func (a *oidcAuth) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /auth/login", a.login)
	mux.HandleFunc("GET /auth/callback", a.callback)
	mux.HandleFunc("GET /auth/logout", a.logout)
	mux.HandleFunc("GET /api/me", a.me)
}

// Wrap enforces a valid session ahead of the app, transparently refreshing the
// access token and injecting the identity into the request context.
func (a *oidcAuth) Wrap(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Health is unauthenticated so liveness/readiness probes and the public
		// uptime check work without a session.
		if r.Method == http.MethodGet && r.URL.Path == "/api/health" {
			next.ServeHTTP(w, r)
			return
		}
		sess, ok := a.currentSession(r)
		if !ok {
			a.challenge(w, r)
			return
		}
		// Refresh the access token if it has expired (TokenSource returns the
		// current token when still valid, otherwise uses the refresh token).
		newTok, err := a.oauth2.TokenSource(r.Context(), sess.token).Token()
		if err != nil {
			a.log.Info("session refresh failed, re-authenticating", "sub", sess.identity.Subject, "err", err)
			a.sessions.delete(sess.id)
			a.clearCookie(w, sessionCookie)
			a.challenge(w, r)
			return
		}
		if newTok.AccessToken != sess.token.AccessToken {
			sess.token = newTok
			a.sessions.put(sess)
		}
		ctx := context.WithValue(r.Context(), identityKey, sess.identity)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func (a *oidcAuth) currentSession(r *http.Request) (*session, bool) {
	c, err := r.Cookie(sessionCookie)
	if err != nil {
		return nil, false
	}
	return a.sessions.get(c.Value)
}

// challenge redirects browser navigations to the login flow and answers API
// calls with 401 so the SPA can react without following an opaque redirect.
func (a *oidcAuth) challenge(w http.ResponseWriter, r *http.Request) {
	if wantsHTML(r) {
		http.Redirect(w, r, "/auth/login?rd="+url.QueryEscape(r.URL.RequestURI()), http.StatusFound)
		return
	}
	writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthenticated"})
}

func (a *oidcAuth) login(w http.ResponseWriter, r *http.Request) {
	state, err1 := randToken(24)
	nonce, err2 := randToken(24)
	if err1 != nil || err2 != nil {
		http.Error(w, "auth init failed", http.StatusInternalServerError)
		return
	}
	verifier := oauth2.GenerateVerifier()
	fs := flowState{
		State:    state,
		Nonce:    nonce,
		Verifier: verifier,
		Redirect: sanitizeRedirect(r.URL.Query().Get("rd")),
	}
	val, err := encodeFlowState(a.secret, fs)
	if err != nil {
		http.Error(w, "auth init failed", http.StatusInternalServerError)
		return
	}
	a.setCookie(w, flowCookie, val, flowTTL)
	url := a.oauth2.AuthCodeURL(state, oidc.Nonce(nonce), oauth2.S256ChallengeOption(verifier))
	http.Redirect(w, r, url, http.StatusFound)
}

func (a *oidcAuth) callback(w http.ResponseWriter, r *http.Request) {
	c, err := r.Cookie(flowCookie)
	if err != nil {
		http.Error(w, "login expired, try again", http.StatusBadRequest)
		return
	}
	a.clearCookie(w, flowCookie)
	fs, err := decodeFlowState(a.secret, c.Value)
	if err != nil {
		http.Error(w, "invalid login state", http.StatusBadRequest)
		return
	}
	if r.URL.Query().Get("state") != fs.State {
		http.Error(w, "state mismatch", http.StatusBadRequest)
		return
	}
	if e := r.URL.Query().Get("error"); e != "" {
		http.Error(w, "identity provider error: "+e, http.StatusUnauthorized)
		return
	}

	tok, err := a.oauth2.Exchange(r.Context(), r.URL.Query().Get("code"), oauth2.VerifierOption(fs.Verifier))
	if err != nil {
		a.log.Warn("code exchange failed", "err", err)
		http.Error(w, "token exchange failed", http.StatusBadGateway)
		return
	}
	rawID, ok := tok.Extra("id_token").(string)
	if !ok {
		http.Error(w, "no id_token in response", http.StatusBadGateway)
		return
	}
	idToken, err := a.verifier.Verify(r.Context(), rawID)
	if err != nil {
		http.Error(w, "id_token verification failed", http.StatusUnauthorized)
		return
	}
	if idToken.Nonce != fs.Nonce {
		http.Error(w, "nonce mismatch", http.StatusUnauthorized)
		return
	}

	id, err := a.identityFromToken(r.Context(), idToken, tok)
	if err != nil {
		a.log.Warn("identity resolution failed", "err", err)
		http.Error(w, "could not resolve identity", http.StatusBadGateway)
		return
	}
	if !a.groupAllowed(id) {
		a.log.Info("login denied: group not permitted", "sub", id.Subject, "groups", id.Groups)
		http.Error(w, "forbidden: your account is not permitted to use this app", http.StatusForbidden)
		return
	}

	sid, err := randToken(24)
	if err != nil {
		http.Error(w, "session init failed", http.StatusInternalServerError)
		return
	}
	a.sessions.put(&session{id: sid, identity: id, token: tok, expiry: time.Now().Add(sessionTTL)})
	a.setCookie(w, sessionCookie, sid, sessionTTL)
	a.log.Info("login success", "sub", id.Subject, "email", id.Email)
	http.Redirect(w, r, fs.Redirect, http.StatusFound)
}

func (a *oidcAuth) logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(sessionCookie); err == nil {
		a.sessions.delete(c.Value)
	}
	a.clearCookie(w, sessionCookie)
	// RP-initiated logout when the provider supports it, so the IdP session
	// ends too (not just scribe's). Otherwise just return to the app root,
	// which re-challenges.
	if a.endSession != "" {
		http.Redirect(w, r, a.endSession, http.StatusFound)
		return
	}
	http.Redirect(w, r, "/", http.StatusFound)
}

func (a *oidcAuth) me(w http.ResponseWriter, r *http.Request) {
	sess, ok := a.currentSession(r)
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"authenticated": false})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"authenticated": true,
		"mode":          "oidc",
		"identity":      sess.identity,
	})
}

// identityFromToken reads sub/email/name/groups from the ID token, falling back
// to the UserInfo endpoint for groups when the IdP doesn't put them in the ID
// token (some providers gate group claims behind a userinfo lookup).
func (a *oidcAuth) identityFromToken(ctx context.Context, idToken *oidc.IDToken, tok *oauth2.Token) (Identity, error) {
	var c struct {
		Sub    string   `json:"sub"`
		Email  string   `json:"email"`
		Name   string   `json:"name"`
		Groups []string `json:"groups"`
	}
	if err := idToken.Claims(&c); err != nil {
		return Identity{}, err
	}
	id := Identity{Subject: c.Sub, Email: c.Email, Name: c.Name, Groups: c.Groups}
	if len(id.Groups) == 0 {
		if ui, err := a.provider.UserInfo(ctx, oauth2.StaticTokenSource(tok)); err == nil {
			var uc struct {
				Email  string   `json:"email"`
				Name   string   `json:"name"`
				Groups []string `json:"groups"`
			}
			if err := ui.Claims(&uc); err == nil {
				if id.Email == "" {
					id.Email = uc.Email
				}
				if id.Name == "" {
					id.Name = uc.Name
				}
				id.Groups = uc.Groups
			}
		}
	}
	return id, nil
}

func (a *oidcAuth) groupAllowed(id Identity) bool {
	if len(a.allowedGroups) == 0 {
		return true // no restriction: any authenticated user
	}
	for _, g := range id.Groups {
		if _, ok := a.allowedGroups[g]; ok {
			return true
		}
	}
	return false
}

func (a *oidcAuth) setCookie(w http.ResponseWriter, name, value string, ttl time.Duration) {
	http.SetCookie(w, &http.Cookie{
		Name:     name,
		Value:    value,
		Path:     "/",
		MaxAge:   int(ttl.Seconds()),
		HttpOnly: true,
		Secure:   a.secure,
		SameSite: http.SameSiteLaxMode,
	})
}

func (a *oidcAuth) clearCookie(w http.ResponseWriter, name string) {
	http.SetCookie(w, &http.Cookie{
		Name:     name,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   a.secure,
		SameSite: http.SameSiteLaxMode,
	})
}

// sanitizeRedirect keeps post-login redirects to local, absolute paths so the
// rd parameter can't be used as an open redirect to another origin.
func sanitizeRedirect(rd string) string {
	if rd == "" || !strings.HasPrefix(rd, "/") || strings.HasPrefix(rd, "//") {
		return "/"
	}
	return rd
}
