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
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"math/big"
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

// ErrConflict is returned by Write when the on-disk file changed since the
// version the caller based its edit on - i.e. someone else (another tab, device,
// or an external/git edit) wrote it in the meantime. The caller should not have
// clobbered it; surface a conflict instead.
var ErrConflict = errors.New("file changed on disk since it was read")

// version is a short content hash identifying an exact on-disk file state. Used
// for optimistic-concurrency checks on write.
func version(raw []byte) string {
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:8]) // 64 bits, ample to detect a change
}

// Resource is a single piece of content: its slug, its frontmatter fields as an
// open map, and an optional markdown body (empty for yaml-only collections).
type Resource struct {
	Slug   string         `json:"slug"`
	Fields map[string]any `json:"fields"`
	Body   string         `json:"body"`
	// Version is a content hash of the on-disk file at read time. The client
	// echoes it on save; Write rejects the save (ErrConflict) if the file no
	// longer matches. Empty means "no base" (a new file, or a forced overwrite).
	Version string `json:"version"`
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
	// Files List last skipped, keyed by repo-relative path -> the error string
	// already logged for them, so a polled list doesn't repeat the same warning.
	warned map[string]string

	log *slog.Logger // nil = slog.Default()
}

type cached struct {
	mod  time.Time
	size int64
	res  Resource
}

func NewStore(repo string, s *schema.Schema) *Store {
	return &Store{repo: repo, schema: s, cache: map[string]cached{}, warned: map[string]string{}}
}

// SetLogger directs the store's warnings (skipped files) at the service's
// logger. Unset, it falls back to slog.Default().
func (s *Store) SetLogger(l *slog.Logger) { s.log = l }

func (s *Store) logger() *slog.Logger {
	if s.log != nil {
		return s.log
	}
	return slog.Default()
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

// Problem is one file in a collection that could not be read or parsed. List
// skips it and reports it rather than failing the whole collection: a single
// bad escape in one note used to take the whole editor down.
type Problem struct {
	Slug  string `json:"slug"`
	Path  string `json:"path"` // repo-relative, so a message can name the file to fix
	Error string `json:"error"`
}

// List returns every readable resource in a collection plus the files it had to
// skip. The error return is reserved for collection-level failures (unknown
// collection, unreadable directory) - a per-file failure is a Problem, never an
// error, so one unparseable file can't hide the other ninety.
func (s *Store) List(name string) ([]Resource, []Problem, error) {
	c, err := s.collection(name)
	if err != nil {
		return nil, nil, err
	}
	entries, err := os.ReadDir(s.dir(c))
	if err != nil {
		return nil, nil, fmt.Errorf("read %s dir: %w", name, err)
	}
	var out []Resource
	var problems []Problem
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), c.Ext) {
			continue
		}
		slug := strings.TrimSuffix(e.Name(), c.Ext)
		r, err := s.Read(name, slug)
		if err != nil {
			rel := filepath.ToSlash(filepath.Join(c.Path, e.Name()))
			problems = append(problems, Problem{Slug: slug, Path: rel, Error: err.Error()})
			s.warnSkipped(rel, err)
			continue
		}
		s.clearWarned(filepath.ToSlash(filepath.Join(c.Path, e.Name())))
		out = append(out, *r)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Slug < out[j].Slug })
	sort.Slice(problems, func(i, j int) bool { return problems[i].Slug < problems[j].Slug })
	return out, problems, nil
}

// warnSkipped logs a skipped file once per distinct error. The list is polled,
// so logging unconditionally would repeat the same line forever; re-logging on a
// *changed* error still shows a half-fixed file moving.
func (s *Store) warnSkipped(rel string, err error) {
	msg := err.Error()
	s.mu.Lock()
	seen := s.warned[rel] == msg
	s.warned[rel] = msg
	s.mu.Unlock()
	if !seen {
		s.logger().Warn("skipping unreadable content file", "path", rel, "err", msg)
	}
}

