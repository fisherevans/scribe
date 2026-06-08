// Package mapping reads and writes .scribe.yml - scribe's own sidecar config
// that maps each Pages CMS collection to an editing experience and binds the
// experience's model fields (roles) to the collection's real fields. It travels
// with the site, alongside .pages.yml. Absent file = empty mapping (the web
// recommends one via the setup flow and writes it back).
package mapping

import (
	"os"
	"path/filepath"

	"gopkg.in/yaml.v3"
)

// Mapping is the whole .scribe.yml.
type Mapping struct {
	Collections map[string]CollectionMapping `yaml:"collections,omitempty" json:"collections"`
}

// CollectionMapping binds one collection to an experience and maps that
// experience's roles (title, body, tags, …) to the collection's field names.
// References maps a reference role (e.g. tags) to the collection it points at.
type CollectionMapping struct {
	Experience string            `yaml:"experience" json:"experience"`
	Fields     map[string]string `yaml:"fields,omitempty" json:"fields"`         // role -> field name
	References map[string]string `yaml:"references,omitempty" json:"references"` // role -> target collection
}

type Store struct {
	path string
}

func NewStore(repo string) *Store { return &Store{path: filepath.Join(repo, ".scribe.yml")} }

// Load returns the mapping, or an empty (non-nil) one if .scribe.yml is absent.
func (s *Store) Load() (*Mapping, error) {
	m := &Mapping{Collections: map[string]CollectionMapping{}}
	b, err := os.ReadFile(s.path)
	if err != nil {
		if os.IsNotExist(err) {
			return m, nil
		}
		return nil, err
	}
	if err := yaml.Unmarshal(b, m); err != nil {
		return nil, err
	}
	if m.Collections == nil {
		m.Collections = map[string]CollectionMapping{}
	}
	return m, nil
}

// Write persists the mapping to .scribe.yml (atomic temp + rename).
func (s *Store) Write(m *Mapping) error {
	b, err := yaml.Marshal(m)
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}
