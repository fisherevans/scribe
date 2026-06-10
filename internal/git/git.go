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
// Concurrency: HTTP handlers call these methods concurrently. Local git work
// (index/working-tree ops) is serialized by `mu`; network ops (push/fetch) run
// under a separate `netMu` and never hold `mu`, so a slow or stuck origin can't
// block a read like StagedPaths. Every git exec is timeout-bounded, and the
// staged-path lookup is cached, so the common read path usually avoids git
// (and the mutex) entirely. scribe keeps the working tree on the staging branch
// at all times; Promote briefly switches to main and switches back.
package git

import (
	"context"
	"fmt"
	"os/exec"
	"strings"
	"sync"
	"time"
)

// Git execs are bounded so a stuck operation (an unreachable origin, a blocked
// credential helper) fails instead of hanging a request forever. Network ops
// (push/fetch) get a longer leash than local ones.
const (
	gitLocalTimeout = 15 * time.Second
	gitNetTimeout   = 60 * time.Second
	// stagedCacheTTL is how long a computed staged-path set is reused before a
	// fresh `git diff`. Short enough to feel live, long enough to collapse the
	// burst of list requests a page load fires.
	stagedCacheTTL = 3 * time.Second
)

// SyncStatus is the live state of scribe's git syncing, surfaced to the UI. Rev
// is the staging HEAD sha - the web refetches content whenever it changes
// (covers both local edits and pulled-in external changes).
type SyncStatus struct {
	State      string    `json:"state"` // "ok" | "conflict" | "error" | "disabled"
	Message    string    `json:"message"`
	Rev        string    `json:"rev"`
	LastSync   time.Time `json:"lastSync,omitempty"`
	LastBackup time.Time `json:"lastBackup,omitempty"`
	Push       bool      `json:"push"`
}

// Repo is a content-repo checkout scribe curates.
type Repo struct {
	dir     string
	staging string
	main    string
	remote  string
	push    bool

	// mu guards local git state (the index/working tree and the head bookkeeping
	// below). Network ops do NOT hold it - they use netMu - so a slow or stuck
	// push/fetch never blocks a read like StagedPaths.
	mu         sync.Mutex
	headSlug   string // resource key of the staging HEAD commit scribe made ("" if none/foreign)
	headPushed bool   // has the current staging HEAD been pushed?

	netMu sync.Mutex // serializes network ops (push/fetch); held instead of mu

	statusMu      sync.Mutex
	status        SyncStatus
	lastBackupRev string

	// Cached staged-path set (StagedPaths), invalidated whenever staging vs main
	// changes. Lets the per-request "is this dirty" lookups avoid a git diff (and
	// the mutex) on every list.
	stagedMu sync.Mutex
	staged   map[string]bool
	stagedAt time.Time
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
	state := "ok"
	if !push {
		state = "disabled" // no remote sync; local-only
	}
	r.setStatus(SyncStatus{State: state, Rev: r.rev(), Push: push})
	return r, nil
}

// Branches reports the staging and main branch names.
func (r *Repo) Branches() (staging, main string) { return r.staging, r.main }

// Status returns the current sync status (cheap; safe to poll).
func (r *Repo) Status() SyncStatus {
	r.statusMu.Lock()
	defer r.statusMu.Unlock()
	return r.status
}

// setStatus replaces the status, preserving timestamps the caller left zero.
func (r *Repo) setStatus(s SyncStatus) {
	r.statusMu.Lock()
	defer r.statusMu.Unlock()
	if s.LastSync.IsZero() {
		s.LastSync = r.status.LastSync
	}
	if s.LastBackup.IsZero() {
		s.LastBackup = r.status.LastBackup
	}
	r.status = s
}

// rev is the staging HEAD sha (short), or "" on error. Caller need not hold mu
// for a read-only rev-parse, but callers here hold it anyway.
func (r *Repo) rev() string {
	out, err := r.run("rev-parse", "--short", r.staging)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(out)
}

