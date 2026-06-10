// Package content reads and writes a site's on-disk content generically, driven
// by the parsed schema (internal/schema). A resource is {slug, fields, body}:
// frontmatter as an open map plus an optional markdown body. Any collection the
// schema describes can be read/written; fields scribe doesn't recognize are
// preserved verbatim.
//
// Frontmatter is re-emitted in schema-field order with type-aware rendering
// (dates and booleans bare, lists as block sequences), so known collections
// round-trip byte-stable. The body passes through untouched.
package content

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/fisherevans/scribe/internal/schema"
	"gopkg.in/yaml.v3"
)

// Resource is a single piece of content: its slug, its frontmatter fields as an
// open map, and an optional markdown body (empty for yaml-only collections).
type Resource struct {
	Slug   string         `json:"slug"`
	Fields map[string]any `json:"fields"`
	Body   string         `json:"body"`
}

// Store is rooted at a blog repo checkout and driven by its schema.
type Store struct {
	repo   string
	schema *schema.Schema

	// Parsed-resource cache, keyed by absolute file path and validated by the
	// file's mtime+size, so a list doesn't re-read and re-parse every file on
	// every request. Self-invalidating on any on-disk change (scribe writes, git
	// resets/rebases, external edits); scribe's own writes also invalidate
	// explicitly to cover coarse-mtime filesystems.
	mu    sync.Mutex
	cache map[string]cached
}

type cached struct {
	mod  time.Time
	size int64
	res  Resource
}

func NewStore(repo string, s *schema.Schema) *Store {
	return &Store{repo: repo, schema: s, cache: map[string]cached{}}
}

func (s *Store) Schema() *schema.Schema { return s.schema }

// Root is the blog repo checkout the store is rooted at. Callers that need to
// resolve paths outside the content tree (e.g. media uploads) use this.
func (s *Store) Root() string { return s.repo }

func (s *Store) collection(name string) (*schema.Collection, error) {
	c, ok := s.schema.Collection(name)
	if !ok {
		return nil, fmt.Errorf("unknown collection %q", name)
	}
	return c, nil
}

func (s *Store) dir(c *schema.Collection) string { return filepath.Join(s.repo, c.Path) }
func (s *Store) path(c *schema.Collection, slug string) string {
	return filepath.Join(s.dir(c), slug+c.Ext)
}

// RelPath is the resource's path relative to the repo root (what git operates
// on), e.g. "src/content/posts/calsync.md". It's a pure schema computation and
// doesn't require the file to exist.
func (s *Store) RelPath(collection, slug string) (string, error) {
	c, err := s.collection(collection)
	if err != nil {
		return "", err
	}
	return filepath.Join(c.Path, slug+c.Ext), nil
}

// ResolvePath maps a repo-relative path back to its (collection, slug), the
// inverse of RelPath. Returns ok=false for paths outside any collection dir
// (assets, config, etc.). Used to translate a git changeset into resources.
func (s *Store) ResolvePath(rel string) (collection, slug string, ok bool) {
	rel = filepath.ToSlash(rel)
	for _, c := range s.schema.Collections {
		dir := filepath.ToSlash(c.Path) + "/"
		if !strings.HasPrefix(rel, dir) || !strings.HasSuffix(rel, c.Ext) {
			continue
		}
		name := strings.TrimSuffix(strings.TrimPrefix(rel, dir), c.Ext)
		if name == "" || strings.Contains(name, "/") {
			continue // nested dirs aren't slugs in this model
		}
		return c.Name, name, true
	}
	return "", "", false
}

// ---- read ---------------------------------------------------------------

func (s *Store) List(name string) ([]Resource, error) {
	c, err := s.collection(name)
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(s.dir(c))
	if err != nil {
		return nil, fmt.Errorf("read %s dir: %w", name, err)
	}
	var out []Resource
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), c.Ext) {
			continue
		}
		slug := strings.TrimSuffix(e.Name(), c.Ext)
		r, err := s.Read(name, slug)
		if err != nil {
			return nil, err
		}
		out = append(out, *r)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Slug < out[j].Slug })
	return out, nil
}

