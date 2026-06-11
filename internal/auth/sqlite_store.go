package auth

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"golang.org/x/oauth2"
	_ "modernc.org/sqlite" // pure-Go SQLite driver (works with CGO_ENABLED=0)
)

// sqliteStore is a sessionStore backed by a SQLite file, so sessions survive a
// process restart (unlike memStore). It uses the pure-Go modernc.org/sqlite
// driver to keep scribe's static, CGO-free build. Single-user / low-traffic, so
// it caps to one connection and serializes writes - simple and correct over
// fast. Implements the same get/put/delete contract as memStore.
type sqliteStore struct {
	db  *sql.DB
	log *slog.Logger
}

func newSQLiteStore(path string, log *slog.Logger) (*sqliteStore, error) {
	// WAL + a busy timeout so the single writer doesn't error under the rare
	// concurrent request.
	dsn := fmt.Sprintf("file:%s?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)", path)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open session db %s: %w", path, err)
	}
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS sessions (
		id       TEXT PRIMARY KEY,
		identity TEXT NOT NULL,
		token    TEXT NOT NULL,
		expiry   INTEGER NOT NULL
	)`); err != nil {
		db.Close()
		return nil, fmt.Errorf("init session schema: %w", err)
	}
	s := &sqliteStore{db: db, log: log}
	s.cleanup()
	return s, nil
}

func (s *sqliteStore) get(id string) (*session, bool) {
	var identJSON, tokJSON string
	var exp int64
	err := s.db.QueryRow(`SELECT identity, token, expiry FROM sessions WHERE id = ?`, id).
		Scan(&identJSON, &tokJSON, &exp)
	if err != nil {
		return nil, false // sql.ErrNoRows or a read error -> treat as no session
	}
	if time.Now().Unix() > exp {
		s.delete(id)
		return nil, false
	}
	var ident Identity
	var tok oauth2.Token
	if err := json.Unmarshal([]byte(identJSON), &ident); err != nil {
		return nil, false
	}
	if err := json.Unmarshal([]byte(tokJSON), &tok); err != nil {
		return nil, false
	}
	return &session{id: id, identity: ident, token: &tok, expiry: time.Unix(exp, 0)}, true
}

func (s *sqliteStore) put(sess *session) {
	identJSON, _ := json.Marshal(sess.identity)
	tokJSON, _ := json.Marshal(sess.token)
	_, err := s.db.Exec(
		`INSERT INTO sessions (id, identity, token, expiry) VALUES (?, ?, ?, ?)
		 ON CONFLICT(id) DO UPDATE SET identity=excluded.identity, token=excluded.token, expiry=excluded.expiry`,
		sess.id, string(identJSON), string(tokJSON), sess.expiry.Unix())
	if err != nil && s.log != nil {
		s.log.Warn("session persist failed", "err", err)
	}
}

func (s *sqliteStore) delete(id string) {
	if _, err := s.db.Exec(`DELETE FROM sessions WHERE id = ?`, id); err != nil && s.log != nil {
		s.log.Warn("session delete failed", "err", err)
	}
}

// cleanup drops expired rows so the table doesn't grow unbounded. Called at
// startup; expired rows are also pruned lazily on get.
func (s *sqliteStore) cleanup() {
	if _, err := s.db.Exec(`DELETE FROM sessions WHERE expiry < ?`, time.Now().Unix()); err != nil && s.log != nil {
		s.log.Warn("session cleanup failed", "err", err)
	}
}
