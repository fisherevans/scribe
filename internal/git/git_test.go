package git

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// initRepo makes a temp git repo with one commit on "main" and returns its dir.
func initRepo(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	run := func(args ...string) {
		t.Helper()
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		cmd.Env = append(os.Environ(),
			"GIT_AUTHOR_NAME=test", "GIT_AUTHOR_EMAIL=test@example.com",
			"GIT_COMMITTER_NAME=test", "GIT_COMMITTER_EMAIL=test@example.com",
		)
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %s: %v: %s", strings.Join(args, " "), err, out)
		}
	}
	run("init", "-q", "-b", "main")
	run("config", "user.name", "test")
	run("config", "user.email", "test@example.com")
	write(t, dir, "posts/a.md", "first\n")
	run("add", "-A")
	run("commit", "-q", "-m", "init")
	return dir
}

func write(t *testing.T, dir, rel, content string) {
	t.Helper()
	p := filepath.Join(dir, rel)
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func gitOut(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	out, err := cmd.Output()
	if err != nil {
		t.Fatalf("git %s: %v", strings.Join(args, " "), err)
	}
	return strings.TrimSpace(string(out))
}

func TestOpenCreatesAndChecksOutStaging(t *testing.T) {
	dir := initRepo(t)
	r, err := Open(dir, "staging", "", false)
	if err != nil {
		t.Fatal(err)
	}
	if cur := gitOut(t, dir, "rev-parse", "--abbrev-ref", "HEAD"); cur != "staging" {
		t.Fatalf("expected to be on staging, got %q", cur)
	}
	if _, main := r.Branches(); main != "main" {
		t.Fatalf("expected main branch detected, got %q", main)
	}
}

func TestOpenRefusesDirtyTree(t *testing.T) {
	dir := initRepo(t)
	write(t, dir, "posts/a.md", "dirty edit\n")
	if _, err := Open(dir, "staging", "", false); err == nil {
		t.Fatal("expected Open to refuse a dirty working tree")
	}
}

func TestCommitSquashesSameResource(t *testing.T) {
	dir := initRepo(t)
	r, err := Open(dir, "staging", "", false)
	if err != nil {
		t.Fatal(err)
	}
	base := gitOut(t, dir, "rev-list", "--count", "HEAD")

	write(t, dir, "posts/a.md", "v2\n")
	if err := r.Commit("posts/a", []string{"posts/a.md"}, "edit posts/a"); err != nil {
		t.Fatal(err)
	}
	write(t, dir, "posts/a.md", "v3\n")
	if err := r.Commit("posts/a", []string{"posts/a.md"}, "edit posts/a"); err != nil {
		t.Fatal(err)
	}
	// Two saves of the same resource -> one new commit (amended).
	if got := gitOut(t, dir, "rev-list", "--count", "HEAD"); got != incr(base, 1) {
		t.Fatalf("expected 1 new commit after squash, base=%s got=%s", base, got)
	}

	// A different resource starts a fresh commit.
	write(t, dir, "posts/b.md", "new\n")
	if err := r.Commit("posts/b", []string{"posts/b.md"}, "edit posts/b"); err != nil {
		t.Fatal(err)
	}
	if got := gitOut(t, dir, "rev-list", "--count", "HEAD"); got != incr(base, 2) {
		t.Fatalf("expected 2 new commits, base=%s got=%s", base, got)
	}
}

func TestCommitNoOpWhenUnchanged(t *testing.T) {
	dir := initRepo(t)
	r, err := Open(dir, "staging", "", false)
	if err != nil {
		t.Fatal(err)
	}
	before := gitOut(t, dir, "rev-parse", "HEAD")
	// Commit without changing the file content.
	if err := r.Commit("posts/a", []string{"posts/a.md"}, "edit posts/a"); err != nil {
		t.Fatal(err)
	}
	if after := gitOut(t, dir, "rev-parse", "HEAD"); after != before {
		t.Fatal("expected no commit when nothing changed")
	}
}

func TestDiffReportsChangeset(t *testing.T) {
	dir := initRepo(t)
	r, err := Open(dir, "staging", "", false)
	if err != nil {
		t.Fatal(err)
	}
	write(t, dir, "posts/a.md", "modified\n")    // modify existing
	write(t, dir, "posts/new.md", "brand new\n") // add
	if err := r.Commit("posts/a", []string{"posts/a.md"}, "edit a"); err != nil {
		t.Fatal(err)
	}
	if err := r.Commit("posts/new", []string{"posts/new.md"}, "add new"); err != nil {
		t.Fatal(err)
	}
	changes, err := r.Diff()
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]string{}
	for _, c := range changes {
		got[c.Path] = c.Status
	}
	if got["posts/a.md"] != "modified" || got["posts/new.md"] != "added" {
		t.Fatalf("unexpected changeset: %v", got)
	}
}

func TestPublishIsAtomicAndConverges(t *testing.T) {
	dir := initRepo(t)
	r, err := Open(dir, "staging", "", false)
	if err != nil {
		t.Fatal(err)
	}
	// A cascade-like batch: modify one, add one, delete one - across saves.
	write(t, dir, "posts/a.md", "edited on staging\n")
	write(t, dir, "posts/b.md", "new post\n")
	if err := r.Commit("posts/a", []string{"posts/a.md"}, "edit a"); err != nil {
		t.Fatal(err)
	}
	if err := r.Commit("posts/b", []string{"posts/b.md"}, "add b"); err != nil {
		t.Fatal(err)
	}

	n, err := r.Publish("publish: 2 changes")
	if err != nil {
		t.Fatal(err)
	}
	if n != 2 {
		t.Fatalf("expected 2 changes published, got %d", n)
	}
	// main carries every change, as one squash commit.
	if got := gitOut(t, dir, "show", "main:posts/a.md"); strings.TrimSpace(got) != "edited on staging" {
		t.Fatalf("main missing modified file, got %q", got)
	}
	if err := exec.Command("git", "-C", dir, "cat-file", "-e", "main:posts/b.md").Run(); err != nil {
		t.Fatal("main missing added file after publish")
	}
	// staging and main converge; nothing left staged.
	staged, err := r.StagedPaths()
	if err != nil {
		t.Fatal(err)
	}
	if len(staged) != 0 {
		t.Fatalf("expected clean after publish, got %v", staged)
	}
	if cur := gitOut(t, dir, "rev-parse", "--abbrev-ref", "HEAD"); cur != "staging" {
		t.Fatalf("expected to be back on staging, got %q", cur)
	}
	if gitOut(t, dir, "rev-parse", "staging") != gitOut(t, dir, "rev-parse", "main") {
		t.Fatal("expected staging to converge to main after publish")
	}
}

func TestPublishNoOpWhenClean(t *testing.T) {
	dir := initRepo(t)
	r, err := Open(dir, "staging", "", false)
	if err != nil {
		t.Fatal(err)
	}
	n, err := r.Publish("nothing")
	if err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatalf("expected 0 changes on a clean tree, got %d", n)
	}
}

// incr returns the decimal string base+n. Counts are small.
func incr(base string, n int) string {
	var v int
	for _, c := range base {
		v = v*10 + int(c-'0')
	}
	v += n
	if v == 0 {
		return "0"
	}
	digits := []byte{}
	for v > 0 {
		digits = append([]byte{byte('0' + v%10)}, digits...)
		v /= 10
	}
	return string(digits)
}
