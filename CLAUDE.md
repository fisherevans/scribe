# scribe - working notes

A writing-first editor for the `log.fisher.sh` blog. Go service + React/TipTap
web app. Full design and roadmap in [docs/design.md](docs/design.md); this file
is the practical "how to work in here" companion.

## Shape

- **`cmd/scribe`, `internal/`** - Go service.
  - `internal/schema` - parses `.pages.yml` into a normalized model (collections
    + fields + types). Drives everything below.
  - `internal/content` - **generic, schema-driven**. A resource is
    `{slug, fields(open map), body}`, read/written for any collection. Frontmatter
    is re-emitted in schema-field order with type-aware rendering (dates/booleans
    bare, lists as block seqs) for byte-stable round-trips; unknown fields
    preserved. Body bytes pass through untouched.
  - `internal/store` - private app-side metadata (notes). File-backed JSON under
    `SCRIBE_DATA` (default user config dir). **Never** written to the blog repo.
  - `internal/api` - HTTP/JSON. Resources are returned in the shape the web app
    expects (`kind`/`slug`/`state`/`dirty` + fields). Also serves the repo's
    `public/` so site-relative asset paths resolve. No auth here - the
    `internal/auth` Authenticator wraps this mux in `main` (modes `none`/`oidc`;
    see docs/oidc.md).
  - `internal/auth` - pluggable auth. `none` (open) or `oidc` (full OIDC client:
    Authorization Code + PKCE + refresh, SQLite-persisted server-side session
    (`SCRIBE_SESSION_DB`, `memory` to opt out), optional group gate). Wraps the
    api mux and registers `/auth/*` + `/api/me` in `main`.
- **`web/`** - React + Vite + TipTap.
  - `web/src/editor/markdown.ts` - **the critical, riskiest code.** A custom
    `prosemirror-markdown` parser + serializer over the TipTap schema. Block-level
    raw HTML (`html_block`) maps to the opaque `RawHtml` node and serializes
    verbatim; lone-image paragraphs lift to block images; GFM tables normalized.
    Our emitted `<figure data-figure>` HTML is parsed back into the `image` node
    (with its caption) rather than left as raw HTML - a captioned image and a
    plain one are the same node. Changing it risks lossy saves - run `npm test`.
  - `web/src/editor/extensions.ts` - the single source of the editor extension
    set, shared by the live editor and the markdown tests.
  - Custom nodes: `RawHtmlNode` (opaque), `Callout`, `ImageBlock`, `CodeBlock`
    (lowlight). `ImageBlock` is one node for both plain images and figures - a
    non-empty `caption` is the only difference (serializes to `<figure>`, else
    `![]()`). It's edited via a modal (`ImageEditModal`: preview, source, alt,
    caption, replace-via-upload, browse-repo-images), not inline forms.

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
- **Image upload** (`POST /api/upload`): paste/drag/pick an image and it enters a
  client-side **staging** state (preview + editable filename + destination
  choice) before anything is sent - the chosen name becomes the real stored
  filename. On confirm the form posts `file`, `dest` (`external`|`local`),
  `name`, `slug`. `dest=external` shells out to `SCRIBE_UPLOAD_CMD` (file +
  metadata via `SCRIBE_UPLOAD_*` env, stdout is the URL; the image bundles
  `rclone` + generic reference uploaders, so a deploy just sets `SCRIBE_UPLOADER`
  (see [deploy/uploaders/](deploy/uploaders/README.md));
  `dest=local` copies into the
  site's `media.input` dir under a per-post subdir (`<input>/<slug>/`) and serves
  it back under `media.output`. `GET /api/capabilities` tells the UI whether
  external is configured (the toggle hides when it isn't). Staged `image`/`figure`
  nodes carry a `staging` attr (`rendered: false`); `ContentEditor` skips
  autosave while any node is staged so a half-finished `![]()` never lands.

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

## Changelog

This repo keeps a `changelog/` - a per-entry record of **deliberate changes and the
why behind them** (features, structural/deploy changes, removals). When you make a
meaningful change, add an entry in the **same PR as the work**; the why is the point,
so a future agent doesn't have to reverse-engineer it from a diff. Format and
when-to-write rules are in [changelog/README.md](changelog/README.md). This mirrors
the homelab-wide practice defined in nottingham-cloud's `agent/changelog.md`.
