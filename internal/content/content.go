// Package content reads and writes the blog's on-disk source: markdown posts
// with YAML frontmatter, and YAML tag files. It is the file-I/O half of scribe;
// the markdown<->editor round-trip happens in the browser, so the body is
// passed through here as opaque markdown text.
//
// Frontmatter is re-emitted in a fixed canonical style (see marshalFrontmatter).
// That means the first save of a hand-written file may normalize cosmetic YAML
// (quoting, a folded description collapsing to one line), but field values are
// preserved. Body bytes are written exactly as received.
package content

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"
)

// Post mirrors the posts schema in src/content.config.ts. Every field is
// preserved on round-trip so a save never silently drops frontmatter.
type Post struct {
	Slug        string   `json:"slug"`
	Title       string   `json:"title"`
	Date        string   `json:"date"`
	Description string   `json:"description"`
	Tags        []string `json:"tags"`
	HasVideo    bool     `json:"hasVideo"`
	HeroImage   string   `json:"heroImage"`
	UpdatedDate string   `json:"updatedDate"`
	Draft       bool     `json:"draft"`
	Body        string   `json:"body"`
}

// Tag mirrors the tags schema (YAML files, name + description).
type Tag struct {
	Slug        string `json:"slug"`
	Name        string `json:"name"`
	Description string `json:"description"`
}

type fmYAML struct {
	Title       string   `yaml:"title"`
	Date        string   `yaml:"date"`
	Description string   `yaml:"description"`
	Tags        []string `yaml:"tags"`
	HasVideo    bool     `yaml:"hasVideo"`
	HeroImage   string   `yaml:"heroImage"`
	UpdatedDate string   `yaml:"updatedDate"`
	Draft       bool     `yaml:"draft"`
}

// Store is rooted at a blog repo checkout.
type Store struct {
	repo string
}

func NewStore(repo string) *Store { return &Store{repo: repo} }

func (s *Store) postsDir() string { return filepath.Join(s.repo, "src", "content", "posts") }
func (s *Store) tagsDir() string  { return filepath.Join(s.repo, "src", "content", "tags") }
func (s *Store) postPath(slug string) string {
	return filepath.Join(s.postsDir(), slug+".md")
}
func (s *Store) tagPath(slug string) string {
	return filepath.Join(s.tagsDir(), slug+".yaml")
}

// ---- Posts --------------------------------------------------------------

func (s *Store) ListPosts() ([]Post, error) {
	entries, err := os.ReadDir(s.postsDir())
	if err != nil {
		return nil, fmt.Errorf("read posts dir: %w", err)
	}
	var posts []Post
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".md") {
			continue
		}
		slug := strings.TrimSuffix(e.Name(), ".md")
		p, err := s.ReadPost(slug)
		if err != nil {
			return nil, err
		}
		posts = append(posts, *p)
	}
	// Newest first by frontmatter date string (yyyy-mm-dd sorts lexically).
	sort.Slice(posts, func(i, j int) bool { return posts[i].Date > posts[j].Date })
	return posts, nil
}

func (s *Store) ReadPost(slug string) (*Post, error) {
	raw, err := os.ReadFile(s.postPath(slug))
	if err != nil {
		return nil, fmt.Errorf("read post %q: %w", slug, err)
	}
	front, body := splitFrontmatter(raw)
	var fm fmYAML
	if len(front) > 0 {
		if err := yaml.Unmarshal(front, &fm); err != nil {
			return nil, fmt.Errorf("parse frontmatter %q: %w", slug, err)
		}
	}
	if fm.Tags == nil {
		fm.Tags = []string{} // marshal as [] not null, so the client can read .length
	}
	return &Post{
		Slug:        slug,
		Title:       fm.Title,
		Date:        fm.Date,
		Description: fm.Description,
		Tags:        fm.Tags,
		HasVideo:    fm.HasVideo,
		HeroImage:   fm.HeroImage,
		UpdatedDate: fm.UpdatedDate,
		Draft:       fm.Draft,
		Body:        body,
	}, nil
}

func (s *Store) WritePost(p Post) error {
	front := marshalFrontmatter(p)
	body := strings.TrimLeft(p.Body, "\n")
	out := "---\n" + front + "---\n" + body
	if !strings.HasSuffix(out, "\n") {
		out += "\n"
	}
	return os.WriteFile(s.postPath(p.Slug), []byte(out), 0o644)
}

