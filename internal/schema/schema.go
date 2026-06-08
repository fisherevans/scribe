// Package schema reads a site's .pages.yml (the Pages CMS configuration) into a
// normalized model: the collections the site defines and, for each, its fields.
// This is the foundation of scribe's schema-driven core - everything above it
// (the generic store, the API, the mapping layer) is driven by what's here, so
// scribe fits whatever the author configured instead of assuming posts + tags.
package schema

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"
)

// Schema is the normalized view of a site's content configuration.
type Schema struct {
	Collections []Collection `json:"collections"`
	Primary     string       `json:"primary"` // settings.primary, if set
}

// Collection is one Pages CMS collection (type: collection). File-typed entries
// (single files like an about page) are skipped for now.
type Collection struct {
	Name   string  `json:"name"`
	Label  string  `json:"label"`
	Path   string  `json:"path"`   // dir relative to the repo root
	Format string  `json:"format"` // "yaml-frontmatter" | "yaml"
	Ext    string  `json:"ext"`    // ".md" | ".yaml", derived from filename/format
	Fields []Field `json:"fields"`
}

// Field is one field on a collection.
type Field struct {
	Name     string   `json:"name"`
	Label    string   `json:"label"`
	Type     string   `json:"type"` // string, text, rich-text, date, boolean, image, number, select, object, code
	Required bool     `json:"required"`
	List     bool     `json:"list"`
	Options  []string `json:"options,omitempty"` // for select fields
}

func (s *Schema) Collection(name string) (*Collection, bool) {
	for i := range s.Collections {
		if s.Collections[i].Name == name {
			return &s.Collections[i], true
		}
	}
	return nil, false
}

func (c *Collection) Field(name string) (*Field, bool) {
	for i := range c.Fields {
		if c.Fields[i].Name == name {
			return &c.Fields[i], true
		}
	}
	return nil, false
}

// ---- parsing ------------------------------------------------------------

// raw mirrors the parts of .pages.yml we consume.
type raw struct {
	Content  []rawEntry `yaml:"content"`
	Settings struct {
		Primary string `yaml:"primary"`
	} `yaml:"settings"`
}

type rawEntry struct {
	Name     string     `yaml:"name"`
	Label    string     `yaml:"label"`
	Path     string     `yaml:"path"`
	Type     string     `yaml:"type"` // "collection" | "file"
	Filename string     `yaml:"filename"`
	Format   string     `yaml:"format"`
	Fields   []rawField `yaml:"fields"`
}

type rawField struct {
	Name     string `yaml:"name"`
	Label    string `yaml:"label"`
	Type     string `yaml:"type"`
	Required bool   `yaml:"required"`
	List     bool   `yaml:"list"`
	Options  *struct {
		Values []any `yaml:"values"`
	} `yaml:"options"`
}

// optionValues extracts select option values, handling both ["a","b"] and
// [{value: a, label: A}] shapes.
func optionValues(f rawField) []string {
	if f.Options == nil {
		return nil
	}
	var out []string
	for _, v := range f.Options.Values {
		switch t := v.(type) {
		case string:
			out = append(out, t)
		case map[string]any:
			if s, ok := t["value"].(string); ok {
				out = append(out, s)
			}
		}
	}
	return out
}

// Load reads and parses <repo>/.pages.yml.
func Load(repo string) (*Schema, error) {
	b, err := os.ReadFile(filepath.Join(repo, ".pages.yml"))
	if err != nil {
		return nil, fmt.Errorf("read .pages.yml: %w", err)
	}
	return Parse(b)
}

func Parse(b []byte) (*Schema, error) {
	var r raw
	if err := yaml.Unmarshal(b, &r); err != nil {
		return nil, fmt.Errorf("parse .pages.yml: %w", err)
	}
	s := &Schema{Primary: r.Settings.Primary}
	for _, e := range r.Content {
		if e.Type != "" && e.Type != "collection" {
			continue // skip file-typed entries for now
		}
		c := Collection{
			Name:   e.Name,
			Label:  orElse(e.Label, e.Name),
			Path:   e.Path,
			Format: format(e),
			Ext:    ext(e),
		}
		for _, f := range e.Fields {
			c.Fields = append(c.Fields, Field{
				Name:     f.Name,
				Label:    orElse(f.Label, f.Name),
				Type:     orElse(f.Type, "string"),
				Required: f.Required,
				List:     f.List,
				Options:  optionValues(f),
			})
		}
		s.Collections = append(s.Collections, c)
	}
	return s, nil
}

// format resolves the storage format: explicit, else inferred from the filename
// extension (.md -> yaml-frontmatter, else yaml).
func format(e rawEntry) string {
	if e.Format != "" {
		return e.Format
	}
	if strings.HasSuffix(ext(e), ".md") {
		return "yaml-frontmatter"
	}
	return "yaml"
}

// ext resolves the file extension from the filename pattern, else from format.
func ext(e rawEntry) string {
	if e.Filename != "" {
		if i := strings.LastIndex(e.Filename, "."); i >= 0 {
			return e.Filename[i:]
		}
	}
	if e.Format == "yaml-frontmatter" {
		return ".md"
	}
	if e.Format == "yaml" {
		return ".yaml"
	}
	return ".md"
}

func orElse(v, def string) string {
	if v == "" {
		return def
	}
	return v
}
