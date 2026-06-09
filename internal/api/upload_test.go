package api

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/fisherevans/scribe/internal/content"
	"github.com/fisherevans/scribe/internal/schema"
)

func TestSafeFilename(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{"clean", "sunset.jpg", "sunset.jpg"},
		{"spaces and caps", "My Photo.PNG", "my-photo.png"},
		{"path stripped", "../../etc/evil.gif", "evil.gif"},
		{"no ext", "banner", "banner"},
		{"weird base", "What's New?!.jpeg", "what-s-new.jpeg"},
		{"empty base", ".png", "upload.png"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := safeFilename(tt.in); got != tt.want {
				t.Errorf("safeFilename(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}

// serverWithMedia builds a Server rooted at a temp repo whose schema declares a
// media input/output, with the given upload command.
func serverWithMedia(t *testing.T, uploadCmd string) (*Server, string) {
	t.Helper()
	repo := t.TempDir()
	sch := &schema.Schema{Media: schema.Media{Input: "src/assets/uploads", Output: "/assets/uploads"}}
	return &Server{store: content.NewStore(repo, sch), uploadCmd: uploadCmd}, repo
}

func uploadRequest(t *testing.T, filename string, body []byte, fields map[string]string) *http.Request {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	fw, err := mw.CreateFormFile("file", filename)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fw.Write(body); err != nil {
		t.Fatal(err)
	}
	for k, v := range fields {
		if err := mw.WriteField(k, v); err != nil {
			t.Fatal(err)
		}
	}
	mw.Close()
	req := httptest.NewRequest(http.MethodPost, "/api/upload", &buf)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	return req
}

func decodeURL(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var out map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	return out["url"]
}

func TestUploadToMediaDir(t *testing.T) {
	s, repo := serverWithMedia(t, "")
	// name field overrides the clipboard filename; extension is preserved.
	rec := httptest.NewRecorder()
	s.upload(rec, uploadRequest(t, "image.png", []byte("fake-image-bytes"), map[string]string{"name": "Sunset Photo"}))

	if got, want := decodeURL(t, rec), "/assets/uploads/sunset-photo.png"; got != want {
		t.Errorf("url = %q, want %q", got, want)
	}
	got, err := os.ReadFile(filepath.Join(repo, "src/assets/uploads", "sunset-photo.png"))
	if err != nil {
		t.Fatalf("expected file written: %v", err)
	}
	if string(got) != "fake-image-bytes" {
		t.Errorf("file contents = %q", got)
	}
}

func TestUploadPerPost(t *testing.T) {
	s, repo := serverWithMedia(t, "")
	rec := httptest.NewRecorder()
	s.upload(rec, uploadRequest(t, "shot.jpg", []byte("x"), map[string]string{"slug": "my-post"}))

	if got, want := decodeURL(t, rec), "/assets/uploads/my-post/shot.jpg"; got != want {
		t.Errorf("url = %q, want %q", got, want)
	}
	if _, err := os.Stat(filepath.Join(repo, "src/assets/uploads", "my-post", "shot.jpg")); err != nil {
		t.Fatalf("expected per-post file written: %v", err)
	}
}

func TestUploadExternal(t *testing.T) {
	// The command echoes a URL derived from the env scribe passes it, proving the
	// chosen name reaches the command and its stdout becomes the URL.
	cmd := `printf 'https://cdn.example/%s' "$SCRIBE_UPLOAD_NAME"`
	s, _ := serverWithMedia(t, cmd)
	rec := httptest.NewRecorder()
	s.upload(rec, uploadRequest(t, "image.png", []byte("x"), map[string]string{"dest": "external", "name": "diagram"}))

	if got, want := decodeURL(t, rec), "https://cdn.example/diagram.png"; got != want {
		t.Errorf("url = %q, want %q", got, want)
	}
}

func TestUploadExternalUnconfigured(t *testing.T) {
	s, _ := serverWithMedia(t, "") // no upload command
	rec := httptest.NewRecorder()
	s.upload(rec, uploadRequest(t, "x.png", []byte("x"), map[string]string{"dest": "external"}))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d (body %s)", rec.Code, rec.Body.String())
	}
}

func TestMediaList(t *testing.T) {
	s, repo := serverWithMedia(t, "")
	root := filepath.Join(repo, "src/assets/uploads")
	if err := os.MkdirAll(filepath.Join(root, "my-post"), 0o755); err != nil {
		t.Fatal(err)
	}
	write := func(p string) {
		if err := os.WriteFile(p, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write(filepath.Join(root, "loose.png"))
	write(filepath.Join(root, "notes.txt")) // non-image, must be skipped
	write(filepath.Join(root, "my-post", "hero.jpg"))

	req := httptest.NewRequest(http.MethodGet, "/api/media?slug=my-post", nil)
	rec := httptest.NewRecorder()
	s.media(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	var out struct {
		Items []mediaItem `json:"items"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	// Per-post image first, then the root image; the .txt is excluded.
	var got []string
	for _, it := range out.Items {
		got = append(got, it.URL)
	}
	want := []string{"/assets/uploads/my-post/hero.jpg", "/assets/uploads/loose.png"}
	if len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Errorf("media urls = %v, want %v", got, want)
	}
}

func TestUploadNoMediaNoCmd(t *testing.T) {
	repo := t.TempDir()
	s := &Server{store: content.NewStore(repo, &schema.Schema{})}
	rec := httptest.NewRecorder()
	s.upload(rec, uploadRequest(t, "x.png", []byte("x"), nil))
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected error status, got %d (body %s)", rec.Code, rec.Body.String())
	}
}
