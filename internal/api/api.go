// Package api serves the editor's HTTP/JSON endpoints over a content.Store.
// Resources are returned in the shape the web app expects (kind/slug/state/
// dirty plus the type's own fields). Auth is intentionally absent here - it's
// handled by whatever fronts the service (see design.md "Auth (swappable)").
package api

import (
	"encoding/json"
	"fmt"
	"math/rand"
	"net/http"
	"strings"
	"time"

	"github.com/fisherevans/scribe/internal/content"
)

type Server struct {
	store     *content.Store
	publicDir string
}

func New(store *content.Store, publicDir string) *Server {
	return &Server{store: store, publicDir: publicDir}
}

func (s *Server) Routes() *http.ServeMux {
	mux := http.NewServeMux()
	// Serve the repo's public/ so site-relative asset paths in posts
	// (e.g. /posts/calsync/demo.svg, /assets/...) resolve in the editor. The
	// specific /api/... patterns below take precedence over this catch-all.
	mux.Handle("/", http.FileServer(http.Dir(s.publicDir)))
	mux.HandleFunc("GET /api/health", s.health)
	mux.HandleFunc("GET /api/posts", s.listPosts)
	mux.HandleFunc("POST /api/posts", s.createPost)
	mux.HandleFunc("PUT /api/posts/{slug}", s.savePost)
	mux.HandleFunc("POST /api/posts/{slug}/promote", s.promotePost)
	mux.HandleFunc("POST /api/posts/{slug}/rename", s.renamePost)
	mux.HandleFunc("GET /api/posts/{slug}/serialized", s.serializedPost) // round-trip preview
	mux.HandleFunc("GET /api/tags", s.listTags)
	mux.HandleFunc("POST /api/tags", s.createTag)
	mux.HandleFunc("PUT /api/tags/{slug}", s.saveTag)
	mux.HandleFunc("POST /api/tags/{slug}/promote", s.promoteTag)
	mux.HandleFunc("GET /api/snippets", emptyList) // not repo-backed; UI demo only
	return mux
}

// ---- resource envelopes -------------------------------------------------

type postResource struct {
	Kind string `json:"kind"`
	content.Post
	State string `json:"state"`
	Dirty bool   `json:"dirty"`
	Notes string `json:"notes"`
}

func wrapPost(p content.Post) postResource {
	return postResource{Kind: "posts", Post: p, State: "promoted", Dirty: false, Notes: ""}
}

type tagResource struct {
	Kind string `json:"kind"`
	content.Tag
	State string `json:"state"`
	Dirty bool   `json:"dirty"`
}

func wrapTag(t content.Tag) tagResource {
	return tagResource{Kind: "tags", Tag: t, State: "promoted", Dirty: false}
}

// ---- posts --------------------------------------------------------------

func (s *Server) listPosts(w http.ResponseWriter, _ *http.Request) {
	posts, err := s.store.ListPosts()
	if err != nil {
		fail(w, err)
		return
	}
	out := make([]postResource, len(posts))
	for i, p := range posts {
		out[i] = wrapPost(p)
	}
	writeJSON(w, out)
}

func (s *Server) savePost(w http.ResponseWriter, r *http.Request) {
	var in postResource
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		fail(w, err)
		return
	}
	in.Post.Slug = r.PathValue("slug")
	if err := s.store.WritePost(in.Post); err != nil {
		fail(w, err)
		return
	}
	saved, err := s.store.ReadPost(in.Post.Slug)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, wrapPost(*saved))
}

func (s *Server) createPost(w http.ResponseWriter, _ *http.Request) {
	// No disk write until the first save - avoids littering the repo with empty
	// drafts. The web prepends this to its list and writes the file on edit.
	p := content.Post{
		Slug:  fmt.Sprintf("untitled-%s", randSuffix()),
		Date:  time.Now().Format("2006-01-02"),
		Draft: true,
		Tags:  []string{}, // marshal as [] not null, so the client can read it
		Body:  "",
	}
	res := wrapPost(p)
	res.State = "staged"
	writeJSON(w, res)
}

func (s *Server) promotePost(w http.ResponseWriter, r *http.Request) {
	// Staging/promote needs git; until then a save already lands in the working
	// tree, so promote is a no-op that just echoes the current resource.
	saved, err := s.store.ReadPost(r.PathValue("slug"))
	if err != nil {
		fail(w, err)
		return
	}
	res := wrapPost(*saved)
	writeJSON(w, res)
}

func (s *Server) renamePost(w http.ResponseWriter, r *http.Request) {
	var in struct {
		To string `json:"to"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		fail(w, err)
		return
	}
	from := r.PathValue("slug")
	to := sanitizeSlug(in.To)
	if to == "" {
		http.Error(w, "invalid slug", http.StatusBadRequest)
		return
	}
	if to == from {
		writeJSON(w, map[string]string{"slug": from})
		return
	}
	if err := s.store.RenamePost(from, to); err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	writeJSON(w, map[string]string{"slug": to})
}

func (s *Server) serializedPost(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	p, err := s.store.ReadPost(slug)
	if err != nil {
		fail(w, err)
		return
	}
	w.Header().Set("content-type", "text/plain; charset=utf-8")
	w.Write(s.store.SerializePost(*p))
}

// ---- tags ---------------------------------------------------------------

func (s *Server) listTags(w http.ResponseWriter, _ *http.Request) {
	tags, err := s.store.ListTags()
	if err != nil {
		fail(w, err)
		return
	}
	out := make([]tagResource, len(tags))
	for i, t := range tags {
		out[i] = wrapTag(t)
	}
	writeJSON(w, out)
}

func (s *Server) saveTag(w http.ResponseWriter, r *http.Request) {
	var in tagResource
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		fail(w, err)
		return
	}
	in.Tag.Slug = r.PathValue("slug")
	if err := s.store.WriteTag(in.Tag); err != nil {
		fail(w, err)
		return
	}
	saved, err := s.store.ReadTag(in.Tag.Slug)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, wrapTag(*saved))
}

func (s *Server) createTag(w http.ResponseWriter, _ *http.Request) {
	t := content.Tag{Slug: fmt.Sprintf("untitled-%s", randSuffix())}
	res := wrapTag(t)
	res.State = "staged"
	writeJSON(w, res)
}

func (s *Server) promoteTag(w http.ResponseWriter, r *http.Request) {
	saved, err := s.store.ReadTag(r.PathValue("slug"))
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, wrapTag(*saved))
}

// ---- helpers ------------------------------------------------------------

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, map[string]string{"status": "ok"})
}

func emptyList(w http.ResponseWriter, _ *http.Request) { writeJSON(w, []struct{}{}) }

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("content-type", "application/json")
	if err := json.NewEncoder(w).Encode(v); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

func fail(w http.ResponseWriter, err error) {
	http.Error(w, err.Error(), http.StatusInternalServerError)
}

// sanitizeSlug defensively normalizes a client-supplied slug to filename-safe
// chars (the client slugifies too; this is the backstop against path tricks).
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
	const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
	b := make([]byte, 4)
	for i := range b {
		b[i] = alphabet[rand.Intn(len(alphabet))]
	}
	return string(b)
}
