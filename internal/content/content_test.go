package content

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func newTestStore(t *testing.T) *Store {
	t.Helper()
	repo := t.TempDir()
	if err := os.MkdirAll(filepath.Join(repo, "src", "content", "posts"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(repo, "src", "content", "tags"), 0o755); err != nil {
		t.Fatal(err)
	}
	return NewStore(repo)
}

func TestSplitFrontmatter(t *testing.T) {
	tests := []struct {
		name      string
		raw       string
		wantFront string
		wantBody  string
	}{
		{"basic", "---\ntitle: x\n---\nbody here\n", "title: x\n", "body here\n"},
		{"no frontmatter", "just body\n", "", "just body\n"},
		{"blank line after fm", "---\na: 1\n---\n\nbody\n", "a: 1\n", "body\n"},
		{"unterminated", "---\ntitle: x\nbody", "", "---\ntitle: x\nbody"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			front, body := splitFrontmatter([]byte(tt.raw))
			if string(front) != tt.wantFront {
				t.Errorf("front = %q, want %q", front, tt.wantFront)
			}
			if body != tt.wantBody {
				t.Errorf("body = %q, want %q", body, tt.wantBody)
			}
		})
	}
}

func TestPostRoundTrip(t *testing.T) {
	s := newTestStore(t)
	in := Post{
		Slug:        "hello-world",
		Title:       "Hello, World",
		Date:        "2026-01-02",
		Description: "A description: with a colon and \"quotes\"",
		Tags:        []string{"alpha", "beta"},
		HasVideo:    true,
		UpdatedDate: "2026-01-03",
		Draft:       true,
		Body:        "# Heading\n\nSome **body** text.\n",
	}
	if err := s.WritePost(in); err != nil {
		t.Fatal(err)
	}
	got, err := s.ReadPost("hello-world")
	if err != nil {
		t.Fatal(err)
	}
	if got.Title != in.Title || got.Date != in.Date || got.Description != in.Description {
		t.Errorf("scalar mismatch: got %+v", got)
	}
	if !reflect.DeepEqual(got.Tags, in.Tags) {
		t.Errorf("tags = %v, want %v", got.Tags, in.Tags)
	}
	if got.HasVideo != in.HasVideo || got.Draft != in.Draft || got.UpdatedDate != in.UpdatedDate {
		t.Errorf("flags mismatch: got %+v", got)
	}
	if strings.TrimSpace(got.Body) != strings.TrimSpace(in.Body) {
		t.Errorf("body = %q, want %q", got.Body, in.Body)
	}
}

func TestFrontmatterIdempotent(t *testing.T) {
	s := newTestStore(t)
	in := Post{Slug: "p", Title: "T", Date: "2026-01-02", Tags: []string{"x"}, Draft: true, Body: "hi\n"}
	if err := s.WritePost(in); err != nil {
		t.Fatal(err)
	}
	first, _ := os.ReadFile(s.postPath("p"))
	got, _ := s.ReadPost("p")
	if err := s.WritePost(*got); err != nil {
		t.Fatal(err)
	}
	second, _ := os.ReadFile(s.postPath("p"))
	if string(first) != string(second) {
		t.Errorf("not idempotent:\nfirst:\n%s\nsecond:\n%s", first, second)
	}
}

func TestEmptyTagsNotNil(t *testing.T) {
	s := newTestStore(t)
	if err := s.WritePost(Post{Slug: "p", Title: "T", Date: "2026-01-02", Body: "x"}); err != nil {
		t.Fatal(err)
	}
	got, _ := s.ReadPost("p")
	if got.Tags == nil {
		t.Error("Tags is nil; want non-nil empty slice so JSON marshals as []")
	}
}

func TestRenameAndDelete(t *testing.T) {
	s := newTestStore(t)
	if err := s.WritePost(Post{Slug: "old", Title: "T", Date: "2026-01-02", Body: "x"}); err != nil {
		t.Fatal(err)
	}
	if err := s.RenamePost("old", "new"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(s.postPath("old")); !os.IsNotExist(err) {
		t.Error("old file still exists after rename")
	}
	if _, err := os.Stat(s.postPath("new")); err != nil {
		t.Error("new file missing after rename")
	}
	// rename onto an existing slug should fail
	if err := s.WritePost(Post{Slug: "other", Title: "O", Date: "2026-01-02", Body: "y"}); err != nil {
		t.Fatal(err)
	}
	if err := s.RenamePost("new", "other"); err == nil {
		t.Error("expected collision error renaming onto existing slug")
	}
	// delete
	if err := s.DeletePost("new"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(s.postPath("new")); !os.IsNotExist(err) {
		t.Error("file still exists after delete")
	}
	// deleting a missing file is a no-op
	if err := s.DeletePost("ghost"); err != nil {
		t.Errorf("delete of missing file should be nil, got %v", err)
	}
}
