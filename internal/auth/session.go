package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"golang.org/x/oauth2"
	"strings"
	"sync"
	"time"
)

// session is one logged-in user. It holds the OAuth2 token (so the access token
// can be refreshed via the refresh token) plus the identity resolved from the
// ID token at login. Sessions live in-memory only - an in-memory store is fine
// for a single replica; a process restart forces a re-login. sessionStore is an
// interface so a persistent/shared implementation can drop in later.
type session struct {
	id       string
	identity Identity
	token    *oauth2.Token
	expiry   time.Time // absolute session expiry, independent of the access-token TTL
}

// sessionStore keeps server-side sessions keyed by an opaque id (the value of
// the browser's session cookie).
type sessionStore interface {
	get(id string) (*session, bool)
	put(s *session)
	delete(id string)
}

type memStore struct {
	mu sync.Mutex
	m  map[string]*session
}

func newMemStore() *memStore { return &memStore{m: make(map[string]*session)} }

func (s *memStore) get(id string) (*session, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	sess, ok := s.m[id]
	if !ok {
		return nil, false
	}
	if time.Now().After(sess.expiry) {
		delete(s.m, id)
		return nil, false
	}
	return sess, true
}

func (s *memStore) put(sess *session) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.m[sess.id] = sess
}

func (s *memStore) delete(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.m, id)
}

// randToken returns n bytes of crypto-random data as a URL-safe string. Used for
// session ids, OAuth2 state, and the PKCE verifier.
func randToken(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// flowState is the transient per-login data parked in a signed cookie between
// /auth/login and /auth/callback: the CSRF state, the OIDC nonce, the PKCE
// verifier, and where to send the user after a successful login.
type flowState struct {
	State    string `json:"s"`
	Nonce    string `json:"n"`
	Verifier string `json:"v"`
	Redirect string `json:"r"`
}

// signValue HMAC-signs an opaque payload with the session secret and returns
// "<base64 payload>.<base64 sig>". Used for the short-lived flow-state cookie so
// the callback can trust state/nonce/verifier without a server-side store.
func signValue(secret []byte, payload []byte) string {
	mac := hmac.New(sha256.New, secret)
	mac.Write(payload)
	return base64.RawURLEncoding.EncodeToString(payload) + "." +
		base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func verifyValue(secret []byte, value string) ([]byte, error) {
	dot := strings.LastIndex(value, ".")
	if dot < 0 {
		return nil, errors.New("malformed signed value")
	}
	payload, err := base64.RawURLEncoding.DecodeString(value[:dot])
	if err != nil {
		return nil, err
	}
	sig, err := base64.RawURLEncoding.DecodeString(value[dot+1:])
	if err != nil {
		return nil, err
	}
	mac := hmac.New(sha256.New, secret)
	mac.Write(payload)
	if !hmac.Equal(sig, mac.Sum(nil)) {
		return nil, errors.New("bad signature")
	}
	return payload, nil
}

func encodeFlowState(secret []byte, fs flowState) (string, error) {
	b, err := json.Marshal(fs)
	if err != nil {
		return "", err
	}
	return signValue(secret, b), nil
}

func decodeFlowState(secret []byte, value string) (flowState, error) {
	var fs flowState
	payload, err := verifyValue(secret, value)
	if err != nil {
		return fs, err
	}
	err = json.Unmarshal(payload, &fs)
	return fs, err
}
