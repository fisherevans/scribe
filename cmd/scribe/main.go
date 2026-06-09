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

	"io/fs"

	"github.com/fisherevans/scribe/internal/api"
	"github.com/fisherevans/scribe/internal/content"
	"github.com/fisherevans/scribe/internal/git"
	"github.com/fisherevans/scribe/internal/mapping"
	"github.com/fisherevans/scribe/internal/schema"
	"github.com/fisherevans/scribe/internal/store"
	"github.com/fisherevans/scribe/internal/webui"
)

func main() {
	addr := flag.String("addr", envOr("SCRIBE_ADDR", ":8080"), "listen address")
	repo := flag.String("repo", os.Getenv("SCRIBE_REPO"), "path to the blog repo checkout")
	data := flag.String("data", envOr("SCRIBE_DATA", defaultDataDir()), "dir for private app-side data (notes); never the repo")
	noGit := flag.Bool("no-git", envBool("SCRIBE_NO_GIT"), "disable the git staging/promote layer (write-only to the working tree)")
	stagingBranch := flag.String("staging-branch", envOr("SCRIBE_STAGING_BRANCH", "staging"), "branch edits are committed to")
	mainBranch := flag.String("main-branch", os.Getenv("SCRIBE_MAIN_BRANCH"), "branch promote publishes to (default: current branch)")
	push := flag.Bool("push", envBool("SCRIBE_PUSH"), "push staging/main to origin on commit/promote")
	backupInterval := flag.Duration("backup-interval", envDur("SCRIBE_BACKUP_INTERVAL", 2*time.Minute), "how often to back up staging to origin")
	syncInterval := flag.Duration("sync-interval", envDur("SCRIBE_SYNC_INTERVAL", time.Minute), "how often to pull external edits to the publish branch")
	webDir := flag.String("web-dir", os.Getenv("SCRIBE_WEB_DIR"), "serve the built UI from this dir (overrides the embedded build)")
	uploadCmd := flag.String("upload-cmd", os.Getenv("SCRIBE_UPLOAD_CMD"), "shell command run per image upload; receives SCRIBE_UPLOAD_FILE/NAME/EXT/TYPE in env and must print the resulting URL to stdout. Empty: copy into the site's media dir")
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
	mstore := mapping.NewStore(*repo)
	publicDir := filepath.Join(*repo, "public")

	// Git staging/promote layer. Enabled by default when the repo is a git work
	// tree; a clean tree is required so scribe can own the staging branch. On
	// failure we log and run write-only rather than refuse to start.
	var grepo *git.Repo
	if !*noGit {
		grepo, err = git.Open(*repo, *stagingBranch, *mainBranch, *push)
		if err != nil {
			log.Warn("git sync disabled, running write-only", "err", err)
		} else {
			st, mn := grepo.Branches()
			log.Info("git sync enabled", "staging", st, "main", mn, "push", *push)
		}
	}

	// Editor UI: a --web-dir on disk wins, else the build embedded at compile
	// time. nil means API-only (dev serves the UI from Vite instead).
	var ui fs.FS
	if *webDir != "" {
		ui = os.DirFS(*webDir)
		log.Info("serving UI from dir", "dir", *webDir)
	} else if embedded, ok := webui.FS(); ok {
		ui = embedded
		log.Info("serving embedded UI")
	} else {
		log.Info("no UI bundled, running API-only (use the Vite dev server for the UI)")
	}

	srv := &http.Server{
		Addr:              *addr,
		Handler:           api.New(cstore, notes, mstore, grepo, publicDir, *uploadCmd, ui).Routes(),
		ReadHeaderTimeout: 5 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()

	// Background sync: when pushing to a remote, periodically back up staging
	// (redundancy) and pull external edits to the publish branch (e.g. posts
	// written in Pages CMS), rebasing staging on top. Conflicts are surfaced,
	// never auto-resolved.
	if grepo != nil && *push {
		go ticker(ctx, *backupInterval, func() {
			if err := grepo.BackupPush(); err != nil {
				log.Warn("backup push failed", "err", err)
			}
		})
		go ticker(ctx, *syncInterval, func() {
			if err := grepo.Sync(); err != nil {
				log.Warn("sync failed", "err", err)
			}
		})
		log.Info("background sync running", "backup", *backupInterval, "sync", *syncInterval)
	}

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

func envBool(key string) bool {
	v := os.Getenv(key)
	return v == "1" || v == "true"
}

func envDur(key string, def time.Duration) time.Duration {
	if v := os.Getenv(key); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return def
}

// ticker runs fn every interval until ctx is cancelled. fn must not block long.
func ticker(ctx context.Context, interval time.Duration, fn func()) {
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			fn()
		}
	}
}

// defaultDataDir keeps private notes out of the repo, under the user's config dir.
func defaultDataDir() string {
	if dir, err := os.UserConfigDir(); err == nil {
		return filepath.Join(dir, "scribe")
	}
	return ".scribe-data"
}
