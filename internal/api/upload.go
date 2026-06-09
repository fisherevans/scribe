package api

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"strings"
)

// maxUploadBytes caps a single image upload. Generous for photos, small enough
// to keep a stray file from filling the disk.
const maxUploadBytes = 32 << 20 // 32 MiB

// upload accepts a multipart image and resolves it to a URL the editor inserts.
//
// Form fields:
//   - file: the image bytes (required)
//   - dest: "external" (the configured upload command / CDN) or "local"
//     (copied into the site media dir). Defaults to local.
//   - name: chosen base filename, no extension (the original extension is kept).
//     Empty falls back to the uploaded file's name.
//   - slug: the post being edited, used to group local uploads per-post under
//     the media dir. Empty drops the file at the media dir root.
//
// Two resolution paths, mirroring design.md "Media via an upload plugin":
//   - external: the bytes are spooled to a temp file and SCRIBE_UPLOAD_CMD is
//     run with SCRIBE_UPLOAD_* env vars; its stdout (trimmed) is the URL. This
//     is the swappable hook - R2, S3, scp, anything.
//   - local: the file is copied into the site's media input dir (per-post when a
//     slug is given) and the matching output URL is returned.
func (s *Server) upload(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxUploadBytes)
	file, hdr, err := r.FormFile("file")
	if err != nil {
		http.Error(w, "expected a multipart form field 'file': "+err.Error(), http.StatusBadRequest)
		return
	}
	defer file.Close()

	ext := strings.ToLower(filepath.Ext(safeFilename(hdr.Filename)))
	base := sanitizeSlug(r.FormValue("name"))
	if base == "" {
		base = strings.TrimSuffix(safeFilename(hdr.Filename), ext)
	}
	if base == "" {
		base = "image"
	}
	name := base + ext

	if r.FormValue("dest") == "external" {
		if s.uploadCmd == "" {
			http.Error(w, "external upload not configured (set SCRIBE_UPLOAD_CMD)", http.StatusBadRequest)
			return
		}
		url, err := s.uploadViaCmd(file, name, ext, hdr.Header.Get("Content-Type"), sanitizeSlug(r.FormValue("slug")))
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, map[string]string{"url": url})
		return
	}

	url, err := s.uploadToMediaDir(file, sanitizeSlug(r.FormValue("slug")), name)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, map[string]string{"url": url})
}

// mediaImageExts are the extensions listMedia surfaces for the repo image
// browser.
var mediaImageExts = map[string]bool{
	".png": true, ".jpg": true, ".jpeg": true, ".gif": true, ".webp": true, ".svg": true, ".avif": true,
}

// mediaItem is one browsable in-repo image: its public URL plus a display name.
type mediaItem struct {
	Name string `json:"name"`
	URL  string `json:"url"`
}

// media lists in-repo images the editor can reuse: the post's own folder
// (media.input/<slug>) first, then the media root. Empty when media is
// unconfigured. Drives the "browse repo images" picker in the image modal.
func (s *Server) media(w http.ResponseWriter, r *http.Request) {
	cfg := s.store.Schema().Media
	if cfg.Input == "" || cfg.Output == "" {
		writeJSON(w, map[string]any{"items": []mediaItem{}})
		return
	}
	root := filepath.Join(s.store.Root(), filepath.FromSlash(cfg.Input))
	out := []mediaItem{}
	seen := map[string]bool{}
	if slug := sanitizeSlug(r.URL.Query().Get("slug")); slug != "" {
		out = append(out, listImages(filepath.Join(root, slug), cfg.Output, slug, seen)...)
	}
	out = append(out, listImages(root, cfg.Output, "", seen)...)
	writeJSON(w, map[string]any{"items": out})
}

// listImages returns the image files directly in dir as media items, their URLs
// built from the output prefix (+ optional sub path). Missing dirs yield none.
func listImages(dir, output, sub string, seen map[string]bool) []mediaItem {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	items := []mediaItem{}
	for _, e := range entries {
		if e.IsDir() || !mediaImageExts[strings.ToLower(filepath.Ext(e.Name()))] {
			continue
		}
		url := path.Join("/", strings.Trim(output, "/"), sub, e.Name())
		if seen[url] {
			continue
		}
		seen[url] = true
		items = append(items, mediaItem{Name: e.Name(), URL: url})
	}
	return items
}

