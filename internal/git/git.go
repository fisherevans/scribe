// Package git wraps a content-repo checkout so scribe can land edits on a
// staging branch and promote them to the publish branch. It shells out to the
// `git` CLI - the call sites stay obvious and there's no native library to
// build.
//
// Model: scribe is a content-curation tool. Its job ends at the commit.
//
//   - Every edit (save/delete/rename) is committed to the staging branch.
//     Consecutive edits to the same resource are squashed (amended) so a
//     writing session is one commit, not one-per-keystroke-save.
//   - Promote is per-resource: it brings that one file's staged version onto
//     the main branch and commits it. You can stage many drafts and publish
//     them individually.
//   - When a remote is configured (Push enabled), commits and promotions are
//     pushed. A separate downstream pipeline renders/publishes from the
//     branches - scribe does not build or deploy.
//
// All mutating operations are serialized with a mutex; the HTTP handlers that
// call them run concurrently. scribe keeps the working tree on the staging
// branch at all times; Promote briefly switches to main and switches back.
package git

import (
	"fmt"
	"os/exec"
	"strings"
	"sync"
)

// Repo is a content-repo checkout scribe curates.
type Repo struct {
	dir     string
	staging string
	main    string
	remote  string
	push    bool

	mu         sync.Mutex
	headSlug   string // resource key of the staging HEAD commit scribe made ("" if none/foreign)
	headPushed bool   // has the current staging HEAD been pushed?
}

// Open verifies dir is a git work tree, ensures the staging branch exists, and
// checks it out. main defaults to the branch currently checked out (or "main").
// staging defaults to "staging". If push is true, a remote named "origin" is
// expected and commits/promotions are pushed.
func Open(dir, staging, main string, push bool) (*Repo, error) {
	r := &Repo{dir: dir, staging: staging, main: main, remote: "origin", push: push}
	if r.staging == "" {
		r.staging = "staging"
	}
	if _, err := r.run("rev-parse", "--is-inside-work-tree"); err != nil {
		return nil, fmt.Errorf("%s is not a git repo: %w", dir, err)
	}
	if r.main == "" {
		cur, err := r.run("rev-parse", "--abbrev-ref", "HEAD")
		if err != nil {
			return nil, err
		}
		r.main = strings.TrimSpace(cur)
		if r.main == "" || r.main == "HEAD" {
			r.main = "main"
		}
	}
	if r.main == r.staging {
		return nil, fmt.Errorf("staging and main branch must differ (both %q)", r.main)
	}
	if dirty, err := r.dirty(); err != nil {
		return nil, err
	} else if dirty {
		return nil, fmt.Errorf("working tree at %s has uncommitted changes; commit or stash before starting scribe", dir)
	}
	if !r.branchExists(r.staging) {
		if _, err := r.run("branch", r.staging, r.main); err != nil {
			return nil, fmt.Errorf("create staging branch: %w", err)
		}
	}
	if _, err := r.run("checkout", r.staging); err != nil {
		return nil, fmt.Errorf("checkout staging: %w", err)
	}
	return r, nil
}

// Branches reports the staging and main branch names.
func (r *Repo) Branches() (staging, main string) { return r.staging, r.main }

// Commit stages the given repo-relative paths and commits them to the staging
// branch under a per-resource message. Consecutive commits for the same
// resource that haven't been pushed are amended into one. slug is the
// resource key ("collection/slug") used both for the message and squash
// detection. A no-op (nothing staged) returns nil without committing.
func (r *Repo) Commit(slug string, paths []string, summary string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if err := r.ensureBranch(r.staging); err != nil {
		return err
	}
	if err := r.add(paths); err != nil {
		return err
	}
	if clean, err := r.indexClean(); err != nil {
		return err
	} else if clean {
		return nil // save produced no change
	}
	amend := r.headSlug == slug && !r.headPushed
	args := []string{"commit", "-m", summary}
	if amend {
		args = []string{"commit", "--amend", "-m", summary}
	}
	if _, err := r.run(args...); err != nil {
		return fmt.Errorf("commit: %w", err)
	}
	r.headSlug, r.headPushed = slug, false
	if r.push {
		if err := r.pushBranch(r.staging, amend); err != nil {
			return err
		}
		r.headPushed = true
	}
	return nil
}

