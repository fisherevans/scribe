package git

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func git2(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(),
		"GIT_AUTHOR_NAME=test", "GIT_AUTHOR_EMAIL=test@example.com",
		"GIT_COMMITTER_NAME=test", "GIT_COMMITTER_EMAIL=test@example.com",
	)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %s: %v: %s", strings.Join(args, " "), err, out)
	}
	return strings.TrimSpace(string(out))
}

// setupRemote builds a bare origin seeded with one commit on main, plus a fresh
// working clone. Returns (workdir, origin, seedClone) - seedClone stands in for
// an external editor (Pages CMS) pushing to origin/main.
func setupRemote(t *testing.T) (work, origin, seed string) {
	t.Helper()
	origin = filepath.Join(t.TempDir(), "origin.git")
	git2(t, t.TempDir(), "init", "-q", "--bare", "-b", "main", origin)

	seed = t.TempDir()
	git2(t, seed, "clone", "-q", origin, ".")
	write(t, seed, "posts/a.md", "original\n")
	git2(t, seed, "add", "-A")
	git2(t, seed, "commit", "-q", "-m", "seed")
	git2(t, seed, "push", "-q", "origin", "main")

	work = t.TempDir()
	git2(t, work, "clone", "-q", origin, ".")
	return work, origin, seed
}

// externalEdit commits a change to a file on origin/main via the seed clone.
func externalEdit(t *testing.T, seed, rel, content string) {
	t.Helper()
	git2(t, seed, "pull", "-q", "origin", "main")
	write(t, seed, rel, content)
	git2(t, seed, "add", "-A")
	git2(t, seed, "commit", "-q", "-m", "external edit "+rel)
	git2(t, seed, "push", "-q", "origin", "main")
}

func TestSyncPullsExternalEdits(t *testing.T) {
	work, _, seed := setupRemote(t)
	r, err := Open(work, "staging", "main", true)
	if err != nil {
		t.Fatal(err)
	}
	// scribe edits a different file on staging.
	write(t, work, "posts/local.md", "my draft\n")
	if err := r.Commit("posts/local", []string{"posts/local.md"}, "edit local"); err != nil {
		t.Fatal(err)
	}
	// Someone publishes a new post via Pages CMS (origin/main moves).
	externalEdit(t, seed, "posts/external.md", "written elsewhere\n")

	if err := r.Sync(); err != nil {
		t.Fatal(err)
	}
	st := r.Status()
	if st.State != "ok" {
		t.Fatalf("expected ok after clean sync, got %q (%s)", st.State, st.Message)
	}
	// The external post is now in the working tree...
	if _, err := os.Stat(filepath.Join(work, "posts/external.md")); err != nil {
		t.Fatal("external post not pulled into working tree")
	}
	// ...and the local draft is preserved on top.
	if _, err := os.Stat(filepath.Join(work, "posts/local.md")); err != nil {
		t.Fatal("local draft lost after rebase")
	}
}

func TestSyncSurfacesConflict(t *testing.T) {
	work, _, seed := setupRemote(t)
	r, err := Open(work, "staging", "main", true)
	if err != nil {
		t.Fatal(err)
	}
	// scribe and Pages CMS edit the SAME file differently.
	write(t, work, "posts/a.md", "local change\n")
	if err := r.Commit("posts/a", []string{"posts/a.md"}, "edit a"); err != nil {
		t.Fatal(err)
	}
	externalEdit(t, seed, "posts/a.md", "remote change\n")

	if err := r.Sync(); err != nil {
		t.Fatal(err)
	}
	st := r.Status()
	if st.State != "conflict" {
		t.Fatalf("expected conflict state, got %q", st.State)
	}
	// Staging is left untouched (no half-applied rebase).
	if got := strings.TrimSpace(git2(t, work, "show", "staging:posts/a.md")); got != "local change" {
		t.Fatalf("staging should be untouched, got %q", got)
	}
	if cur := git2(t, work, "rev-parse", "--abbrev-ref", "HEAD"); cur != "staging" {
		t.Fatalf("expected to remain on staging, got %q", cur)
	}
}

func TestBackupPushAdvancesRemote(t *testing.T) {
	work, origin, _ := setupRemote(t)
	r, err := Open(work, "staging", "main", true)
	if err != nil {
		t.Fatal(err)
	}
	write(t, work, "posts/a.md", "staged work\n")
	if err := r.Commit("posts/a", []string{"posts/a.md"}, "edit a"); err != nil {
		t.Fatal(err)
	}
	if err := r.BackupPush(); err != nil {
		t.Fatal(err)
	}
	// origin now has the staging branch with our commit.
	if !strings.Contains(git2(t, origin, "branch", "--list", "staging"), "staging") {
		t.Fatal("staging not pushed to origin")
	}
	if r.Status().LastBackup.IsZero() {
		t.Fatal("expected LastBackup timestamp set")
	}
}
