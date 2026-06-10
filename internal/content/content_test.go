package content

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/fisherevans/scribe/internal/schema"
)

func testSchema() *schema.Schema {
	return &schema.Schema{Collections: []schema.Collection{
		{Name: "posts", Path: "src/content/posts", Format: "yaml-frontmatter", Ext: ".md", Fields: []schema.Field{
			{Name: "title", Type: "string", Required: true},
			{Name: "date", Type: "date", Required: true},
			{Name: "description", Type: "text"},
			{Name: "tags", Type: "string", List: true},
			{Name: "hasVideo", Type: "boolean"},
			{Name: "heroImage", Type: "image"},
			{Name: "updatedDate", Type: "date"},
			{Name: "draft", Type: "boolean"},
		}},
		{Name: "tags", Path: "src/content/tags", Format: "yaml", Ext: ".yaml", Fields: []schema.Field{
			{Name: "name", Type: "string", Required: true},
			{Name: "description", Type: "string"},
		}},
	}}
}

func newTestStore(t *testing.T) *Store {
	t.Helper()
	repo := t.TempDir()
	for _, p := range []string{"src/content/posts", "src/content/tags"} {
		if err := os.MkdirAll(filepath.Join(repo, p), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	return NewStore(repo, testSchema())
}

func TestPostRoundTripAndFidelity(t *testing.T) {
	s := newTestStore(t)
	in := Resource{Slug: "hello", Body: "# Hi\n\nBody text.\n", Fields: map[string]any{
		"title":       "Hello World",
		"date":        "2026-01-02",
		"description": "A description with a colon: yes",
		"tags":        []any{"alpha", "beta"},
		"hasVideo":    false,
		"updatedDate": "2026-01-03",
		"draft":       true,
	}}
	if err := s.Write("posts", in); err != nil {
		t.Fatal(err)
	}
	raw, _ := os.ReadFile(s.path(mustCol(t, s, "posts"), "hello"))
	got := string(raw)
	// Type-aware rendering: dates and booleans bare, tags a block list.
	for _, want := range []string{"date: 2026-01-02\n", "draft: true\n", "hasVideo: false\n", "tags:\n  - alpha\n  - beta\n", "updatedDate: 2026-01-03\n"} {
		if !strings.Contains(got, want) {
			t.Errorf("frontmatter missing %q\n---\n%s", want, got)
		}
	}
	// heroImage was empty/absent -> omitted.
	if strings.Contains(got, "heroImage") {
		t.Errorf("empty optional heroImage should be omitted:\n%s", got)
	}

	back, err := s.Read("posts", "hello")
	if err != nil {
		t.Fatal(err)
	}
	if back.Fields["title"] != "Hello World" || back.Fields["date"] != "2026-01-02" {
		t.Errorf("scalars not preserved: %+v", back.Fields)
	}
	if back.Fields["draft"] != true || back.Fields["hasVideo"] != false {
		t.Errorf("booleans not preserved as bool: %+v", back.Fields)
	}
	if !reflect.DeepEqual(back.Fields["tags"], []any{"alpha", "beta"}) {
		t.Errorf("tags not preserved: %#v", back.Fields["tags"])
	}
	if strings.TrimSpace(back.Body) != strings.TrimSpace(in.Body) {
		t.Errorf("body = %q", back.Body)
	}
}

func TestFrontmatterIdempotent(t *testing.T) {
	s := newTestStore(t)
	s.Write("posts", Resource{Slug: "p", Body: "x\n", Fields: map[string]any{
		"title": "T", "date": "2026-01-02", "tags": []any{"go"}, "draft": true, "hasVideo": false,
	}})
	first, _ := os.ReadFile(s.path(mustCol(t, s, "posts"), "p"))
	r, _ := s.Read("posts", "p")
	s.Write("posts", *r)
	second, _ := os.ReadFile(s.path(mustCol(t, s, "posts"), "p"))
	if string(first) != string(second) {
		t.Errorf("not idempotent:\n--first--\n%s\n--second--\n%s", first, second)
	}
}

func TestUnknownFieldPreserved(t *testing.T) {
	s := newTestStore(t)
	s.Write("posts", Resource{Slug: "p", Body: "x", Fields: map[string]any{
		"title": "T", "date": "2026-01-02", "hasVideo": false, "draft": false,
		"coAuthor": "Lisa", // not in schema
	}})
	r, _ := s.Read("posts", "p")
	if r.Fields["coAuthor"] != "Lisa" {
		t.Errorf("unknown field dropped: %+v", r.Fields)
	}
}

func TestYamlCollection(t *testing.T) {
	s := newTestStore(t)
	if err := s.Write("tags", Resource{Slug: "go", Fields: map[string]any{"name": "Go", "description": "the language"}}); err != nil {
		t.Fatal(err)
	}
	raw, _ := os.ReadFile(s.path(mustCol(t, s, "tags"), "go"))
	if strings.Contains(string(raw), "---") {
		t.Errorf("yaml collection should have no frontmatter fence:\n%s", raw)
	}
	r, _ := s.Read("tags", "go")
	if r.Fields["name"] != "Go" || r.Body != "" {
		t.Errorf("tag round-trip: %+v body=%q", r.Fields, r.Body)
	}
}

func TestRenameAndDelete(t *testing.T) {
	s := newTestStore(t)
	s.Write("posts", Resource{Slug: "old", Fields: map[string]any{"title": "T", "date": "2026-01-02", "hasVideo": false, "draft": false}})
	if err := s.Rename("posts", "old", "new"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(s.path(mustCol(t, s, "posts"), "old")); !os.IsNotExist(err) {
		t.Error("old file remains after rename")
	}
	s.Write("posts", Resource{Slug: "other", Fields: map[string]any{"title": "O", "date": "2026-01-02", "hasVideo": false, "draft": false}})
	if err := s.Rename("posts", "new", "other"); err == nil {
		t.Error("expected collision error")
	}
	if err := s.Delete("posts", "new"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(s.path(mustCol(t, s, "posts"), "new")); !os.IsNotExist(err) {
		t.Error("file remains after delete")
	}
}

func TestReadCacheNeverServesStaleOrCorrupt(t *testing.T) {
	s := newTestStore(t)
	in := Resource{Slug: "p", Fields: map[string]any{"title": "Two", "date": "2026-01-01"}, Body: "a\n"}
	if err := s.Write("posts", in); err != nil {
		t.Fatal(err)
	}

	// First read populates the cache.
	r1, err := s.Read("posts", "p")
	if err != nil {
		t.Fatal(err)
	}
	if r1.Fields["title"] != "Two" {
		t.Fatalf("title = %v", r1.Fields["title"])
	}

	// Mutating the returned copy must not poison the cache.
	r1.Fields["title"] = "MUT"
	if r2, _ := s.Read("posts", "p"); r2.Fields["title"] != "Two" {
		t.Fatalf("caller mutation leaked into cache: %v", r2.Fields["title"])
	}

	// A scribe write is reflected on the next read (explicit invalidation).
	in.Fields["title"] = "Three"
	if err := s.Write("posts", in); err != nil {
		t.Fatal(err)
	}
	if r3, _ := s.Read("posts", "p"); r3.Fields["title"] != "Three" {
		t.Fatalf("write not reflected: %v", r3.Fields["title"])
	}

	// An external, same-size change (git reset / Pages CMS) with a different
	// mtime is reflected - the mtime check catches it even when size matches.
	path := s.path(mustCol(t, s, "posts"), "p")
	raw, _ := os.ReadFile(path)
	swapped := strings.Replace(string(raw), "Three", "Tlhre", 1) // same length
	if swapped == string(raw) {
		t.Fatal("test setup: replacement did not change content")
	}
	if err := os.WriteFile(path, []byte(swapped), 0o644); err != nil {
		t.Fatal(err)
	}
	future := time.Now().Add(3 * time.Second)
	if err := os.Chtimes(path, future, future); err != nil {
		t.Fatal(err)
	}
	if r4, _ := s.Read("posts", "p"); r4.Fields["title"] != "Tlhre" {
		t.Fatalf("external change not reflected: %v", r4.Fields["title"])
	}
}

func mustCol(t *testing.T, s *Store, name string) *schema.Collection {
	t.Helper()
	c, err := s.collection(name)
	if err != nil {
		t.Fatal(err)
	}
	return c
}
