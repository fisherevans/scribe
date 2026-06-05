// Package store holds scribe's private, app-side metadata - the data that must
// never land in the blog repo. Today that's post notes (links, todos, scratch).
// Backed by a single JSON file outside the repo; safe for the single-writer
// model (one process, serialized writes under a mutex).
package store

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
)

type Notes struct {
	path string
	mu   sync.Mutex
	data map[string]string // key "collection/slug" -> notes
}

// OpenNotes loads (or starts) the notes store at path.
func OpenNotes(path string) (*Notes, error) {
	n := &Notes{path: path, data: map[string]string{}}
	raw, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return n, nil
		}
		return nil, err
	}
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &n.data); err != nil {
			return nil, err
		}
	}
	return n, nil
}

func key(collection, slug string) string { return collection + "/" + slug }

func (n *Notes) Get(collection, slug string) string {
	n.mu.Lock()
	defer n.mu.Unlock()
	return n.data[key(collection, slug)]
}

func (n *Notes) Set(collection, slug, notes string) error {
	n.mu.Lock()
	defer n.mu.Unlock()
	k := key(collection, slug)
	if notes == "" {
		delete(n.data, k)
	} else {
		n.data[k] = notes
	}
	return n.flush()
}

// Move re-keys notes when a resource is renamed.
func (n *Notes) Move(collection, from, to string) error {
	n.mu.Lock()
	defer n.mu.Unlock()
	if v, ok := n.data[key(collection, from)]; ok {
		n.data[key(collection, to)] = v
		delete(n.data, key(collection, from))
		return n.flush()
	}
	return nil
}

func (n *Notes) Delete(collection, slug string) error {
	n.mu.Lock()
	defer n.mu.Unlock()
	delete(n.data, key(collection, slug))
	return n.flush()
}

// flush writes atomically (temp file + rename). Caller holds the lock.
func (n *Notes) flush() error {
	if err := os.MkdirAll(filepath.Dir(n.path), 0o755); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(n.data, "", "  ")
	if err != nil {
		return err
	}
	tmp := n.path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, n.path)
}