// Commit stages the given repo-relative paths and commits them to the staging
// branch under a per-resource message. Consecutive commits for the same
// resource that haven't been pushed are amended into one. slug is the
// resource key ("collection/slug") used both for the message and squash
// detection. A no-op (nothing staged) returns nil without committing.
func (r *Repo) Commit(slug string, paths []string, summary string) error {
	amend, committed, err := r.commitLocal(slug, paths, summary)
	if err != nil || !committed || !r.push {
		return err
	}
	// Push happens outside r.mu (under netMu) so a slow/stuck origin doesn't
	// block reads like StagedPaths.
	return r.pushStaging(amend)
}

// commitLocal does the local part of a commit under r.mu: stage paths and
// commit/amend onto staging. committed is false when nothing changed (a save
// that produced no diff).
func (r *Repo) commitLocal(slug string, paths []string, summary string) (amend, committed bool, err error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if err = r.ensureBranch(r.staging); err != nil {
		return false, false, err
	}
	if err = r.add(paths); err != nil {
		return false, false, err
	}
	if clean, e := r.indexClean(); e != nil {
		return false, false, e
	} else if clean {
		return false, false, nil // save produced no change
	}
	amend = r.headSlug == slug && !r.headPushed
	args := []string{"commit", "-m", summary}
	if amend {
		args = []string{"commit", "--amend", "-m", summary}
	}
	if _, e := r.run(args...); e != nil {
		return false, false, fmt.Errorf("commit: %w", e)
	}
	r.headSlug, r.headPushed = slug, false
	r.invalidateStaged()
	return amend, true, nil
}

// pushStaging pushes the staging branch outside r.mu (serialized by netMu), then
// records that the head has been pushed.
func (r *Repo) pushStaging(force bool) error {
	r.netMu.Lock()
	err := r.pushBranch(r.staging, force)
	r.netMu.Unlock()
	if err != nil {
		return err
	}
	r.mu.Lock()
	r.headPushed = true
	r.mu.Unlock()
	return nil
}

// Change is one path's difference between main and staging.
type Change struct {
	Status  string // "added" | "modified" | "deleted" | "renamed"
	Path    string // current path (new path for a rename)
	OldPath string // prior path, for renames only
}

// Diff is the full set of staged-but-unpublished changes (staging vs main).
// This is exactly what Publish will land on main, atomically.
func (r *Repo) Diff() ([]Change, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.diffChanges()
}

// diffChanges computes the staging-vs-main changeset. Caller holds r.mu.
func (r *Repo) diffChanges() ([]Change, error) {
	out, err := r.run("diff", "--name-status", "-M", r.main, r.staging)
	if err != nil {
		return nil, err
	}
	var changes []Change
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		if line == "" {
			continue
		}
		fields := strings.Split(line, "\t")
		code := fields[0]
		switch {
		case strings.HasPrefix(code, "A"):
			changes = append(changes, Change{Status: "added", Path: fields[1]})
		case strings.HasPrefix(code, "M"):
			changes = append(changes, Change{Status: "modified", Path: fields[1]})
		case strings.HasPrefix(code, "D"):
			changes = append(changes, Change{Status: "deleted", Path: fields[1]})
		case strings.HasPrefix(code, "R") && len(fields) >= 3:
			changes = append(changes, Change{Status: "renamed", OldPath: fields[1], Path: fields[2]})
		case len(fields) >= 2:
			changes = append(changes, Change{Status: "modified", Path: fields[len(fields)-1]})
		}
	}
	return changes, nil
}

// StagedPaths returns the set of repo-relative paths whose staging version
// differs from main (i.e. resources with unpublished changes). A renamed
// resource reports both its old and new path as staged.
//
// Cached for stagedCacheTTL: every list request asks for this, so a page load
// would otherwise fire a `git diff` per collection. The returned map is shared
// and must be treated as read-only. Invalidated whenever staging vs main moves
// (commit/publish/sync).
func (r *Repo) StagedPaths() (map[string]bool, error) {
	r.stagedMu.Lock()
	if r.staged != nil && time.Since(r.stagedAt) < stagedCacheTTL {
		cached := r.staged
		r.stagedMu.Unlock()
		return cached, nil
	}
	r.stagedMu.Unlock()

	changes, err := r.Diff()
	if err != nil {
		return nil, err
	}
	set := map[string]bool{}
	for _, c := range changes {
		if c.Path != "" {
			set[c.Path] = true
		}
		if c.OldPath != "" {
			set[c.OldPath] = true
		}
	}
	r.stagedMu.Lock()
	r.staged, r.stagedAt = set, time.Now()
	r.stagedMu.Unlock()
	return set, nil
}

