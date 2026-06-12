package api

import (
	"encoding/json"
	"fmt"
	"github.com/fisherevans/scribe/internal/content"
	"github.com/fisherevans/scribe/internal/git"
	"net/http"
)

// history lists the version checkpoints that touched a resource: when each
// landed, how big the change was, and whether it's published or a draft. Empty
// (not an error) when the git layer is disabled - the UI just shows no history.
func (s *Server) history(w http.ResponseWriter, r *http.Request) {
	c, slug := r.PathValue("collection"), r.PathValue("slug")
	if s.git == nil {
		writeJSON(w, []git.Checkpoint{})
		return
	}
	rel, err := s.store.RelPath(c, slug)
	if err != nil {
		fail(w, err)
		return
	}
	cps, err := s.git.History(r.Context(), rel)
	if err != nil {
		fail(w, err)
		return
	}
	if cps == nil {
		cps = []git.Checkpoint{}
	}
	writeJSON(w, cps)
}

// versionAt returns a resource as it was at a given checkpoint, for previewing
// and diffing in the version drawer. It never touches the working tree.
func (s *Server) versionAt(w http.ResponseWriter, r *http.Request) {
	c, slug, hash := r.PathValue("collection"), r.PathValue("slug"), r.PathValue("hash")
	res, err := s.resourceAt(r, c, slug, hash)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, s.wrap(c, *res))
}

// restore writes a past version back as the current content and lands it as its
// own checkpoint (a forward revert - history stays append-only, so the state
// being replaced remains recoverable). It deliberately overwrites, bypassing the
// optimistic-concurrency guard, and seals first so the restore is its own commit
// rather than folding into an in-progress editing session.
func (s *Server) restore(w http.ResponseWriter, r *http.Request) {
	c, slug := r.PathValue("collection"), r.PathValue("slug")
	if s.git == nil {
		fail(w, fmt.Errorf("restore needs the git layer, which is disabled"))
		return
	}
	var in struct {
		Hash string `json:"hash"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		fail(w, err)
		return
	}
	res, err := s.resourceAt(r, c, slug, in.Hash)
	if err != nil {
		fail(w, err)
		return
	}
	res.Version = "" // deliberate overwrite: skip the concurrent-edit guard
	if err := s.store.Write(c, *res); err != nil {
		fail(w, err)
		return
	}
	rel, err := s.store.RelPath(c, slug)
	if err != nil {
		fail(w, err)
		return
	}
	s.git.Seal() // land the restore as a distinct checkpoint, not an amend
	short := in.Hash
	if len(short) > 8 {
		short = short[:8]
	}
	if err := s.commit(c, slug, "restore "+c+"/"+slug+" from "+short, rel); err != nil {
		fail(w, err)
		return
	}
	saved, err := s.store.Read(c, slug)
	if err != nil {
		fail(w, err)
		return
	}
	out := s.wrap(c, *saved)
	s.applyState(c, &out, s.stagedSet(r.Context()))
	writeJSON(w, out)
}

// resourceAt materializes collection/slug as it was at commit hash.
func (s *Server) resourceAt(r *http.Request, c, slug, hash string) (*content.Resource, error) {
	if s.git == nil {
		return nil, fmt.Errorf("version history needs the git layer, which is disabled")
	}
	rel, err := s.store.RelPath(c, slug)
	if err != nil {
		return nil, err
	}
	raw, err := s.git.FileAt(r.Context(), hash, rel)
	if err != nil {
		return nil, err
	}
	res, err := s.store.ParseRaw(c, raw)
	if err != nil {
		return nil, err
	}
	res.Slug = slug
	return res, nil
}
