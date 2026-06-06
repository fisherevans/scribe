# scribe

A git-backed, writing-first editor for [`log.fisher.sh`](https://log.fisher.sh).
Land in a document and write; deal with metadata at publish. Markdown + YAML
frontmatter stay the source of truth, so posts remain editable in any editor and
Pages CMS keeps working as a fallback.

See [`docs/design.md`](docs/design.md) for the architecture and roadmap, and
[`CLAUDE.md`](CLAUDE.md) for working conventions.

## Status

Usable locally. Reads/writes the real blog repo, full markdown round-trip
(including verbatim raw HTML), block editor with slash commands, tables, images,
callouts/embeds, drag-to-reorder, bubble toolbar + links, view/edit mode,
private notes, create/rename/delete, theming. Not yet: git staging/promote
(saves write straight to the working tree) and image upload.

## Stack

- **Service** (`cmd/scribe`, `internal/`): Go. File I/O over a blog repo
  checkout + a private JSON notes store + an HTTP/JSON API. No auth of its own
  (handled by whatever fronts it).
- **Web** (`web/`): React + Vite + TipTap. The markdown <-> document pipeline
  lives client-side in `web/src/editor/markdown.ts`.

## Run locally

```sh
# service (point it at your blog repo checkout)
GOWORK=off SCRIBE_REPO=/path/to/log go run ./cmd/scribe        # :8080

# web (proxies /api + assets to the service)
cd web && npm install && npm run dev                            # :4330
```

Open http://localhost:4330. Vite binds to the LAN (`host: true`), so the
`Network:` URL it prints works from a phone on the same Wi-Fi.

## Test

```sh
GOWORK=off go test ./...     # service: frontmatter, slugs, notes store
cd web && npm test           # web: markdown round-trip fidelity
```
