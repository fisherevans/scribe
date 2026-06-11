package auth

import (
	"golang.org/x/oauth2"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// testOIDC builds an oidcAuth without running discovery, sufficient for testing
// the middleware/session logic that doesn't touch the provider.
func testOIDC() *oidcAuth {
	return &oidcAuth{
		log:      discardLogger(),
		sessions: newMemStore(),
		secret:   []byte("test-secret"),
		secure:   false,
	}
}

func TestChallengeRedirectsBrowsers(t *testing.T) {
	a := testOIDC()
	h := a.Wrap(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("next must not be called when unauthenticated")
	}))
	req := httptest.NewRequest("GET", "/posts/x", nil)
	req.Header.Set("Accept", "text/html")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusFound {
		t.Fatalf("want 302, got %d", rec.Code)
	}
	loc := rec.Header().Get("Location")
	if want := "/auth/login?rd="; loc[:len(want)] != want {
		t.Fatalf("want redirect to login, got %q", loc)
	}
}

func TestChallenge401ForAPI(t *testing.T) {
	a := testOIDC()
	h := a.Wrap(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("next must not be called when unauthenticated")
	}))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/api/c/posts", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d", rec.Code)
	}
}

func TestHealthBypassesAuth(t *testing.T) {
	a := testOIDC()
	called := false
	h := a.Wrap(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { called = true }))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/api/health", nil))
	if !called {
		t.Fatal("health must bypass auth")
	}
}

func TestValidSessionPassesThroughWithIdentity(t *testing.T) {
	a := testOIDC()
	a.sessions.put(&session{
		id:       "sid1",
		identity: Identity{Subject: "fisher", Email: "f@x.com"},
		// Unexpired token: TokenSource returns it as-is, no refresh/network.
		token:  &oauth2.Token{AccessToken: "at", Expiry: time.Now().Add(time.Hour)},
		expiry: time.Now().Add(time.Hour),
	})
	var gotID Identity
	var ok bool
	h := a.Wrap(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotID, ok = IdentityFrom(r.Context())
	}))
	req := httptest.NewRequest("GET", "/api/c/posts", nil)
	req.AddCookie(&http.Cookie{Name: sessionCookie, Value: "sid1"})
	h.ServeHTTP(httptest.NewRecorder(), req)
	if !ok || gotID.Subject != "fisher" {
		t.Fatalf("expected identity in context, got ok=%v id=%+v", ok, gotID)
	}
}

func TestGroupAllowed(t *testing.T) {
	open := testOIDC() // no allowedGroups => any authenticated user
	if !open.groupAllowed(Identity{Groups: nil}) {
		t.Fatal("no restriction should allow anyone")
	}
	restricted := testOIDC()
	restricted.allowedGroups = map[string]struct{}{"admin": {}}
	if restricted.groupAllowed(Identity{Groups: []string{"users"}}) {
		t.Fatal("user without admin must be denied")
	}
	if !restricted.groupAllowed(Identity{Groups: []string{"users", "admin"}}) {
		t.Fatal("user with admin must be allowed")
	}
}

func TestSanitizeRedirect(t *testing.T) {
	tests := map[string]string{
		"/posts/x":         "/posts/x",
		"":                 "/",
		"https://evil.com": "/",
		"//evil.com":       "/",
		"/":                "/",
	}
	for in, want := range tests {
		if got := sanitizeRedirect(in); got != want {
			t.Errorf("sanitizeRedirect(%q)=%q want %q", in, got, want)
		}
	}
}
