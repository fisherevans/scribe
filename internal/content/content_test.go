package content

import (
	"errors"
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

func TestWriteConflictDetection(t *testing.T) {
	s := newTestStore(t)
	base := Resource{Slug: "p", Fields: map[string]any{"title": "One", "date": "2026-01-01"}, Body: "a\n"}
	if err := s.Write("posts", base); err != nil {
		t.Fatal(err)
	}
	loaded, err := s.Read("posts", "p")
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Version == "" {
		t.Fatal("expected a version on read")
	}

	// A concurrent writer changes the file out from under us.
	other := Resource{Slug: "p", Fields: map[string]any{"title": "Theirs", "date": "2026-01-01"}, Body: "b\n"}
	if err := s.Write("posts", other); err != nil { // no Version -> unchecked write
		t.Fatal(err)
	}

	// Saving with the now-stale base version must be refused.
	stale := *loaded
	stale.Fields = map[string]any{"title": "Mine", "date": "2026-01-01"}
	stale.Body = "c\n"
	if err := s.Write("posts", stale); !errors.Is(err, ErrConflict) {
		t.Fatalf("expected ErrConflict, got %v", err)
	}

	// Clearing the version forces the overwrite through.
	stale.Version = ""
	if err := s.Write("posts", stale); err != nil {
		t.Fatalf("forced overwrite should succeed, got %v", err)
	}
	if got, _ := s.Read("posts", "p"); got.Fields["title"] != "Mine" {
		t.Fatalf("overwrite not applied: %v", got.Fields["title"])
	}
}

// One unparseable file must not hide the rest of the collection. This is the
// bug that took scribe down: a note whose alt text carried a `\uD83D` surrogate
// escape (valid to js-yaml, rejected by yaml.v3) made List fail outright, and
// the editor showed its crash screen instead of the other ninety notes.
func TestListSkipsUnreadableFiles(t *testing.T) {
	s := newTestStore(t)
	dir := filepath.Join(s.repo, "src/content/posts")
	good := "---\ntitle: Fine\ndate: 2026-01-01\n---\n\nBody.\n"
	bad := "---\ntitle: \"emoji \\uD83D\\uDE05\"\ndate: 2026-01-02\n---\n\nBody.\n"
	write := func(name, content string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("alpha.md", good)
	write("broken.md", bad)
	write("zeta.md", good)

	got, problems, err := s.List("posts")
	if err != nil {
		t.Fatalf("List should not fail on a bad file, got %v", err)
	}
	var slugs []string
	for _, r := range got {
		slugs = append(slugs, r.Slug)
	}
	if !reflect.DeepEqual(slugs, []string{"alpha", "zeta"}) {
		t.Fatalf("readable resources = %v, want [alpha zeta]", slugs)
	}
	if len(problems) != 1 {
		t.Fatalf("problems = %v, want exactly one", problems)
	}
	p := problems[0]
	if p.Slug != "broken" {
		t.Errorf("problem slug = %q, want %q", p.Slug, "broken")
	}
	if p.Path != "src/content/posts/broken.md" {
		t.Errorf("problem path = %q, want the repo-relative file", p.Path)
	}
	// The message has to name the file and say what yaml objected to - it is
	// what the editor shows and the only clue to what needs fixing.
	if !strings.Contains(p.Error, "parse posts/broken") || !strings.Contains(p.Error, "yaml") {
		t.Errorf("problem error = %q, want the parse error for the file", p.Error)
	}

	// Fixing the file clears it from both lists.
	write("broken.md", good)
	got, problems, err = s.List("posts")
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 3 || len(problems) != 0 {
		t.Fatalf("after the fix: %d resources, %d problems; want 3 and 0", len(got), len(problems))
	}
}

// A collection-level failure is still an error: an unknown collection or a
// missing directory is not something the editor can show a partial list for.
func TestListFailsOnMissingCollection(t *testing.T) {
	s := newTestStore(t)
	if _, _, err := s.List("nope"); err == nil {
		t.Fatal("expected an error for an unknown collection")
	}
	if err := os.RemoveAll(filepath.Join(s.repo, "src/content/tags")); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.List("tags"); err == nil {
		t.Fatal("expected an error for a missing collection dir")
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

// A field added to .pages.yml after the store was built has to become visible
// without a process restart - the whole point of reloading the schema on sync.
func TestReloadSchemaPicksUpANewField(t *testing.T) {
	repo := t.TempDir()
	if err := os.MkdirAll(filepath.Join(repo, "src/content/posts"), 0o755); err != nil {
		t.Fatal(err)
	}
	pages := filepath.Join(repo, ".pages.yml")
	write := func(extra string) {
		t.Helper()
		body := `content:
  - name: posts
    path: src/content/posts
    type: collection
    format: yaml-frontmatter
    filename: '{primary}.md'
    fields:
      - name: title
        type: string
      - name: draft
        type: boolean
` + extra
		if err := os.WriteFile(pages, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	write("")
	sch, err := schema.Load(repo)
	if err != nil {
		t.Fatal(err)
	}
	s := NewStore(repo, sch)
	if c, _ := s.Schema().Collection("posts"); len(c.Fields) != 2 {
		t.Fatalf("baseline: want 2 fields, got %d", len(c.Fields))
	}

	// Nothing changed on disk: a reload must be a no-op, not a reparse.
	if changed, err := s.ReloadSchema(); err != nil || changed {
		t.Fatalf("unchanged .pages.yml: got changed=%v err=%v, want false/nil", changed, err)
	}

	write("      - name: featured\n        label: Featured on the home page\n        type: boolean\n")
	changed, err := s.ReloadSchema()
	if err != nil {
		t.Fatal(err)
	}
	if !changed {
		t.Fatal("a rewritten .pages.yml should report the schema as changed")
	}
	c, ok := s.Schema().Collection("posts")
	if !ok {
		t.Fatal("posts collection vanished after reload")
	}
	f, ok := c.Field("featured")
	if !ok {
		t.Fatalf("featured not visible after reload; fields=%v", c.Fields)
	}
	if f.Type != "boolean" || f.Label != "Featured on the home page" {
		t.Errorf("featured parsed wrong: %+v", f)
	}
}

// The parsed-resource cache is keyed on the file, not the schema, so a schema
// swap has to clear it - otherwise a newly declared field keeps rendering with
// the old type (or not at all) until the file is touched.
func TestReloadSchemaInvalidatesTheResourceCache(t *testing.T) {
	repo := t.TempDir()
	if err := os.MkdirAll(filepath.Join(repo, "src/content/posts"), 0o755); err != nil {
		t.Fatal(err)
	}
	pages := func(extra string) {
		t.Helper()
		body := `content:
  - name: posts
    path: src/content/posts
    type: collection
    format: yaml-frontmatter
    filename: '{primary}.md'
    fields:
      - name: title
        type: string
` + extra
		if err := os.WriteFile(filepath.Join(repo, ".pages.yml"), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	pages("")
	sch, err := schema.Load(repo)
	if err != nil {
		t.Fatal(err)
	}
	s := NewStore(repo, sch)

	post := "---\ntitle: Hello\nfeatured: true\n---\n\nBody.\n"
	if err := os.WriteFile(filepath.Join(repo, "src/content/posts/hello.md"), []byte(post), 0o644); err != nil {
		t.Fatal(err)
	}
	// Prime the cache while `featured` is an undeclared extra field.
	if _, err := s.Read("posts", "hello"); err != nil {
		t.Fatal(err)
	}
	s.mu.Lock()
	cached := len(s.cache)
	s.mu.Unlock()
	if cached == 0 {
		t.Fatal("expected the read to populate the cache")
	}

	pages("      - name: featured\n        type: boolean\n")
	if changed, err := s.ReloadSchema(); err != nil || !changed {
		t.Fatalf("got changed=%v err=%v, want true/nil", changed, err)
	}
	s.mu.Lock()
	cached = len(s.cache)
	s.mu.Unlock()
	if cached != 0 {
		t.Fatalf("schema swap left %d cached resources", cached)
	}
	// And the declared boolean now renders bare rather than as a preserved extra.
	r, err := s.Read("posts", "hello")
	if err != nil {
		t.Fatal(err)
	}
	if r.Fields["featured"] != true {
		t.Errorf("featured = %#v, want true", r.Fields["featured"])
	}
}