func (s *Store) Read(name, slug string) (*Resource, error) {
	c, err := s.collection(name)
	if err != nil {
		return nil, err
	}
	path := s.path(c, slug)
	// Stat before reading: if the cached entry matches the current mtime+size,
	// skip the read+parse. Stat is one cheap call vs an open+read of the whole
	// file (the win on an NFS-backed tree).
	fi, err := os.Stat(path)
	if err != nil {
		return nil, fmt.Errorf("read %s/%s: %w", name, slug, err)
	}
	s.mu.Lock()
	if e, ok := s.cache[path]; ok && e.size == fi.Size() && e.mod.Equal(fi.ModTime()) {
		res := e.res.clone()
		s.mu.Unlock()
		return &res, nil
	}
	s.mu.Unlock()

	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read %s/%s: %w", name, slug, err)
	}
	var frontBytes []byte
	var body string
	if c.Format == "yaml-frontmatter" {
		frontBytes, body = splitFrontmatter(raw)
	} else {
		frontBytes = raw
	}
	fields, err := parseFields(c, frontBytes)
	if err != nil {
		return nil, fmt.Errorf("parse %s/%s: %w", name, slug, err)
	}
	res := Resource{Slug: slug, Fields: fields, Body: body}

	// Cache owns its own copy; every caller gets an independent clone so a
	// mutation can't corrupt the cache.
	s.mu.Lock()
	s.cache[path] = cached{mod: fi.ModTime(), size: fi.Size(), res: res.clone()}
	s.mu.Unlock()
	return &res, nil
}

// clone returns a copy with an independent top-level Fields map. Field values
// (strings, bools, numbers, and slices/maps from JSON) are not mutated in place
// by callers, so a shallow field copy is sufficient.
func (r Resource) clone() Resource {
	f := make(map[string]any, len(r.Fields))
	for k, v := range r.Fields {
		f[k] = v
	}
	return Resource{Slug: r.Slug, Fields: f, Body: r.Body}
}

// invalidate drops the cache entry for a path after scribe writes/moves/removes
// it, so the next Read re-parses even on a filesystem whose mtime resolution is
// too coarse to notice a same-second rewrite.
func (s *Store) invalidate(path string) {
	s.mu.Lock()
	delete(s.cache, path)
	s.mu.Unlock()
}

// ---- write --------------------------------------------------------------

func (s *Store) Write(name string, r Resource) error {
	c, err := s.collection(name)
	if err != nil {
		return err
	}
	out, err := s.build(c, r)
	if err != nil {
		return err
	}
	path := s.path(c, r.Slug)
	if err := os.WriteFile(path, out, 0o644); err != nil {
		return err
	}
	s.invalidate(path)
	return nil
}

// Serialize returns the bytes Write would produce, without touching disk.
func (s *Store) Serialize(name string, r Resource) ([]byte, error) {
	c, err := s.collection(name)
	if err != nil {
		return nil, err
	}
	return s.build(c, r)
}

func (s *Store) build(c *schema.Collection, r Resource) ([]byte, error) {
	front := renderFields(c, r.Fields)
	var out string
	if c.Format == "yaml-frontmatter" {
		out = "---\n" + front + "---\n" + strings.TrimLeft(r.Body, "\n")
	} else {
		out = front
	}
	if !strings.HasSuffix(out, "\n") {
		out += "\n"
	}
	return []byte(out), nil
}

func (s *Store) Rename(name, from, to string) error {
	c, err := s.collection(name)
	if err != nil {
		return err
	}
	src, dst := s.path(c, from), s.path(c, to)
	if _, err := os.Stat(dst); err == nil {
		return fmt.Errorf("%q already exists in %s", to, name)
	}
	if _, err := os.Stat(src); os.IsNotExist(err) {
		return nil // unsaved draft
	}
	if err := os.Rename(src, dst); err != nil {
		return err
	}
	s.invalidate(src)
	s.invalidate(dst)
	return nil
}

func (s *Store) Delete(name, slug string) error {
	c, err := s.collection(name)
	if err != nil {
		return err
	}
	path := s.path(c, slug)
	err = os.Remove(path)
	s.invalidate(path)
	if os.IsNotExist(err) {
		return nil
	}
	return err
}

// ---- frontmatter parsing (YAML -> typed fields) ------------------------

// parseFields decodes a YAML mapping into an open field map, using the schema's
// field types so dates stay strings (not coerced to timestamps), booleans are
// bools, and lists are string slices. Unknown fields are kept, typed from their
// YAML tag.
func parseFields(c *schema.Collection, front []byte) (map[string]any, error) {
	fields := map[string]any{}
	if len(front) == 0 {
		return fields, nil
	}
	var doc yaml.Node
	if err := yaml.Unmarshal(front, &doc); err != nil {
		return nil, err
	}
	if len(doc.Content) == 0 || doc.Content[0].Kind != yaml.MappingNode {
		return fields, nil
	}
	m := doc.Content[0]
	for i := 0; i+1 < len(m.Content); i += 2 {
		key := m.Content[i].Value
		val := m.Content[i+1]
		var ftype string
		if f, ok := c.Field(key); ok {
			ftype = f.Type
		}
		fields[key] = nodeToValue(val, ftype)
	}
	return fields, nil
}