// SerializePost returns the bytes WritePost would write, without touching disk.
// Used to preview round-trip fidelity before any real save.
func (s *Store) SerializePost(p Post) []byte {
	front := marshalFrontmatter(p)
	body := strings.TrimLeft(p.Body, "\n")
	out := "---\n" + front + "---\n" + body
	if !strings.HasSuffix(out, "\n") {
		out += "\n"
	}
	return []byte(out)
}

// ---- Tags ---------------------------------------------------------------

func (s *Store) ListTags() ([]Tag, error) {
	entries, err := os.ReadDir(s.tagsDir())
	if err != nil {
		return nil, fmt.Errorf("read tags dir: %w", err)
	}
	var tags []Tag
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".yaml") {
			continue
		}
		slug := strings.TrimSuffix(e.Name(), ".yaml")
		t, err := s.ReadTag(slug)
		if err != nil {
			return nil, err
		}
		tags = append(tags, *t)
	}
	sort.Slice(tags, func(i, j int) bool { return tags[i].Slug < tags[j].Slug })
	return tags, nil
}

func (s *Store) ReadTag(slug string) (*Tag, error) {
	raw, err := os.ReadFile(s.tagPath(slug))
	if err != nil {
		return nil, fmt.Errorf("read tag %q: %w", slug, err)
	}
	var t struct {
		Name        string `yaml:"name"`
		Description string `yaml:"description"`
	}
	if err := yaml.Unmarshal(raw, &t); err != nil {
		return nil, fmt.Errorf("parse tag %q: %w", slug, err)
	}
	return &Tag{Slug: slug, Name: t.Name, Description: t.Description}, nil
}

func (s *Store) WriteTag(t Tag) error {
	var b strings.Builder
	b.WriteString("name: " + yamlScalar(t.Name) + "\n")
	if t.Description != "" {
		b.WriteString("description: " + yamlScalar(t.Description) + "\n")
	}
	return os.WriteFile(s.tagPath(t.Slug), []byte(b.String()), 0o644)
}

// ---- frontmatter (de)serialization -------------------------------------

// splitFrontmatter peels a leading `---\n…\n---` block, returning the YAML
// bytes and the remaining body.
func splitFrontmatter(raw []byte) (front []byte, body string) {
	s := string(raw)
	if !strings.HasPrefix(s, "---\n") && !strings.HasPrefix(s, "---\r\n") {
		return nil, s
	}
	rest := s[strings.IndexByte(s, '\n')+1:]
	end := strings.Index(rest, "\n---")
	if end < 0 {
		return nil, s
	}
	front = []byte(rest[:end+1])
	after := rest[end+len("\n---"):]
	after = strings.TrimPrefix(after, "\r")
	after = strings.TrimPrefix(after, "\n")
	return front, strings.TrimLeft(after, "\n")
}

// marshalFrontmatter emits the known fields in schema order, in a canonical
// style: bare bool/date scalars, a block list for tags, and quoting only when
// a string needs it. bools and date always render; optional strings are
// omitted when empty.
func marshalFrontmatter(p Post) string {
	var b strings.Builder
	b.WriteString("title: " + yamlScalar(p.Title) + "\n")
	if p.Date != "" {
		b.WriteString("date: " + p.Date + "\n")
	}
	if p.Description != "" {
		b.WriteString("description: " + yamlScalar(p.Description) + "\n")
	}
	if len(p.Tags) > 0 {
		b.WriteString("tags:\n")
		for _, t := range p.Tags {
			b.WriteString("  - " + t + "\n")
		}
	}
	b.WriteString(fmt.Sprintf("hasVideo: %t\n", p.HasVideo))
	if p.HeroImage != "" {
		b.WriteString("heroImage: " + yamlScalar(p.HeroImage) + "\n")
	}
	if p.UpdatedDate != "" {
		b.WriteString("updatedDate: " + p.UpdatedDate + "\n")
	}
	b.WriteString(fmt.Sprintf("draft: %t\n", p.Draft))
	return b.String()
}

// yamlScalar quotes a string only when YAML would otherwise misread it (special
// leading chars, colons, or strings that resemble another type). Uses yaml.v3
// to do the escaping so edge cases are handled correctly, then strips the
// trailing newline.
func yamlScalar(v string) string {
	out, err := yaml.Marshal(v)
	if err != nil {
		return fmt.Sprintf("%q", v)
	}
	return strings.TrimRight(string(out), "\n")
}
