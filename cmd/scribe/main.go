// Command scribe runs the writing-tool service: file I/O over a blog repo
// checkout plus the HTTP/JSON API for the editor PWA. Auth, git staging, and
// the metadata store are layered on later (see docs/design.md).
package main

import (
	"context"
	"errors"
	"flag"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"time"

	"github.com/fisherevans/scribe/internal/api"
	"github.com/fisherevans/scribe/internal/content"
	"github.com/fisherevans/scribe/internal/schema"
	"github.com/fisherevans/scribe/internal/store"
)

func main() {
	addr := flag.String("addr", envOr("SCRIBE_ADDR", ":8080"), "listen address")
	repo := flag.String("repo", os.Getenv("SCRIBE_REPO"), "path to the blog repo checkout")
	data := flag.String("data", envOr("SCRIBE_DATA", defaultDataDir()), "dir for private app-side data (notes); never the repo")
	flag.Parse()

	log := slog.New(slog.NewTextHandler(os.Stdout, nil))

	if *repo == "" {
		log.Error("no repo configured: set --repo or SCRIBE_REPO")
		os.Exit(1)
	}
	if _, err := os.Stat(*repo); err != nil {
		log.Error("repo path not accessible", "repo", *repo, "err", err)
		os.Exit(1)
	}

	sch, err := schema.Load(*repo)
	if err != nil {
		log.Error("failed to read .pages.yml", "repo", *repo, "err", err)
		os.Exit(1)
	}
	log.Info("loaded schema", "collections", len(sch.Collections))

	cstore := content.NewStore(*repo, sch)
	notes, err := store.OpenNotes(filepath.Join(*data, "notes.json"))
	if err != nil {
		log.Error("failed to open notes store", "data", *data, "err", err)
		os.Exit(1)
	}
	publicDir := filepath.Join(*repo, "public")
	srv := &http.Server{
		Addr:              *addr,
		Handler:           api.New(cstore, notes, publicDir).Routes(),
		ReadHeaderTimeout: 5 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()

	go func() {
		log.Info("scribe listening", "addr", *addr, "repo", *repo)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("server error", "err", err)
			stop()
		}
	}()

	<-ctx.Done()
	log.Info("shutting down")
	shutCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutCtx); err != nil {
		log.Error("shutdown error", "err", err)
	}
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// defaultDataDir keeps private notes out of the repo, under the user's config dir.
func defaultDataDir() string {
	if dir, err := os.UserConfigDir(); err == nil {
		return filepath.Join(dir, "scribe")
	}
	return ".scribe-data"
}