// nodeToValue converts a YAML node to a JSON-friendly Go value. ftype (the
// schema field type, may be "") biases scalar handling; dates and timestamps
// always stay strings.
func nodeToValue(n *yaml.Node, ftype string) any {
	switch n.Kind {
	case yaml.SequenceNode:
		out := make([]any, 0, len(n.Content))
		for _, c := range n.Content {
			out = append(out, nodeToValue(c, ""))
		}
		return out
	case yaml.MappingNode:
		out := map[string]any{}
		for i := 0; i+1 < len(n.Content); i += 2 {
			out[n.Content[i].Value] = nodeToValue(n.Content[i+1], "")
		}
		return out
	default: // scalar
		switch ftype {
		case "boolean":
			b, _ := strconv.ParseBool(n.Value)
			return b
		case "number":
			f, _ := strconv.ParseFloat(n.Value, 64)
			return f
		case "date", "string", "text", "image", "select", "rich-text", "code":
			return n.Value
		}
		// unknown field: type from the YAML tag, but never coerce timestamps.
		switch n.Tag {
		case "!!bool":
			b, _ := strconv.ParseBool(n.Value)
			return b
		case "!!int", "!!float":
			f, _ := strconv.ParseFloat(n.Value, 64)
			return f
		default:
			return n.Value
		}
	}
}

// ---- frontmatter rendering (typed fields -> YAML) ----------------------

// renderFields emits schema fields in declared order, then any extra fields
// (preserved, sorted), with type-aware formatting.
func renderFields(c *schema.Collection, fields map[string]any) string {
	var b strings.Builder
	seen := map[string]bool{}
	for _, f := range c.Fields {
		seen[f.Name] = true
		v, ok := fields[f.Name]
		if !emit(f, v, ok) {
			continue
		}
		b.WriteString(renderField(f, v))
	}
	// Extra fields not in the schema - preserve them.
	var extra []string
	for k := range fields {
		if !seen[k] {
			extra = append(extra, k)
		}
	}
	sort.Strings(extra)
	for _, k := range extra {
		b.WriteString(renderUnknown(k, fields[k]))
	}
	return b.String()
}

// emit decides whether a known field is written: required and boolean fields
// always render; optional fields render only when non-empty (matching the
// hand-written frontmatter's omit-empty behavior).
func emit(f schema.Field, v any, present bool) bool {
	if f.Required || f.Type == "boolean" {
		return true
	}
	return present && !isEmpty(v)
}

func renderField(f schema.Field, v any) string {
	if f.List {
		items := toSlice(v)
		var b strings.Builder
		b.WriteString(f.Name + ":\n")
		for _, it := range items {
			b.WriteString("  - " + scalar(fmt.Sprint(it)) + "\n")
		}
		return b.String()
	}
	switch f.Type {
	case "boolean":
		return fmt.Sprintf("%s: %t\n", f.Name, truth(v))
	case "date", "number":
		return f.Name + ": " + fmt.Sprint(v) + "\n" // bare
	default:
		return f.Name + ": " + scalar(fmt.Sprint(v)) + "\n"
	}
}

// renderUnknown preserves a field the schema doesn't describe via yaml.Marshal.
func renderUnknown(k string, v any) string {
	out, err := yaml.Marshal(map[string]any{k: v})
	if err != nil {
		return ""
	}
	return string(out)
}

// ---- helpers ------------------------------------------------------------

func splitFrontmatter(raw []byte) (front []byte, body string) {
	s := string(raw)
	if !strings.HasPrefix(s, "---\n") && !strings.HasPrefix(s, "---\r\n") {
		return nil, s
	}
	rest := s[strings.IndexByte(s, '\n')+1:]
	end := strings.Index(rest, "\n---")
	if end < 0 {
		return nil, s
	}
	front = []byte(rest[:end+1])
	after := rest[end+len("\n---"):]
	after = strings.TrimPrefix(after, "\r")
	after = strings.TrimPrefix(after, "\n")
	return front, strings.TrimLeft(after, "\n")
}

func isEmpty(v any) bool {
	switch t := v.(type) {
	case nil:
		return true
	case string:
		return t == ""
	case []any:
		return len(t) == 0
	case map[string]any:
		return len(t) == 0
	}
	return false
}

func toSlice(v any) []any {
	if s, ok := v.([]any); ok {
		return s
	}
	return nil
}

func truth(v any) bool {
	b, _ := v.(bool)
	return b
}

// scalar quotes a string only when YAML would otherwise misread it, using
// yaml.v3 to do the escaping, then stripping the trailing newline.
func scalar(v string) string {
	out, err := yaml.Marshal(v)
	if err != nil {
		return fmt.Sprintf("%q", v)
	}
	return strings.TrimRight(string(out), "\n")
}
