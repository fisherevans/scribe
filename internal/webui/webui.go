// Package webui embeds the built editor PWA so a single scribe binary serves
// both the API and the UI from one origin (what the mobile app connects to).
//
// On a bare checkout `dist/` holds only a placeholder, so FS reports
// unavailable and the binary runs API-only (dev uses the Vite server instead).
// The Docker build runs `npm run build` into this dir before `go build`, so the
// release image embeds the real UI.
package webui

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var embedded embed.FS

// FS returns the embedded UI (contents of dist/) and whether a real build is
// present (detected by an index.html). False on a bare checkout.
func FS() (fs.FS, bool) {
	sub, err := fs.Sub(embedded, "dist")
	if err != nil {
		return nil, false
	}
	if _, err := fs.Stat(sub, "index.html"); err != nil {
		return nil, false
	}
	return sub, true
}