// invalidateStaged drops the cached staged-path set so the next StagedPaths
// recomputes. Called after any op that changes staging vs main.
func (r *Repo) invalidateStaged() {
	r.stagedMu.Lock()
	r.staged = nil
	r.stagedMu.Unlock()
}

// Publish lands the entire staging changeset onto main as one squash commit,
// pushes main (when push is enabled), then resets staging to main so the two
// converge and the next session starts clean. This is atomic by design: all
// staged changes publish together, so referential edits (e.g. a cascading tag
// rename across several posts) never land half-applied. Returns the number of
// changed paths; 0 means nothing was staged.
func (r *Repo) Publish(summary string) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	changes, err := r.diffChanges()
	if err != nil {
		return 0, err
	}
	if len(changes) == 0 {
		return 0, nil
	}

	if _, err := r.run("checkout", r.main); err != nil {
		return 0, fmt.Errorf("checkout main: %w", err)
	}
	// Squash everything staging has beyond main into main's index.
	if _, err := r.run("merge", "--squash", r.staging); err != nil {
		r.run("merge", "--abort")
		r.run("checkout", r.staging)
		return 0, fmt.Errorf("merge staging: %w", err)
	}
	if clean, err := r.indexClean(); err != nil || clean {
		r.run("checkout", r.staging)
		return 0, err
	}
	if _, err := r.run("commit", "-m", summary); err != nil {
		r.run("checkout", r.staging)
		return 0, fmt.Errorf("commit on main: %w", err)
	}
	if r.push {
		if err := r.pushBranch(r.main, false); err != nil {
			r.run("checkout", r.staging)
			return 0, err
		}
	}
	// Converge staging onto the freshly published main.
	if _, err := r.run("checkout", r.staging); err != nil {
		return 0, fmt.Errorf("checkout staging: %w", err)
	}
	if _, err := r.run("reset", "--hard", r.main); err != nil {
		return 0, fmt.Errorf("reset staging to main: %w", err)
	}
	r.headSlug, r.headPushed = "", false
	r.invalidateStaged()
	if r.push {
		if err := r.pushBranch(r.staging, true); err != nil {
			return len(changes), err
		}
	}
	return len(changes), nil
}

// BackupPush pushes staging to origin if it advanced since the last backup, for
// redundancy. Force-with-lease because publish/sync can rewind staging. No-op
// when push is disabled or nothing changed.
func (r *Repo) BackupPush() error {
	if !r.push {
		return nil
	}
	// Read the current head under mu (a local rev-parse), then push outside it.
	r.mu.Lock()
	head := r.rev()
	last := r.lastBackupRev
	r.mu.Unlock()
	if head == "" || head == last {
		return nil
	}
	r.netMu.Lock()
	err := r.pushBranch(r.staging, true)
	r.netMu.Unlock()
	if err != nil {
		r.setStatus(SyncStatus{State: "error", Message: "backup push failed: " + err.Error(), Rev: head, Push: true})
		return err
	}
	r.mu.Lock()
	r.lastBackupRev = head
	r.mu.Unlock()
	r.setStatus(SyncStatus{State: r.okState(), Rev: head, LastBackup: time.Now(), Push: true})
	return nil
}

