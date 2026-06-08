// Package api serves the editor's HTTP/JSON endpoints over a schema-driven
// content.Store. Endpoints are generic over collection: the web discovers the
// site's collections from /api/schema and edits any of them through /api/c/...
// Resources carry their fields as an open map. Auth is handled by whatever
// fronts the service (see design.md "Auth (swappable)").
package api

import (
	"encoding/json"
	"fmt"
	"math/rand"
	"net/http"
	"strings"

	"github.com/fisherevans/scribe/internal/content"
	"github.com/fisherevans/scribe/internal/git"
	"github.com/fisherevans/scribe/internal/mapping"
	"github.com/fisherevans/scribe/internal/store"
)

type Server struct {
	store     *content.Store
	notes     *store.Notes
	mapping   *mapping.Store
	git       *git.Repo // nil when the git staging layer is disabled
	publicDir string
}

func New(c *content.Store, notes *store.Notes, m *mapping.Store, g *git.Repo, publicDir string) *Server {
	return &Server{store: c, notes: notes, mapping: m, git: g, publicDir: publicDir}
}

func (s *Server) Routes() *http.ServeMux {
	mux := http.NewServeMux()
	// Serve the repo's public/ so site-relative asset paths in content resolve.
	mux.Handle("/", http.FileServer(http.Dir(s.publicDir)))
	mux.HandleFunc("GET /api/health", s.health)
	mux.HandleFunc("GET /api/schema", s.getSchema)
	mux.HandleFunc("GET /api/mapping", s.getMapping)
	mux.HandleFunc("PUT /api/mapping", s.saveMapping)
	mux.HandleFunc("GET /api/c/{collection}", s.list)
	mux.HandleFunc("POST /api/c/{collection}", s.create)
	mux.HandleFunc("PUT /api/c/{collection}/{slug}", s.save)
	mux.HandleFunc("DELETE /api/c/{collection}/{slug}", s.del)
	mux.HandleFunc("POST /api/c/{collection}/{slug}/rename", s.rename)
	mux.HandleFunc("POST /api/c/{collection}/{slug}/promote", s.promote)
	mux.HandleFunc("GET /api/c/{collection}/{slug}/serialized", s.serialized)
	return mux
}

// resource is the envelope the web consumes: the content resource plus app-side
// state (staging axis, dirty, private notes).
type resource struct {
	Collection string `json:"collection"`
	content.Resource
	State string `json:"state"`
	Dirty bool   `json:"dirty"`
	Notes string `json:"notes"`
}

func (s *Server) wrap(collection string, r content.Resource) resource {
	if r.Fields == nil {
		r.Fields = map[string]any{}
	}
	return resource{Collection: collection, Resource: r, State: "promoted", Notes: s.notes.Get(collection, r.Slug)}
}

// stagedSet is the set of repo-relative paths with unpublished (staged) changes,
// or nil when git is disabled.
func (s *Server) stagedSet() map[string]bool {
	if s.git == nil {
		return nil
	}
	set, err := s.git.StagedPaths()
	if err != nil {
		return nil
	}
	return set
}

// applyState sets a resource's staging-axis state from the staged path set.
// With git disabled, everything is "promoted" (a save lands directly).
func (s *Server) applyState(collection string, res *resource, staged map[string]bool) {
	if s.git == nil {
		res.State = "promoted"
		return
	}
	rel, err := s.store.RelPath(collection, res.Slug)
	if err != nil {
		return
	}
	if staged[rel] {
		res.State = "staged"
	} else {
		res.State = "promoted"
	}
}

// commit lands an edit/delete/rename on the staging branch. paths are
// repo-relative; key is the resource identity used for squashing a session's
// successive saves into one commit. No-op when git is disabled.
func (s *Server) commit(collection, slug, summary string, paths ...string) error {
	if s.git == nil {
		return nil
	}
	return s.git.Commit(collection+"/"+slug, paths, summary)
}

func (s *Server) getSchema(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, s.store.Schema())
}

func (s *Server) getMapping(w http.ResponseWriter, _ *http.Request) {
	m, err := s.mapping.Load()
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, m)
}

func (s *Server) saveMapping(w http.ResponseWriter, r *http.Request) {
	var m mapping.Mapping
	if err := json.NewDecoder(r.Body).Decode(&m); err != nil {
		fail(w, err)
		return
	}
	if err := s.mapping.Write(&m); err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, m)
}

func (s *Server) list(w http.ResponseWriter, r *http.Request) {
	c := r.PathValue("collection")
	rs, err := s.store.List(c)
	if err != nil {
		fail(w, err)
		return
	}
	staged := s.stagedSet()
	out := make([]resource, len(rs))
	for i, res := range rs {
		out[i] = s.wrap(c, res)
		s.applyState(c, &out[i], staged)
	}
	writeJSON(w, out)
}

