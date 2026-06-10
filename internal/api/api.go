// Package api serves the editor's HTTP/JSON endpoints over a schema-driven
// content.Store. Endpoints are generic over collection: the web discovers the
// site's collections from /api/schema and edits any of them through /api/c/...
// Resources carry their fields as an open map. Auth is handled by whatever
// fronts the service (see design.md "Auth (swappable)").
package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"math/rand"
	"net/http"
	"os"
	"path/filepath"
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
	uploadCmd string // SCRIBE_UPLOAD_CMD; empty = copy into the site media dir
	ui        fs.FS  // embedded/served editor UI; nil = API-only (dev uses Vite)
}

func New(c *content.Store, notes *store.Notes, m *mapping.Store, g *git.Repo, publicDir, uploadCmd string, ui fs.FS) *Server {
	return &Server{store: c, notes: notes, mapping: m, git: g, publicDir: publicDir, uploadCmd: uploadCmd, ui: ui}
}

func (s *Server) Routes() *http.ServeMux {
	mux := http.NewServeMux()
	// Root handler serves the blog's public/ assets and, when a UI is bundled,
	// the editor PWA (its own assets live under /_app/, see serveRoot).
	if s.ui != nil {
		mux.Handle("/_app/", http.StripPrefix("/_app/", http.FileServer(http.FS(s.ui))))
	}
	mux.HandleFunc("/", s.serveRoot)
	mux.HandleFunc("GET /api/health", s.health)
	mux.HandleFunc("GET /api/schema", s.getSchema)
	mux.HandleFunc("GET /api/mapping", s.getMapping)
	mux.HandleFunc("PUT /api/mapping", s.saveMapping)
	mux.HandleFunc("GET /api/c/{collection}", s.list)
	mux.HandleFunc("POST /api/c/{collection}", s.create)
	mux.HandleFunc("PUT /api/c/{collection}/{slug}", s.save)
	mux.HandleFunc("DELETE /api/c/{collection}/{slug}", s.del)
	mux.HandleFunc("POST /api/c/{collection}/{slug}/rename", s.rename)
	mux.HandleFunc("GET /api/publish", s.publishDiff)
	mux.HandleFunc("POST /api/publish", s.publish)
	mux.HandleFunc("GET /api/sync", s.syncStatus)
	mux.HandleFunc("POST /api/sync", s.syncNow)
	mux.HandleFunc("GET /api/c/{collection}/{slug}/serialized", s.serialized)
	mux.HandleFunc("POST /api/upload", s.upload)
	mux.HandleFunc("GET /api/capabilities", s.capabilities)
	mux.HandleFunc("GET /api/media", s.media)
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
func (s *Server) stagedSet(ctx context.Context) map[string]bool {
	if s.git == nil {
		return nil
	}
	set, err := s.git.StagedPaths(ctx)
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
	staged := s.stagedSet(r.Context())
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
		// Concurrent-edit conflict: the file changed since the client read it.
		// Return 409 + the current server resource so the client can reconcile
		// (reload / overwrite / merge) instead of silently clobbering.
		if errors.Is(err, content.ErrConflict) {
			cur, rerr := s.store.Read(c, in.Resource.Slug)
			if rerr != nil {
				fail(w, rerr)
				return
			}
			out := s.wrap(c, *cur)
			s.applyState(c, &out, s.stagedSet(r.Context()))
			w.Header().Set("content-type", "application/json")
			w.WriteHeader(http.StatusConflict)
			json.NewEncoder(w).Encode(out)
			return
		}
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
	s.applyState(c, &res, s.stagedSet(r.Context()))
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

// change is one entry in the publish changeset the UI reviews before publishing.
type change struct {
	Collection string `json:"collection"`
	Slug       string `json:"slug"`
	Title      string `json:"title"`
	Status     string `json:"status"`         // added | modified | deleted | renamed
	From       string `json:"from,omitempty"` // prior slug, for renames
}

// publishDiff returns the full staged-vs-main changeset. This is exactly what
// publish will land on main, atomically. Empty when nothing is staged or git
// is disabled.
func (s *Server) publishDiff(w http.ResponseWriter, r *http.Request) {
	if s.git == nil {
		writeJSON(w, map[string]any{"changes": []change{}, "enabled": false})
		return
	}
	raw, err := s.git.Diff(r.Context())
	if err != nil {
		fail(w, err)
		return
	}
	out := make([]change, 0, len(raw))
	for _, ch := range raw {
		col, slug, ok := s.store.ResolvePath(ch.Path)
		if !ok {
			continue // not a content file (asset, config, etc.)
		}
		c := change{Collection: col, Slug: slug, Status: ch.Status, Title: s.titleOf(col, slug)}
		if ch.OldPath != "" {
			if _, from, ok := s.store.ResolvePath(ch.OldPath); ok {
				c.From = from
			}
		}
		out = append(out, c)
	}
	writeJSON(w, map[string]any{"changes": out, "enabled": true})
}

// publish lands the entire staging changeset onto main as one squash commit and
// (when push is enabled) pushes it. All-or-nothing - referential edits never
// land half-applied.
func (s *Server) publish(w http.ResponseWriter, _ *http.Request) {
	if s.git == nil {
		writeJSON(w, map[string]any{"published": 0, "enabled": false})
		return
	}
	// A publish must not abort partway on a client disconnect.
	raw, err := s.git.Diff(context.Background())
	if err != nil {
		fail(w, err)
		return
	}
	n, err := s.git.Publish(publishSummary(raw))
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, map[string]any{"published": n, "enabled": true})
}

// syncStatus reports the live git sync state (rev, conflict/ok, last sync/backup
// times). The web polls this: a changed rev means refetch content; a "conflict"
// state raises a reconcile banner.
func (s *Server) syncStatus(w http.ResponseWriter, _ *http.Request) {
	if s.git == nil {
		writeJSON(w, git.SyncStatus{State: "disabled"})
		return
	}
	writeJSON(w, s.git.Status())
}

// syncNow triggers a pull/reconcile on demand (the UI "retry" / "sync now"
// action), then returns the resulting status.
func (s *Server) syncNow(w http.ResponseWriter, _ *http.Request) {
	if s.git == nil {
		writeJSON(w, git.SyncStatus{State: "disabled"})
		return
	}
	if err := s.git.Sync(); err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, s.git.Status())
}

