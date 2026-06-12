package git

import (
	"context"
	"fmt"
	"testing"
	"time"
)

// fakeClock is a manually-advanced clock for exercising the session-checkpoint
// timing without sleeping.
type fakeClock struct{ t time.Time }

func (c *fakeClock) now() time.Time          { return c.t }
func (c *fakeClock) advance(d time.Duration) { c.t = c.t.Add(d) }

func openClocked(t *testing.T, dir string) (*Repo, *fakeClock) {
	t.Helper()
	r, err := Open(dir, "staging", "", false)
	if err != nil {
		t.Fatal(err)
	}
	clk := &fakeClock{t: time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)}
	r.now = clk.now
	r.idleGap = 5 * time.Minute
	r.maxSession = 10 * time.Minute
	return r, clk
}

// commitN writes distinct content and commits it, so each call is a real change.
func commitN(t *testing.T, r *Repo, dir, slug, path string, n int) {
	t.Helper()
	write(t, dir, path, fmt.Sprintf("content rev %d\n", n))
	if err := r.Commit(slug, []string{path}, "edit "+slug); err != nil {
		t.Fatalf("commit %d: %v", n, err)
	}
}

// commitsFor counts commits on staging that touched a path.
func commitsFor(t *testing.T, dir, path string) int {
	t.Helper()
	out := gitOut(t, dir, "rev-list", "--count", "staging", "--", path)
	var n int
	fmt.Sscanf(out, "%d", &n)
	return n
}

// Rapid saves to the same resource inside the session window amend a single
// commit - the whole point: autosaves don't each become a version.
func TestSessionAmendsWithinWindow(t *testing.T) {
	dir := initRepo(t)
	r, clk := openClocked(t, dir)
	base := commitsFor(t, dir, "posts/b.md")
	for i := 1; i <= 5; i++ {
		commitN(t, r, dir, "posts/b", "posts/b.md", i)
		clk.advance(30 * time.Second) // well within idleGap and maxSession
	}
	if got := commitsFor(t, dir, "posts/b.md") - base; got != 1 {
		t.Fatalf("expected 1 checkpoint for a continuous session, got %d", got)
	}
}

// A pause longer than idleGap seals the session: the next save is a new version.
func TestSessionSealsOnIdleGap(t *testing.T) {
	dir := initRepo(t)
	r, clk := openClocked(t, dir)
	base := commitsFor(t, dir, "posts/b.md")
	commitN(t, r, dir, "posts/b", "posts/b.md", 1)
	clk.advance(6 * time.Minute) // > idleGap
	commitN(t, r, dir, "posts/b", "posts/b.md", 2)
	if got := commitsFor(t, dir, "posts/b.md") - base; got != 2 {
		t.Fatalf("expected 2 checkpoints across an idle gap, got %d", got)
	}
}

// Continuous editing past maxSession seals even without an idle gap, so one
// marathon session still breaks into bounded checkpoints.
func TestSessionSealsOnMaxAge(t *testing.T) {
	dir := initRepo(t)
	r, clk := openClocked(t, dir)
	base := commitsFor(t, dir, "posts/b.md")
	// Edit every 2 min (never idle) for 12 min: maxSession is 10 min, so it must
	// seal once.
	for i := 1; i <= 7; i++ {
		commitN(t, r, dir, "posts/b", "posts/b.md", i)
		clk.advance(2 * time.Minute)
	}
	if got := commitsFor(t, dir, "posts/b.md") - base; got != 2 {
		t.Fatalf("expected 2 checkpoints when a session ages past maxSession, got %d", got)
	}
}

// Editing a different resource seals the previous one's session.
func TestDifferentResourceSeals(t *testing.T) {
	dir := initRepo(t)
	r, clk := openClocked(t, dir)
	baseB := commitsFor(t, dir, "posts/b.md")
	baseC := commitsFor(t, dir, "posts/c.md")
	commitN(t, r, dir, "posts/b", "posts/b.md", 1)
	clk.advance(10 * time.Second)
	commitN(t, r, dir, "posts/c", "posts/c.md", 1) // switch resource
	clk.advance(10 * time.Second)
	commitN(t, r, dir, "posts/b", "posts/b.md", 2) // back to b: new checkpoint, not an amend
	if got := commitsFor(t, dir, "posts/b.md") - baseB; got != 2 {
		t.Fatalf("expected 2 checkpoints for b after a resource switch, got %d", got)
	}
	if got := commitsFor(t, dir, "posts/c.md") - baseC; got != 1 {
		t.Fatalf("expected 1 checkpoint for c, got %d", got)
	}
}

// Seal forces the next save into a fresh checkpoint even inside the window.
func TestSealForcesNewCheckpoint(t *testing.T) {
	dir := initRepo(t)
	r, clk := openClocked(t, dir)
	base := commitsFor(t, dir, "posts/b.md")
	commitN(t, r, dir, "posts/b", "posts/b.md", 1)
	r.Seal()
	clk.advance(10 * time.Second) // still inside the window
	commitN(t, r, dir, "posts/b", "posts/b.md", 2)
	if got := commitsFor(t, dir, "posts/b.md") - base; got != 2 {
		t.Fatalf("expected Seal to force a 2nd checkpoint, got %d", got)
	}
}

// History reports each checkpoint with its change size; FileAt fetches content
// as of a given hash.
func TestHistoryAndFileAt(t *testing.T) {
	dir := initRepo(t)
	r, clk := openClocked(t, dir)
	// Two sealed checkpoints for posts/b.md.
	write(t, dir, "posts/b.md", "line one\nline two\n")
	if err := r.Commit("posts/b", []string{"posts/b.md"}, "edit posts/b"); err != nil {
		t.Fatal(err)
	}
	clk.advance(6 * time.Minute) // seal
	write(t, dir, "posts/b.md", "line one\nline two\nline three\n")
	if err := r.Commit("posts/b", []string{"posts/b.md"}, "edit posts/b"); err != nil {
		t.Fatal(err)
	}

	hist, err := r.History(context.Background(), "posts/b.md")
	if err != nil {
		t.Fatal(err)
	}
	if len(hist) != 2 {
		t.Fatalf("expected 2 checkpoints in history, got %d", len(hist))
	}
	// Newest first: the latest added one line.
	if hist[0].Added != 1 || hist[0].Removed != 0 {
		t.Fatalf("newest checkpoint size: want +1/-0, got +%d/-%d", hist[0].Added, hist[0].Removed)
	}
	// Both are staging-only (unpublished) since main never advanced.
	for _, c := range hist {
		if c.Published {
			t.Fatalf("expected unpublished checkpoints, %s marked published", c.Hash)
		}
	}
	// FileAt at the newest hash returns the 3-line version.
	raw, err := r.FileAt(context.Background(), hist[0].Hash, "posts/b.md")
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != "line one\nline two\nline three\n" {
		t.Fatalf("FileAt content mismatch:\n%q", string(raw))
	}
	// A non-hex hash is rejected, not shelled out.
	if _, err := r.FileAt(context.Background(), "HEAD; rm -rf /", "posts/b.md"); err == nil {
		t.Fatal("expected FileAt to reject a non-hex hash")
	}
}