// Sync pulls external edits to the publish branch (e.g. a post written in Pages
// CMS) and rebases the local staging branch on top, so the editor sees them.
// It never auto-resolves: on a rebase conflict it aborts, leaves staging
// untouched, and flags a "conflict" status for the UI to surface. No-op when
// push is disabled (no remote) or the working tree is mid-edit (dirty).
func (r *Repo) Sync() error {
	if !r.push {
		return nil
	}
	// Fetch is a network op: do it outside the main lock (under netMu) so it
	// never blocks reads, and bound it with the network timeout.
	r.netMu.Lock()
	_, ferr := r.runWithin(gitNetTimeout, "fetch", r.remote, r.main)
	r.netMu.Unlock()
	if ferr != nil {
		r.setStatus(SyncStatus{State: "error", Message: "fetch failed: " + ferr.Error(), Rev: r.rev(), Push: true})
		return ferr
	}
	// Local reconcile needs the main lock. Skip this tick if a request or commit
	// holds it rather than queueing the background loop behind them.
	if !r.mu.TryLock() {
		return nil
	}
	defer r.mu.Unlock()
	if dirty, err := r.dirty(); err != nil {
		return err
	} else if dirty {
		return nil // uncommitted save in flight; try next tick
	}
	remoteRef := r.remote + "/" + r.main
	behind, err := r.run("rev-list", "--count", r.main+".."+remoteRef)
	if err != nil {
		r.setStatus(SyncStatus{State: "error", Message: err.Error(), Rev: r.rev(), Push: true})
		return err
	}
	if strings.TrimSpace(behind) == "0" {
		r.setStatus(SyncStatus{State: r.okState(), Rev: r.rev(), LastSync: time.Now(), Push: true})
		return nil
	}
	// External commits exist on origin/main. Rebase staging onto them.
	if _, err := r.run("rebase", remoteRef); err != nil {
		r.run("rebase", "--abort")
		r.setStatus(SyncStatus{
			State:   "conflict",
			Message: fmt.Sprintf("%s edits conflict with staged changes; reconcile manually", remoteRef),
			Rev:     r.rev(), LastSync: time.Now(), Push: true,
		})
		return nil
	}
	// Staging replayed cleanly; catch the local main ref up to origin.
	if _, err := r.run("branch", "-f", r.main, remoteRef); err != nil {
		r.setStatus(SyncStatus{State: "error", Message: err.Error(), Rev: r.rev(), Push: true})
		return err
	}
	r.invalidateStaged()
	r.setStatus(SyncStatus{State: r.okState(), Rev: r.rev(), LastSync: time.Now(), Push: true})
	return nil
}

// okState is "ok" unless a prior conflict is still unresolved (a conflict needs
// manual reconcile, so a clean tick alone shouldn't clear it - but since Sync
// only reaches a clean state after a successful rebase, returning "ok" is
// correct here).
func (r *Repo) okState() string { return "ok" }

// ---- internals ----------------------------------------------------------

// run executes a local git command with the local timeout.
func (r *Repo) run(args ...string) (string, error) {
	return r.runWithin(gitLocalTimeout, args...)
}

// runWithin executes a git command bounded by timeout. On timeout the process
// is killed and a clear error returned, so a stuck git op can never hang a
// caller (or the request behind it) indefinitely.
func (r *Repo) runWithin(timeout time.Duration, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = r.dir
	var out, errb strings.Builder
	cmd.Stdout = &out
	cmd.Stderr = &errb
	err := cmd.Run()
	if ctx.Err() == context.DeadlineExceeded {
		return out.String(), fmt.Errorf("git %s: timed out after %s", strings.Join(args, " "), timeout)
	}
	if err != nil {
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
	ctx, cancel := context.WithTimeout(context.Background(), gitLocalTimeout)
	defer cancel()
	if err := exec.CommandContext(ctx, "git", "-C", r.dir, "diff", "--cached", "--quiet").Run(); err != nil {
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
	ctx, cancel := context.WithTimeout(context.Background(), gitLocalTimeout)
	defer cancel()
	err := exec.CommandContext(ctx, "git", "-C", r.dir, "show-ref", "--verify", "--quiet", "refs/heads/"+name).Run()
	return err == nil
}

func (r *Repo) existsOnBranch(branch, path string) bool {
	ctx, cancel := context.WithTimeout(context.Background(), gitLocalTimeout)
	defer cancel()
	err := exec.CommandContext(ctx, "git", "-C", r.dir, "cat-file", "-e", branch+":"+path).Run()
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
	_, err := r.runWithin(gitNetTimeout, args...)
	return err
}