// titleOf is a best-effort human label for a resource (title/name field, else
// slug). Deleted resources are gone from the working tree, so they fall back to
// the slug.
func (s *Server) titleOf(collection, slug string) string {
	r, err := s.store.Read(collection, slug)
	if err != nil {
		return slug
	}
	for _, k := range []string{"title", "name"} {
		if v, ok := r.Fields[k].(string); ok && v != "" {
			return v
		}
	}
	return slug
}

// publishSummary builds a one-line commit message summarizing the changeset,
// e.g. "publish: 3 modified, 1 added, 1 deleted".
func publishSummary(changes []git.Change) string {
	counts := map[string]int{}
	for _, c := range changes {
		counts[c.Status]++
	}
	var parts []string
	for _, k := range []string{"added", "modified", "renamed", "deleted"} {
		if counts[k] > 0 {
			parts = append(parts, fmt.Sprintf("%d %s", counts[k], k))
		}
	}
	if len(parts) == 0 {
		return "publish"
	}
	return "publish: " + strings.Join(parts, ", ")
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

// serveRoot resolves everything that isn't an explicit API or /_app/ route:
// first the blog's public/ assets (so content paths like /posts/... and
// /assets/uploads/... resolve), then - for any other path - the editor's SPA
// shell (index.html), since the UI uses hash routing. Unmatched /api/* still
// 404s rather than returning HTML.
func (s *Server) serveRoot(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.Path, "/api/") {
		http.NotFound(w, r)
		return
	}
	clean := filepath.Clean("/" + r.URL.Path)
	if f := filepath.Join(s.publicDir, clean); clean != "/" {
		if st, err := os.Stat(f); err == nil && !st.IsDir() {
			http.ServeFile(w, r, f)
			return
		}
	}
	// Locally-uploaded media lands in the site's media input dir (e.g.
	// src/assets/uploads), served under its output prefix (e.g. /assets/uploads).
	// The blog build maps these, but scribe serves them directly so a
	// just-uploaded image previews before any build runs.
	if f, ok := s.mediaFile(clean); ok {
		http.ServeFile(w, r, f)
		return
	}
	if s.ui != nil {
		index, err := fs.ReadFile(s.ui, "index.html")
		if err == nil {
			w.Header().Set("content-type", "text/html; charset=utf-8")
			w.Write(index)
			return
		}
	}
	http.NotFound(w, r)
}

// mediaFile maps a cleaned request path under the site's media output prefix to
// the on-disk file in the media input dir, if it exists. ok is false when media
// is unconfigured, the path is outside the prefix, or the file is missing.
func (s *Server) mediaFile(clean string) (string, bool) {
	media := s.store.Schema().Media
	if media.Input == "" || media.Output == "" {
		return "", false
	}
	prefix := "/" + strings.Trim(media.Output, "/") + "/"
	if !strings.HasPrefix(clean, prefix) {
		return "", false
	}
	f := filepath.Join(s.store.Root(), filepath.FromSlash(media.Input), filepath.FromSlash(strings.TrimPrefix(clean, prefix)))
	if st, err := os.Stat(f); err == nil && !st.IsDir() {
		return f, true
	}
	return "", false
}

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