func (s *Server) create(w http.ResponseWriter, r *http.Request) {
	// No disk write until first save - avoids littering the repo with empties.
	res := s.wrap(r.PathValue("collection"), content.Resource{
		Slug:   fmt.Sprintf("untitled-%s", randSuffix()),
		Fields: map[string]any{},
	})
	res.State = "staged"
	writeJSON(w, res)
}

func (s *Server) save(w http.ResponseWriter, r *http.Request) {
	c := r.PathValue("collection")
	var in resource
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		fail(w, err)
		return
	}
	in.Resource.Slug = r.PathValue("slug")
	if err := s.store.Write(c, in.Resource); err != nil {
		fail(w, err)
		return
	}
	if err := s.notes.Set(c, in.Resource.Slug, in.Notes); err != nil {
		fail(w, err)
		return
	}
	slug := in.Resource.Slug
	if rel, err := s.store.RelPath(c, slug); err == nil {
		if err := s.commit(c, slug, "edit "+c+"/"+slug, rel); err != nil {
			fail(w, err)
			return
		}
	}
	saved, err := s.store.Read(c, slug)
	if err != nil {
		fail(w, err)
		return
	}
	res := s.wrap(c, *saved)
	s.applyState(c, &res, s.stagedSet())
	writeJSON(w, res)
}

func (s *Server) del(w http.ResponseWriter, r *http.Request) {
	c, slug := r.PathValue("collection"), r.PathValue("slug")
	if err := s.store.Delete(c, slug); err != nil {
		fail(w, err)
		return
	}
	_ = s.notes.Delete(c, slug)
	if rel, err := s.store.RelPath(c, slug); err == nil {
		if err := s.commit(c, slug, "delete "+c+"/"+slug, rel); err != nil {
			fail(w, err)
			return
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) rename(w http.ResponseWriter, r *http.Request) {
	c, from := r.PathValue("collection"), r.PathValue("slug")
	var in struct {
		To string `json:"to"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		fail(w, err)
		return
	}
	to := sanitizeSlug(in.To)
	if to == "" {
		http.Error(w, "invalid slug", http.StatusBadRequest)
		return
	}
	if to == from {
		writeJSON(w, map[string]string{"slug": from})
		return
	}
	if err := s.store.Rename(c, from, to); err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	_ = s.notes.Move(c, from, to)
	fromRel, errF := s.store.RelPath(c, from)
	toRel, errT := s.store.RelPath(c, to)
	if errF == nil && errT == nil {
		if err := s.commit(c, to, "rename "+c+"/"+from+" -> "+to, fromRel, toRel); err != nil {
			fail(w, err)
			return
		}
	}
	writeJSON(w, map[string]string{"slug": to})
}

func (s *Server) promote(w http.ResponseWriter, r *http.Request) {
	// Promote brings this resource's staged version onto the main branch. With
	// git disabled a save already lands in the working tree, so promote is a
	// no-op echo.
	c, slug := r.PathValue("collection"), r.PathValue("slug")
	if s.git != nil {
		rel, err := s.store.RelPath(c, slug)
		if err != nil {
			fail(w, err)
			return
		}
		if err := s.git.Promote([]string{rel}, "promote "+c+"/"+slug); err != nil {
			fail(w, err)
			return
		}
	}
	saved, err := s.store.Read(c, slug)
	if err != nil {
		fail(w, err)
		return
	}
	res := s.wrap(c, *saved)
	s.applyState(c, &res, s.stagedSet())
	writeJSON(w, res)
}

func (s *Server) serialized(w http.ResponseWriter, r *http.Request) {
	c, slug := r.PathValue("collection"), r.PathValue("slug")
	res, err := s.store.Read(c, slug)
	if err != nil {
		fail(w, err)
		return
	}
	out, err := s.store.Serialize(c, *res)
	if err != nil {
		fail(w, err)
		return
	}
	w.Header().Set("content-type", "text/plain; charset=utf-8")
	w.Write(out)
}

// ---- helpers ------------------------------------------------------------

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, map[string]string{"status": "ok"})
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("content-type", "application/json")
	if err := json.NewEncoder(w).Encode(v); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

func fail(w http.ResponseWriter, err error) {
	http.Error(w, err.Error(), http.StatusInternalServerError)
}

// sanitizeSlug normalizes a client slug to filename-safe chars (backstop).
func sanitizeSlug(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	var b strings.Builder
	lastDash := false
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
			lastDash = false
		} else if !lastDash {
			b.WriteByte('-')
			lastDash = true
		}
	}
	return strings.Trim(b.String(), "-")
}

func randSuffix() string {
	const a = "abcdefghijklmnopqrstuvwxyz0123456789"
	b := make([]byte, 4)
	for i := range b {
		b[i] = a[rand.Intn(len(a))]
	}
	return string(b)
}
