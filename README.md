# scribe

A git-backed, writing-first editor for [`log.fisher.sh`](https://log.fisher.sh).
Land in a document and write; deal with metadata at publish. Drafts live in a
staging working tree and get promoted to `main`, which triggers the existing
Astro deploy. Markdown + YAML frontmatter stay the source of truth, so posts
remain editable in Typora or any editor, and Pages CMS keeps working as a
fallback.

See [`docs/design.md`](docs/design.md) for the architecture and roadmap.

## Status

Pre-MVP. Project skeleton only.

## Stack

- Go service (always-on) with a real git checkout as the staging working tree,
  SQLite for private app-side metadata, HTTP/JSON API.
- React + Vite + TipTap PWA for the editor.

## Dev

```
go run ./cmd/scribe   # service (stub)
```
