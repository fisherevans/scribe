package content

import (
	"os"
	"regexp"
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
