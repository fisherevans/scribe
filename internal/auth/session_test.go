package auth

import (
	"golang.org/x/oauth2"
	"testing"
	"time"
)

func TestFlowStateRoundTrip(t *testing.T) {
	secret := []byte("test-secret-key")
	in := flowState{State: "st", Nonce: "no", Verifier: "ve", Redirect: "/posts/x"}
	enc, err := encodeFlowState(secret, in)
	if err != nil {
		t.Fatal(err)
	}
	out, err := decodeFlowState(secret, enc)
	if err != nil {
		t.Fatal(err)
	}
	if out != in {
		t.Fatalf("round-trip mismatch: %+v != %+v", out, in)
	}
}

func TestFlowStateTamperRejected(t *testing.T) {
	secret := []byte("test-secret-key")
	enc, _ := encodeFlowState(secret, flowState{State: "st"})
	// Wrong secret must fail signature verification.
	if _, err := decodeFlowState([]byte("other-secret"), enc); err == nil {
		t.Fatal("expected signature failure with wrong secret")
	}
	// Flipping a payload byte must fail too.
	b := []byte(enc)
	b[0] ^= 0xff
	if _, err := decodeFlowState(secret, string(b)); err == nil {
		t.Fatal("expected failure on tampered payload")
	}
}

func TestMemStore(t *testing.T) {
	s := newMemStore()
	sess := &session{id: "abc", identity: Identity{Subject: "fisher"}, token: &oauth2.Token{}, expiry: time.Now().Add(time.Hour)}
	s.put(sess)

	got, ok := s.get("abc")
	if !ok || got.identity.Subject != "fisher" {
		t.Fatalf("get after put failed: %v %+v", ok, got)
	}
	s.delete("abc")
	if _, ok := s.get("abc"); ok {
		t.Fatal("get after delete should miss")
	}
}

func TestMemStoreExpiry(t *testing.T) {
	s := newMemStore()
	s.put(&session{id: "old", expiry: time.Now().Add(-time.Minute)})
	if _, ok := s.get("old"); ok {
		t.Fatal("expired session must not be returned")
	}
}

func TestRandTokenUnique(t *testing.T) {
	seen := map[string]bool{}
	for i := 0; i < 100; i++ {
		tok, err := randToken(24)
		if err != nil {
			t.Fatal(err)
		}
		if seen[tok] {
			t.Fatal("randToken produced a duplicate")
		}
		seen[tok] = true
	}
}