// Promote brings the staging version of the given resource's paths onto the
// main branch and commits it there, then returns to staging. Handles both
// edits (file present on staging) and deletes (absent on staging -> removed on
// main).
func (r *Repo) Promote(paths []string, summary string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, err := r.run("checkout", r.main); err != nil {
		return fmt.Errorf("checkout main: %w", err)
	}
	// Always end back on staging, even on error.
	defer r.run("checkout", r.staging)

	for _, p := range paths {
		if r.existsOnBranch(r.staging, p) {
			if _, err := r.run("checkout", r.staging, "--", p); err != nil {
				return fmt.Errorf("take staging %s: %w", p, err)
			}
		} else {
			// Deleted on staging: remove from main if present.
			if r.existsOnBranch(r.main, p) {
				if _, err := r.run("rm", "-q", "--", p); err != nil {
					return fmt.Errorf("remove %s on main: %w", p, err)
				}
			}
		}
	}
	if clean, err := r.indexClean(); err != nil {
		return err
	} else if clean {
		return nil // already promoted; nothing to do
	}
	if _, err := r.run("commit", "-m", summary); err != nil {
		return fmt.Errorf("commit on main: %w", err)
	}
	if r.push {
		if err := r.pushBranch(r.main, false); err != nil {
			return err
		}
	}
	return nil
}

// StagedPaths returns the set of repo-relative paths whose staging version
// differs from main (i.e. resources with unpublished changes).
func (r *Repo) StagedPaths() (map[string]bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out, err := r.run("diff", "--name-only", r.main, r.staging)
	if err != nil {
		return nil, err
	}
	set := map[string]bool{}
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		if line != "" {
			set[line] = true
		}
	}
	return set, nil
}

// ---- internals ----------------------------------------------------------

func (r *Repo) run(args ...string) (string, error) {
	cmd := exec.Command("git", args...)
	cmd.Dir = r.dir
	var out, errb strings.Builder
	cmd.Stdout = &out
	cmd.Stderr = &errb
	if err := cmd.Run(); err != nil {
		return out.String(), fmt.Errorf("git %s: %v: %s", strings.Join(args, " "), err, strings.TrimSpace(errb.String()))
	}
	return out.String(), nil
}

func (r *Repo) add(paths []string) error {
	args := append([]string{"add", "-A", "--"}, paths...)
	_, err := r.run(args...)
	return err
}

// indexClean reports whether the index has no staged changes vs HEAD.
func (r *Repo) indexClean() (bool, error) {
	if err := exec.Command("git", "-C", r.dir, "diff", "--cached", "--quiet").Run(); err != nil {
		if _, ok := err.(*exec.ExitError); ok {
			return false, nil // exit 1 = changes staged
		}
		return false, err
	}
	return true, nil
}

func (r *Repo) dirty() (bool, error) {
	out, err := r.run("status", "--porcelain")
	if err != nil {
		return false, err
	}
	return strings.TrimSpace(out) != "", nil
}

func (r *Repo) branchExists(name string) bool {
	err := exec.Command("git", "-C", r.dir, "show-ref", "--verify", "--quiet", "refs/heads/"+name).Run()
	return err == nil
}

func (r *Repo) existsOnBranch(branch, path string) bool {
	err := exec.Command("git", "-C", r.dir, "cat-file", "-e", branch+":"+path).Run()
	return err == nil
}

func (r *Repo) ensureBranch(name string) error {
	cur, err := r.run("rev-parse", "--abbrev-ref", "HEAD")
	if err != nil {
		return err
	}
	if strings.TrimSpace(cur) == name {
		return nil
	}
	_, err = r.run("checkout", name)
	return err
}

func (r *Repo) pushBranch(branch string, force bool) error {
	args := []string{"push", r.remote, branch}
	if force {
		args = []string{"push", "--force-with-lease", r.remote, branch}
	}
	_, err := r.run(args...)
	return err
}
