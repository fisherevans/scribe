package content

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/fisherevans/scribe/internal/schema"
)

// primarySchema mirrors testSchema but declares posts as the primary collection,
// which is what gates stable-id minting.
func primarySchema() *schema.Schema {
	s := testSchema()
	s.Primary = "posts"
	return s
}

func newPrimaryStore(t *testing.T) *Store {
	t.Helper()
	s := newTestStore(t)
	s.schema = primarySchema()
	return s
}

var idPattern = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9]{9}$`)

func TestMintIDFormat(t *testing.T) {
	seen := map[string]bool{}
	for i := 0; i < 1000; i++ {
		id := mintID()
		if !idPattern.MatchString(id) {
			t.Fatalf("id %q does not match %s", id, idPattern)
		}
		if seen[id] {
			t.Fatalf("duplicate id %q within 1000 draws", id)
		}
		seen[id] = true
	}
}

func TestWriteMintsStableIDForPrimary(t *testing.T) {
	s := newPrimaryStore(t)
	if err := s.Write("posts", Resource{Slug: "p", Body: "x\n", Fields: map[string]any{
		"title": "T", "date": "2026-01-02", "hasVideo": false, "draft": false,
	}}); err != nil {
		t.Fatal(err)
	}
	r, _ := s.Read("posts", "p")
	id, _ := r.Fields["id"].(string)
	if !idPattern.MatchString(id) {
		t.Fatalf("expected a minted id, got %q (fields=%+v)", id, r.Fields)
	}

	// Re-save preserves the id (immutable, minted once).
	if err := s.Write("posts", *r); err != nil {
		t.Fatal(err)
	}
	r2, _ := s.Read("posts", "p")
	if r2.Fields["id"] != id {
		t.Fatalf("id changed on re-save: %q -> %v", id, r2.Fields["id"])
	}
}

func TestWritePreservesProvidedID(t *testing.T) {
	s := newPrimaryStore(t)
	if err := s.Write("posts", Resource{Slug: "p", Body: "x\n", Fields: map[string]any{
		"id": "Keepthis01", "title": "T", "date": "2026-01-02", "hasVideo": false, "draft": false,
	}}); err != nil {
		t.Fatal(err)
	}
	r, _ := s.Read("posts", "p")
	if r.Fields["id"] != "Keepthis01" {
		t.Fatalf("provided id not preserved: %v", r.Fields["id"])
	}
}

func TestWriteNoMintForNonPrimary(t *testing.T) {
	s := newPrimaryStore(t) // primary is "posts"; tags is not primary
	if err := s.Write("tags", Resource{Slug: "go", Fields: map[string]any{
		"name": "Go", "description": "the language",
	}}); err != nil {
		t.Fatal(err)
	}
	raw, _ := os.ReadFile(s.path(mustCol(t, s, "tags"), "go"))
	if idPattern.MatchString("") { // guard against accidental always-true
		t.Fatal("pattern misconfigured")
	}
	r, _ := s.Read("tags", "go")
	if _, ok := r.Fields["id"]; ok {
		t.Fatalf("non-primary collection should not get a minted id:\n%s", raw)
	}
}

// notesSchema adds a second collection that declares an `id` field - the way a
// site opts a non-primary collection into stable ids - plus a list-of-objects
// field, which is the other thing that used to break on save.
func notesSchema() *schema.Schema {
	s := primarySchema()
	s.Collections = append(s.Collections, schema.Collection{
		Name: "notes", Path: "src/content/notes", Format: "yaml-frontmatter", Ext: ".md",
		Fields: []schema.Field{
			{Name: "id", Type: "string"},
			{Name: "date", Type: "date", Required: true},
			{Name: "tags", Type: "string", List: true},
			{Name: "images", Type: "object", List: true},
			{Name: "draft", Type: "boolean"},
		},
	})
	return s
}

func newNotesStore(t *testing.T) *Store {
	t.Helper()
	s := newTestStore(t)
	s.schema = notesSchema()
	if err := os.MkdirAll(filepath.Join(s.repo, "src/content/notes"), 0o755); err != nil {
		t.Fatal(err)
	}
	return s
}

// A collection that declares `id` mints one even though it is not primary.
// Before this, only settings.primary minted, so every note saved from scribe
// arrived without an id and the site's build refused to publish it.
func TestDeclaredIDCollectionMintsID(t *testing.T) {
	s := newNotesStore(t)
	if err := s.Write("notes", Resource{
		Slug:   "a-note",
		Fields: map[string]any{"date": "2026-09-27"},
		Body:   "Just a note.\n",
	}); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join(s.repo, "src/content/notes/a-note.md"))
	if err != nil {
		t.Fatal(err)
	}
	m := regexp.MustCompile(`(?m)^id: (.+)$`).FindSubmatch(raw)
	if m == nil {
		t.Fatalf("no id minted for a collection that declares one:\n%s", raw)
	}
	if !idPattern.Match(m[1]) {
		t.Fatalf("minted id %q does not match %s", m[1], idPattern)
	}
}

// ...and a collection that declares no `id` field still gets none.
func TestUndeclaredIDCollectionStaysClean(t *testing.T) {
	s := newNotesStore(t)
	if err := s.Write("tags", Resource{
		Slug:   "gamedev",
		Fields: map[string]any{"name": "Gamedev"},
	}); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join(s.repo, "src/content/tags/gamedev.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	if regexp.MustCompile(`(?m)^id:`).Match(raw) {
		t.Fatalf("collection with no declared id got one:\n%s", raw)
	}
}

// A declared list-of-objects has to survive a write. It used to be stringified
// per item - `- map[alt:... src:...]` - which is not YAML and destroyed the
// media on first save.
func TestObjectListRoundTrips(t *testing.T) {
	s := newNotesStore(t)
	images := []any{
		map[string]any{"src": "https://media.fisher.sh/blog/a.jpg", "alt": "A dyed disc"},
		map[string]any{"src": "https://media.fisher.sh/blog/b.jpg"},
	}
	if err := s.Write("notes", Resource{
		Slug:   "dyes",
		Fields: map[string]any{"date": "2026-09-27", "images": images},
		Body:   "Two discs.\n",
	}); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(s.repo, "src/content/notes/dyes.md")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "map[") {
		t.Fatalf("object list was stringified:\n%s", raw)
	}
	got, err := s.Read("notes", "dyes")
	if err != nil {
		t.Fatal(err)
	}
	list, ok := got.Fields["images"].([]any)
	if !ok || len(list) != 2 {
		t.Fatalf("images did not round-trip: %#v\n%s", got.Fields["images"], raw)
	}
	first, _ := list[0].(map[string]any)
	if first["src"] != "https://media.fisher.sh/blog/a.jpg" || first["alt"] != "A dyed disc" {
		t.Fatalf("first image lost fields: %#v\n%s", first, raw)
	}
	// And a second save must not corrupt what the first one wrote.
	got.Version = ""
	if err := s.Write("notes", *got); err != nil {
		t.Fatal(err)
	}
	again, _ := os.ReadFile(path)
	if strings.Contains(string(again), "map[") {
		t.Fatalf("object list corrupted on re-save:\n%s", again)
	}
}
