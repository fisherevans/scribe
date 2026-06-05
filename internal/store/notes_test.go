package store

import (
	"path/filepath"
	"testing"
)

func TestNotesSetGetPersist(t *testing.T) {
	path := filepath.Join(t.TempDir(), "notes.json")
	n, err := OpenNotes(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := n.Set("posts", "calsync", "remember to screenshot"); err != nil {
		t.Fatal(err)
	}
	if got := n.Get("posts", "calsync"); got != "remember to screenshot" {
		t.Errorf("Get = %q", got)
	}
	// reopen to confirm persistence
	n2, err := OpenNotes(path)
	if err != nil {
		t.Fatal(err)
	}
	if got := n2.Get("posts", "calsync"); got != "remember to screenshot" {
		t.Errorf("after reopen Get = %q", got)
	}
}

func TestNotesMoveAndDelete(t *testing.T) {
	n, _ := OpenNotes(filepath.Join(t.TempDir(), "notes.json"))
	n.Set("posts", "old", "note")
	if err := n.Move("posts", "old", "new"); err != nil {
		t.Fatal(err)
	}
	if n.Get("posts", "old") != "" {
		t.Error("old key not cleared after move")
	}
	if n.Get("posts", "new") != "note" {
		t.Error("note not moved to new key")
	}
	n.Delete("posts", "new")
	if n.Get("posts", "new") != "" {
		t.Error("note not deleted")
	}
}

func TestNotesEmptyClears(t *testing.T) {
	n, _ := OpenNotes(filepath.Join(t.TempDir(), "notes.json"))
	n.Set("posts", "p", "x")
	n.Set("posts", "p", "") // empty should remove the key
	if n.Get("posts", "p") != "" {
		t.Error("empty Set should clear the note")
	}
}
