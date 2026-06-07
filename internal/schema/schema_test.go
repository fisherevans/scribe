package schema

import "testing"

const sample = `
media:
  input: src/assets/uploads
  output: /assets/uploads
content:
  - name: tags
    label: Tags
    path: src/content/tags
    type: collection
    filename: "{slug}.yaml"
    format: yaml
    fields:
      - name: name
        label: Name
        type: string
        required: true
      - name: description
        type: string
  - name: posts
    label: Posts
    path: src/content/posts
    type: collection
    format: yaml-frontmatter
    filename: '{primary}.md'
    fields:
      - name: title
        type: string
        required: true
      - name: date
        type: date
        required: true
      - name: tags
        type: string
        list: true
      - name: draft
        type: boolean
  - name: about
    label: About
    path: src/pages/about.astro
    type: file
    fields:
      - name: body
        type: code
settings:
  primary: posts
`

func TestParse(t *testing.T) {
	s, err := Parse([]byte(sample))
	if err != nil {
		t.Fatal(err)
	}
	if s.Primary != "posts" {
		t.Errorf("primary = %q", s.Primary)
	}
	// file-typed "about" is skipped
	if len(s.Collections) != 2 {
		t.Fatalf("collections = %d, want 2 (about should be skipped)", len(s.Collections))
	}

	tags, ok := s.Collection("tags")
	if !ok {
		t.Fatal("tags collection missing")
	}
	if tags.Format != "yaml" || tags.Ext != ".yaml" || tags.Path != "src/content/tags" {
		t.Errorf("tags = %+v", tags)
	}
	if name, _ := tags.Field("name"); name == nil || !name.Required {
		t.Errorf("tags.name should be required")
	}

	posts, ok := s.Collection("posts")
	if !ok {
		t.Fatal("posts collection missing")
	}
	if posts.Format != "yaml-frontmatter" || posts.Ext != ".md" {
		t.Errorf("posts format/ext = %q/%q", posts.Format, posts.Ext)
	}
	if tagsField, _ := posts.Field("tags"); tagsField == nil || !tagsField.List {
		t.Errorf("posts.tags should be a list")
	}
	if draft, _ := posts.Field("draft"); draft == nil || draft.Type != "boolean" {
		t.Errorf("posts.draft should be boolean")
	}
}

func TestFieldLabelDefaultsToName(t *testing.T) {
	s, _ := Parse([]byte(sample))
	posts, _ := s.Collection("posts")
	title, _ := posts.Field("title")
	if title.Label != "title" {
		t.Errorf("label without explicit value should default to name, got %q", title.Label)
	}
}