// capabilities reports optional features the UI adapts to. external upload is
// available only when an upload command is configured.
func (s *Server) capabilities(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, map[string]any{
		"upload": map[string]any{"external": s.uploadCmd != ""},
	})
}

// uploadViaCmd spools the upload to a temp file and runs the configured command,
// passing the file's location and metadata via env. The command writes the
// public URL to stdout.
func (s *Server) uploadViaCmd(file io.Reader, name, ext, contentType, slug string) (string, error) {
	tmp, err := os.CreateTemp("", "scribe-upload-*"+ext)
	if err != nil {
		return "", fmt.Errorf("create temp file: %w", err)
	}
	defer os.Remove(tmp.Name())
	if _, err := io.Copy(tmp, file); err != nil {
		tmp.Close()
		return "", fmt.Errorf("buffer upload: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return "", err
	}

	cmd := exec.Command("sh", "-c", s.uploadCmd)
	cmd.Env = append(os.Environ(),
		"SCRIBE_UPLOAD_FILE="+tmp.Name(),
		"SCRIBE_UPLOAD_NAME="+name,
		"SCRIBE_UPLOAD_EXT="+ext,
		"SCRIBE_UPLOAD_TYPE="+contentType,
		"SCRIBE_UPLOAD_SLUG="+slug, // the post being edited; e.g. an R2 key namespace
	)
	out, err := cmd.Output()
	if err != nil {
		if ee, ok := err.(*exec.ExitError); ok {
			return "", fmt.Errorf("upload command failed: %s", strings.TrimSpace(string(ee.Stderr)))
		}
		return "", fmt.Errorf("run upload command: %w", err)
	}
	url := strings.TrimSpace(string(out))
	if url == "" {
		return "", fmt.Errorf("upload command produced no URL on stdout")
	}
	return url, nil
}

// uploadToMediaDir copies the upload into the site's media input dir (under a
// per-post subdir when slug is set) and returns its public URL. Requires media
// to be configured in .pages.yml.
func (s *Server) uploadToMediaDir(file io.Reader, slug, name string) (string, error) {
	media := s.store.Schema().Media
	if media.Input == "" || media.Output == "" {
		return "", fmt.Errorf("no upload command configured and the site has no media input/output set in .pages.yml; set SCRIBE_UPLOAD_CMD")
	}
	dir := filepath.Join(s.store.Root(), filepath.FromSlash(media.Input))
	if slug != "" {
		dir = filepath.Join(dir, slug)
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", fmt.Errorf("create media dir: %w", err)
	}
	name = uniqueName(dir, name)
	dst, err := os.Create(filepath.Join(dir, name))
	if err != nil {
		return "", fmt.Errorf("create media file: %w", err)
	}
	if _, err := io.Copy(dst, file); err != nil {
		dst.Close()
		return "", fmt.Errorf("write media file: %w", err)
	}
	if err := dst.Close(); err != nil {
		return "", err
	}
	return path.Join("/", strings.Trim(media.Output, "/"), slug, name), nil
}

// safeFilename reduces a client filename to a path-safe basename, preserving the
// extension. Empty/odd names fall back to "upload".
func safeFilename(name string) string {
	name = filepath.Base(filepath.FromSlash(name))
	ext := filepath.Ext(name)
	base := strings.TrimSuffix(name, ext)
	base = sanitizeSlug(base)
	if base == "" {
		base = "upload"
	}
	ext = strings.ToLower(ext)
	var b strings.Builder
	for _, r := range ext {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '.' {
			b.WriteRune(r)
		}
	}
	return base + b.String()
}

// uniqueName avoids clobbering an existing file in dir by appending a random
// suffix to the base when the name is already taken.
func uniqueName(dir, name string) string {
	if _, err := os.Stat(filepath.Join(dir, name)); os.IsNotExist(err) {
		return name
	}
	ext := filepath.Ext(name)
	return strings.TrimSuffix(name, ext) + "-" + randSuffix() + ext
}
