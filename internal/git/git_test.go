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

func TestStagedPathsAndPromote(t *testing.T) {
	dir := initRepo(t)
	r, err := Open(dir, "staging", "", false)
	if err != nil {
		t.Fatal(err)
	}
	write(t, dir, "posts/a.md", "edited on staging\n")
	if err := r.Commit("posts/a", []string{"posts/a.md"}, "edit posts/a"); err != nil {
		t.Fatal(err)
	}

	staged, err := r.StagedPaths()
	if err != nil {
		t.Fatal(err)
	}
	if !staged["posts/a.md"] {
		t.Fatalf("expected posts/a.md to be staged, got %v", staged)
	}

	if err := r.Promote([]string{"posts/a.md"}, "promote posts/a"); err != nil {
		t.Fatal(err)
	}
	// After promote, main has the staging content and nothing is staged.
	if got := gitOut(t, dir, "show", "main:posts/a.md"); strings.TrimSpace(got) != "edited on staging" {
		t.Fatalf("main not updated by promote, got %q", got)
	}
	staged, err = r.StagedPaths()
	if err != nil {
		t.Fatal(err)
	}
	if len(staged) != 0 {
		t.Fatalf("expected nothing staged after promote, got %v", staged)
	}
	// scribe is back on staging.
	if cur := gitOut(t, dir, "rev-parse", "--abbrev-ref", "HEAD"); cur != "staging" {
		t.Fatalf("expected to be back on staging, got %q", cur)
	}
}

func TestPromoteDelete(t *testing.T) {
	dir := initRepo(t)
	r, err := Open(dir, "staging", "", false)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(filepath.Join(dir, "posts/a.md")); err != nil {
		t.Fatal(err)
	}
	if err := r.Commit("posts/a", []string{"posts/a.md"}, "delete posts/a"); err != nil {
		t.Fatal(err)
	}
	if err := r.Promote([]string{"posts/a.md"}, "promote delete posts/a"); err != nil {
		t.Fatal(err)
	}
	if err := exec.Command("git", "-C", dir, "cat-file", "-e", "main:posts/a.md").Run(); err == nil {
		t.Fatal("expected posts/a.md removed from main after promoting the delete")
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
