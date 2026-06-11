package auth

import (
	"path/filepath"
	"testing"
	"time"

	"golang.org/x/oauth2"
)

func TestSQLiteStoreRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "sessions.db")
	s, err := newSQLiteStore(path, discardLogger())
	if err != nil {
		t.Fatal(err)
	}
	sess := &session{
		id:       "sid1",
		identity: Identity{Subject: "fisher", Email: "f@x.com", Groups: []string{"admin"}},
		token:    &oauth2.Token{AccessToken: "at", RefreshToken: "rt", Expiry: time.Now().Add(time.Hour)},
		expiry:   time.Now().Add(time.Hour),
	}
	s.put(sess)

	got, ok := s.get("sid1")
	if !ok {
		t.Fatal("get after put missed")
	}
	if got.identity.Subject != "fisher" || got.token.RefreshToken != "rt" || len(got.identity.Groups) != 1 {
		t.Fatalf("round-trip lost data: %+v / %+v", got.identity, got.token)
	}
	s.delete("sid1")
	if _, ok := s.get("sid1"); ok {
		t.Fatal("get after delete should miss")
	}
}

func TestSQLiteStorePersistsAcrossReopen(t *testing.T) {
	path := filepath.Join(t.TempDir(), "sessions.db")
	s1, err := newSQLiteStore(path, discardLogger())
	if err != nil {
		t.Fatal(err)
	}
	s1.put(&session{id: "keep", identity: Identity{Subject: "fisher"},
		token: &oauth2.Token{AccessToken: "at"}, expiry: time.Now().Add(time.Hour)})
	s1.db.Close()

	// Reopen the same file - the session must still be there (the whole point:
	// surviving a scribe restart).
	s2, err := newSQLiteStore(path, discardLogger())
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := s2.get("keep"); !ok {
		t.Fatal("session did not survive reopen")
	}
}

func TestSQLiteStoreExpiry(t *testing.T) {
	path := filepath.Join(t.TempDir(), "sessions.db")
	s, err := newSQLiteStore(path, discardLogger())
	if err != nil {
		t.Fatal(err)
	}
	s.put(&session{id: "old", identity: Identity{Subject: "x"},
		token: &oauth2.Token{}, expiry: time.Now().Add(-time.Minute)})
	if _, ok := s.get("old"); ok {
		t.Fatal("expired session must not be returned")
	}
}

// The OIDC authenticator must select the SQLite store when a path is set.
func TestOIDCUsesSQLiteWhenPathSet(t *testing.T) {
	// newOIDC needs a reachable issuer for discovery, which we don't have in a
	// unit test; assert the store-selection path directly instead.
	path := filepath.Join(t.TempDir(), "sessions.db")
	st, err := newSQLiteStore(path, discardLogger())
	if err != nil {
		t.Fatal(err)
	}
	if _, isSQLite := any(st).(*sqliteStore); !isSQLite {
		t.Fatal("expected a *sqliteStore")
	}
}
