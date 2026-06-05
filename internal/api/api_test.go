package api

import "testing"

func TestSanitizeSlug(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{"already clean", "hello-world", "hello-world"},
		{"spaces", "Hello World", "hello-world"},
		{"punctuation", "What's New?! (v2)", "what-s-new-v2"},
		{"collapse dashes", "a---b", "a-b"},
		{"trim dashes", "  -hi-  ", "hi"},
		{"path traversal", "../../etc/passwd", "etc-passwd"},
		{"empty", "   ", ""},
		{"unicode dropped", "café", "caf"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := sanitizeSlug(tt.in); got != tt.want {
				t.Errorf("sanitizeSlug(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}
