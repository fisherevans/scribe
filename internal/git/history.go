package git

import (
	"context"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Checkpoint is one commit in a resource's history, with the size of its change.
// It's what the editor's version drawer renders: when an edit landed, how big it
// was, and whether it's already published (on main) or still a draft checkpoint
// (only on staging).
type Checkpoint struct {
	Hash      string    `json:"hash"`
	Time      time.Time `json:"time"`
	Added     int       `json:"added"`     // lines added to this path in this commit
	Removed   int       `json:"removed"`   // lines removed from this path in this commit
	Summary   string    `json:"summary"`   // commit subject
	Published bool      `json:"published"` // reachable from main (already live), vs a staging-only draft
}

var hashRE = regexp.MustCompile(`^[0-9a-f]{7,40}$`)

// History returns the checkpoints that touched path, newest first, across the
// whole branch history - both published commits (on main) and unpublished
// session checkpoints (staging-only). Line counts are this commit's added/removed
// for the path, so the UI can show "how big" a version was.
func (r *Repo) History(ctx context.Context, path string) ([]Checkpoint, error) {
	// Record/field separators that won't appear in a commit subject or path.
	const rec, sep = "\x1e", "\x1f"
	format := rec + "%H" + sep + "%cI" + sep + "%s"
	out, err := r.runWithinCtx(ctx, gitLocalTimeout,
		"log", "--no-color", "--numstat", "--format="+format, r.staging, "--", path)
	if err != nil {
		return nil, err
	}

	// Which of these commits are unpublished (on staging but not yet on main)?
	// staging = main + the unpushed session checkpoints, so everything else in
	// the path's history is already published.
	unpub := map[string]bool{}
	if u, e := r.runWithinCtx(ctx, gitLocalTimeout,
		"log", "--format=%H", r.main+".."+r.staging, "--", path); e == nil {
		for _, h := range strings.Fields(u) {
			unpub[h] = true
		}
	}

	var cps []Checkpoint
	for _, block := range strings.Split(out, rec) {
		block = strings.Trim(block, "\n")
		if block == "" {
			continue
		}
		lines := strings.Split(block, "\n")
		head := strings.SplitN(lines[0], sep, 3)
		if len(head) < 3 {
			continue
		}
		cp := Checkpoint{Hash: head[0], Summary: head[2], Published: !unpub[head[0]]}
		if t, e := time.Parse(time.RFC3339, head[1]); e == nil {
			cp.Time = t
		}
		// Remaining lines are numstat rows: "<added>\t<removed>\t<path>".
		// Binary files report "-"; Atoi leaves those at 0.
		for _, ln := range lines[1:] {
			f := strings.Fields(ln)
			if len(f) < 2 {
				continue
			}
			a, _ := strconv.Atoi(f[0])
			d, _ := strconv.Atoi(f[1])
			cp.Added += a
			cp.Removed += d
		}
		cps = append(cps, cp)
	}
	return cps, nil
}

// FileAt returns the raw bytes of path as of commit hash. hash is validated as a
// hex sha so it can't smuggle a flag or a second argument into `git show`.
func (r *Repo) FileAt(ctx context.Context, hash, path string) ([]byte, error) {
	if !hashRE.MatchString(hash) {
		return nil, fmt.Errorf("invalid commit hash %q", hash)
	}
	out, err := r.runWithinCtx(ctx, gitLocalTimeout, "show", hash+":"+path)
	if err != nil {
		return nil, err
	}
	return []byte(out), nil
}
