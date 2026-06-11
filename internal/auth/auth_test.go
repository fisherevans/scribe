package auth

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
)

func discardLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(httptest.NewRecorder(), nil))
}

func TestConfigValidate(t *testing.T) {
	tests := []struct {
		name    string
		cfg     Config
		wantErr bool
	}{
		{"none needs nothing", Config{Mode: "none"}, false},
		{"empty mode ok", Config{}, false},
		{"oidc missing all", Config{Mode: "oidc"}, true},
		{"oidc missing secret", Config{
			Mode: "oidc", Issuer: "https://idp", ClientID: "c", ClientSecret: "s",
			RedirectURL: "https://app/auth/callback",
		}, true},
		{"oidc complete", Config{
			Mode: "oidc", Issuer: "https://idp", ClientID: "c", ClientSecret: "s",
			RedirectURL: "https://app/auth/callback", SessionSecret: []byte("k"),
		}, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.cfg.Validate()
			if (err != nil) != tt.wantErr {
				t.Fatalf("Validate() err=%v, wantErr=%v", err, tt.wantErr)
			}
		})
	}
}

func TestNewUnknownMode(t *testing.T) {
	if _, err := New(context.Background(), Config{Mode: "saml"}, discardLogger()); err == nil {
		t.Fatal("expected error for unknown mode")
	}
}

func TestNoneAuthPassthrough(t *testing.T) {
	a, err := New(context.Background(), Config{Mode: "none"}, discardLogger())
	if err != nil {
		t.Fatal(err)
	}
	called := false
	h := a.Wrap(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { called = true }))
	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", "/api/c/posts", nil))
	if !called {
		t.Fatal("none mode must pass requests through")
	}
}

func TestNoneAuthMe(t *testing.T) {
	a, _ := New(context.Background(), Config{Mode: "none"}, discardLogger())
	mux := http.NewServeMux()
	a.Register(mux)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("GET", "/api/me", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d", rec.Code)
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["authenticated"] != false {
		t.Fatalf("expected authenticated=false, got %v", body["authenticated"])
	}
}

func TestWantsHTML(t *testing.T) {
	tests := []struct {
		path, accept string
		want         bool
	}{
		{"/", "text/html,application/xhtml+xml", true},
		{"/posts/x", "text/html", true},
		{"/api/c/posts", "text/html", false}, // API paths never redirect
		{"/", "application/json", false},     // XHR navigation
		{"/", "", false},
	}
	for _, tt := range tests {
		r := httptest.NewRequest("GET", tt.path, nil)
		r.Header.Set("Accept", tt.accept)
		if got := wantsHTML(r); got != tt.want {
			t.Errorf("wantsHTML(%q, %q)=%v want %v", tt.path, tt.accept, got, tt.want)
		}
	}
}
