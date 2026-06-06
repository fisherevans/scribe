# scribe - working notes

A writing-first editor for the `log.fisher.sh` blog. Go service + React/TipTap
web app. Full design and roadmap in [docs/design.md](docs/design.md); this file
is the practical "how to work in here" companion.

## Shape

- **`cmd/scribe`, `internal/`** - Go service.
  - `internal/content` - reads/writes posts (`.md` + YAML frontmatter) and tags
    (`.yaml`) from a blog repo checkout. Frontmatter is re-emitted in a fixed
    canonical style (hand-rolled in `marshalFrontmatter`, not yaml.Marshal, to
    control quoting/order). Body bytes pass through untouched.
  - `internal/store` - private app-side metadata (notes). File-backed JSON under
    `SCRIBE_DATA` (default user config dir). **Never** written to the blog repo.
  - `internal/api` - HTTP/JSON. Resources are returned in the shape the web app
    expects (`kind`/`slug`/`state`/`dirty` + fields). Also serves the repo's
    `public/` so site-relative asset paths resolve. No auth here (swappable,
    handled upstream).
- **`web/`** - React + Vite + TipTap.
  - `web/src/editor/markdown.ts` - **the critical, riskiest code.** A custom
    `prosemirror-markdown` parser + serializer over the TipTap schema. Block-level
    raw HTML (`html_block`) maps to the opaque `RawHtml` node and serializes
    verbatim; lone-image paragraphs lift to block images; GFM tables normalized.
    Changing it risks lossy saves - run `npm test` (round-trip fidelity).
  - `web/src/editor/extensions.ts` - the single source of the editor extension
    set, shared by the live editor and the markdown tests.
  - Custom nodes: `RawHtmlNode` (opaque), `Callout`, `Figure`, `ImageBlock`,
    `CodeBlock` (lowlight). Each has a React node view with edit/delete controls.

## Conventions / gotchas

- **Go commands need `GOWORK=off`** - the parent `~/dev/go.work` doesn't list
  this module, so plain `go build/test/run` fail without it.
- **Markdown is the source of truth.** The editor is a view over it; never store
  a JSON doc as canonical. First save of a hand-written post may normalize
  cosmetics (quoting, bullet markers, escaping) - content + raw HTML are
  preserved, exact bytes are not. This is an accepted trade-off.
- **View vs edit mode.** Posts open read-only. `editor.setEditable(x, false)` -
  the `false` (emitUpdate) is load-bearing: the default emit fires `onUpdate` and
  autosaves, silently rewriting the file just by opening edit.
- **Saves send the full resource** (the service rewrites the whole file); a
  partial would drop untouched frontmatter. Empty tag slices marshal as `[]`,
  not `null` (the client reads `.length`).
- **Dev round-trip harness:** in dev, `window.scribeRT.roundtrip(md)` runs
  parse->serialize without the UI. Handy for fidelity spot-checks.
- **Don't run editing tests against real untracked files** - autosave writes to
  disk. Use a committed file (recoverable) or a throwaway, and clean up.

## Test

```sh
GOWORK=off go test ./...     # frontmatter round-trip, slug sanitize, notes
cd web && npm test           # markdown round-trip + idempotency
```

## Known gaps

- Staging/promote is a no-op stub; saves write straight to the working tree. The
  git-branch layer (design.md "Staging vs production") is unbuilt.
- Renaming/deleting a tag doesn't update posts that reference it.
- A benign `flushSync` console warning from TipTap's React node views (upstream).
