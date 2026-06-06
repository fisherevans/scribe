# scribe

**scribe is a publishing client for Pages-CMS-backed sites.** It makes writing
and managing your site's content delightful - and it does so against *whatever
structure you already set up*, not a structure it imposes.

## The vision (read this first)

Pages CMS lets you define a site with any collections and any fields you want.
That flexibility is the point - and it's also why editing through a generic CMS
form is a chore. scribe's job is to sit on top of your repo and give you a
first-class writing and content-management experience tuned to *your* shapes.

What scribe **is**:

- A **content publishing tool.** You write posts, manage tags, update metadata,
  and publish. That's it.
- **Schema-driven.** It reads your `.pages.yml`, auto-detects your collections
  and fields, and helps you map them to editing experiences through a UI.
- **Extensible by design.** The editing experience for each content type is a
  **plugin**. scribe ships excellent core plugins (a real block editor for blog
  posts, a tag manager) and exposes the same SDK they're built on, so anyone can
  extend, replace, or fork them - as a public package or a local deployment.
- **Lossless.** Anything scribe doesn't have a dedicated editor for is preserved
  verbatim and editable as raw fields. Your data is never dropped or reshaped.

What scribe is **not**:

- Not a website builder. It does not design layouts, themes, or render templates.
- Not a schema designer. It does not define your resource types - Pages CMS does.
  scribe *accommodates* them.

The endgame: someone with an ordinary blog gets a beautiful post + tag editor out
of the box. Someone with a weird, bespoke setup ("I use three kinds of tags and a
`project` type") maps their types in the UI, leans on the raw-field editor for the
rest, and forks a plugin when they want something custom. Same tool, any site.

See **[docs/extensibility.md](docs/extensibility.md)** for the architecture and
milestone roadmap, and **[docs/design.md](docs/design.md)** for the bootstrap
slice this was built on.

## Status

A working vertical slice for one site (`log.fisher.sh`): reads/writes the real
repo, full markdown round-trip including verbatim raw HTML, block editor (slash
commands, tables, images, callouts, embeds, drag-to-reorder, bubble toolbar +
links), view/edit mode, private notes, create/rename/delete, theming, settings.
Posts and tags are still hardcoded - generalizing that into the schema-driven
plugin system above is the active work.

## Stack

- **Service** (`cmd/scribe`, `internal/`): Go. File I/O over a blog repo
  checkout + a private JSON notes store + an HTTP/JSON API. No auth of its own.
- **Web** (`web/`): React + Vite + TipTap. The markdown <-> document pipeline
  lives client-side in `web/src/editor/markdown.ts`.

## Run locally

```sh
GOWORK=off SCRIBE_REPO=/path/to/log go run ./cmd/scribe        # :8080
cd web && npm install && npm run dev                            # :4330
```

Vite binds to the LAN (`host: true`), so the `Network:` URL works from a phone.

## Test

```sh
GOWORK=off go test ./...     # service: frontmatter, slugs, notes store
cd web && npm test           # web: markdown round-trip fidelity
```

See **[CLAUDE.md](CLAUDE.md)** for working conventions.