func (s *Store) clearWarned(rel string) {
	s.mu.Lock()
	_, had := s.warned[rel]
	if had {
		delete(s.warned, rel)
	}
	s.mu.Unlock()
	if had {
		s.logger().Info("content file reads again", "path", rel)
	}
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
	res := Resource{Slug: slug, Fields: fields, Body: body, Version: version(raw)}

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
	return Resource{Slug: r.Slug, Fields: f, Body: r.Body, Version: r.Version}
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
	// Entries of an id-bearing collection get an immutable `id`, minted once on
	// first save. Downstream systems (e.g. the blog's comment store) key on this
	// id rather than the slug, so a thread survives a rename/URL change. Only the
	// persisting Write path mints (not Serialize), so a preview never churns it.
	if s.mintsID(name) && !hasStableID(r.Fields) {
		if r.Fields == nil {
			r.Fields = map[string]any{}
		}
		r.Fields["id"] = mintID()
	}
	out, err := s.build(c, r)
	if err != nil {
		return err
	}
	path := s.path(c, r.Slug)
	// Optimistic concurrency: when the caller based its edit on a known version,
	// refuse to write if the file changed underneath (a concurrent writer). An
	// empty Version skips the check (new file, or a deliberate overwrite).
	if r.Version != "" {
		if cur, e := os.ReadFile(path); e == nil && version(cur) != r.Version {
			return ErrConflict
		}
	}
	if err := os.WriteFile(path, out, 0o644); err != nil {
		return err
	}
	s.invalidate(path)
	return nil
}

// ParseRaw parses raw file bytes (as stored on disk, e.g. pulled from git for a
// historical version) into a Resource for collection name - the same split +
// field parse that Read does, but against bytes instead of a working-tree file.
// Slug is left empty for the caller to set.
func (s *Store) ParseRaw(name string, raw []byte) (*Resource, error) {
	c, err := s.collection(name)
	if err != nil {
		return nil, err
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
		return nil, fmt.Errorf("parse raw %s: %w", name, err)
	}
	return &Resource{Fields: fields, Body: body, Version: version(raw)}, nil
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
		// A list of objects - a note's `images: [{src, alt}]`, say - cannot be
		// rendered item by item: fmt.Sprint on a map yields `map[alt:x src:y]`,
		// which is not YAML and silently destroys the value on first save. Hand
		// the whole field to the marshaller instead.
		for _, it := range items {
			if !isScalarValue(it) {
				return renderUnknown(f.Name, items)
			}
		}
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

// renderUnknown emits a field via the YAML marshaller - used both for fields the
// schema doesn't describe and for declared fields too structured to render by
// hand (see renderField). Indented to 2 so it matches the lists renderField
// writes, rather than yaml.v3's default of 4 in the same frontmatter block.
func renderUnknown(k string, v any) string {
	var b strings.Builder
	enc := yaml.NewEncoder(&b)
	enc.SetIndent(2)
	if err := enc.Encode(map[string]any{k: v}); err != nil {
		return ""
	}
	_ = enc.Close()
	return b.String()
}

// isScalarValue reports whether a value renders as a single YAML scalar.
func isScalarValue(v any) bool {
	switch v.(type) {
	case map[string]any, map[any]any, []any:
		return false
	}
	return true
}

// ---- stable id ----------------------------------------------------------

// mintsID reports whether a collection's entries get a minted stable id. Two
// ways in: the collection is settings.primary, or it declares an `id` field.
//
// The second is how a site opts a SECOND collection in without a new config
// concept - a blog whose notes also carry comments declares `id` on notes, and
// says nothing else. Before this, only the primary collection minted, so every
// note saved from scribe arrived without one and the site's build refused it.
func (s *Store) mintsID(name string) bool {
	if name == s.schema.Primary {
		return true
	}
	c, ok := s.schema.Collection(name)
	if !ok {
		return false
	}
	_, declared := c.Field("id")
	return declared
}

// Stable-id alphabet: URL-safe and unambiguous. The first character is always a
// letter so the value never parses as a YAML number and round-trips unquoted.
const (
	idFirst = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
	idRest  = idFirst + "0123456789"
	idLen   = 10
)

// hasStableID reports whether fields already carry a non-empty `id`.
func hasStableID(fields map[string]any) bool {
	v, ok := fields["id"]
	if !ok {
		return false
	}
	str, _ := v.(string)
	return strings.TrimSpace(str) != ""
}

// mintID generates a fresh stable id. Matches tools/backfill-post-ids.mjs in the
// blog repo (letter-led, 10 chars) so minted and backfilled ids are uniform.
func mintID() string {
	b := make([]byte, idLen)
	b[0] = idFirst[randIndex(len(idFirst))]
	for i := 1; i < idLen; i++ {
		b[i] = idRest[randIndex(len(idRest))]
	}
	return string(b)
}

// randIndex returns a uniform random index in [0,n) from crypto/rand. A failure
// of the system CSPRNG is unrecoverable, so it panics rather than return a
// biased or zero value.
func randIndex(n int) int {
	v, err := rand.Int(rand.Reader, big.NewInt(int64(n)))
	if err != nil {
		panic(fmt.Sprintf("content: crypto/rand failed: %v", err))
	}
	return int(v.Int64())
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
