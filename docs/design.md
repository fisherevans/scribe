# scribe - design & roadmap

A git-backed writing tool for `log.fisher.sh`. Replaces the day-to-day editing
experience of Pages CMS with a writing-first editor, while leaving the repo,
the content schema, and the Astro build untouched. Pages CMS keeps working as a
fallback; scribe is purely additive.

## Why this exists

Pages CMS opens a new post into eight metadata fields before you can write a
sentence, and its body editor is a monospaced textarea. The goal here is the
inverse: land in a document, write, and deal with metadata only at publish.
Plus drafting that survives across devices (phone + laptop), and bespoke
editing for known resource types without losing the generic CMS behavior.

## Hard constraints (non-negotiable)

- **Markdown + YAML frontmatter stays the source of truth.** Files on disk are
  plain `.md`, openable in Typora / iA Writer / a code editor. scribe is a view
  over the markdown, never a database that exports markdown.
- **Raw HTML is preserved verbatim.** Hand-written or generated `<iframe>`,
  SVG, and custom HTML blocks must round-trip byte-for-byte through the editor.
  Editing the posts folder must not be lossy.
- **Don't change the content schema or break Pages CMS.** `.pages.yml` and
  `src/content.config.ts` are owned by the blog. scribe reads them; it does not
  require new frontmatter fields.

### The one accepted trade-off

A WYSIWYG editor cannot guarantee byte-exact round-trip of *arbitrary* markdown
formatting. The first time scribe saves a hand-written file it may normalize
cosmetic choices (bullet markers, heading style, wrapping, table padding).
After that first touch it is idempotent: re-saving an unchanged doc yields a
zero diff. Content and raw-HTML blocks are protected absolutely; exact
whitespace is not. This is the same behavior as Typora/iA. A plain-source
CodeMirror mode is the escape hatch for the rare post that needs surgical
control.

## Architecture

```
PWA (React + Vite + TipTap)         Go service (always-on, Fly.io / VPS)
  document-first editor                 +-- git checkout of the blog repo   <- staging working tree
  slash commands                        +-- SQLite                          <- notes / app-side metadata
  opaque raw-HTML embed node            +-- HTTP/JSON API
  source-mode toggle (CodeMirror)       +-- markdown <-> editor-doc pipeline
  installable, mobile-first             +-- git ops (commit / merge / push)
        |                                       |
        +---------------- HTTP/JSON ------------+
```

### Staging vs production (the mirror model)

There is no "draft" backend state. The service holds a working copy of the repo
and we move changes between two places:

- **Save -> staging.** Writes the file into the working tree. Cheap, frequent,
  autosave-friendly. No commit noise.
- **Promote -> production.** Commit + push to `main`, which triggers the
  existing Astro deploy. If `origin/main` moved underneath (edited on GitHub or
  via Pages CMS), promote does a `git merge origin/main`. Clean merges
  auto-apply; conflicts drop into a branch resolved by hand. Everything is
  markdown/YAML so manual merges are tolerable, and conflicts should be rare
  with a single writer.

Two independent axes, which must not be confused:

| Axis | Values | Stored where |
|---|---|---|
| Promotion | staging (unpushed) vs production (on `main`) | git working tree vs `origin/main` |
| Listing | listed vs unlisted (`draft: true`) | frontmatter, in the file |

A post can be promoted to `main` with `draft: true` and still deploy-but-unlisted
exactly like today. "Draft post" = a file sitting in staging, not yet promoted.

### Why a real git working tree (not Worker + D1)

The staging/promote model is literally a git working tree with a merge step.
Running a real checkout on a real filesystem gives merge and conflict handling
for free instead of reimplementing 3-way merge over the GitHub API. It also
matches the Go default stack, and keeps staging as real files (point Typora at
the checkout later if desired). Cost: one small always-on host to manage.

## Editor pipeline (the engineering risk)

Most of the build effort lives in a stable markdown <-> editor-doc round-trip.

- **Parse:** markdown-it (or prosemirror-markdown's parser) tokenizes incoming
  markdown. `html_block` / `html_inline` tokens route to an **opaque RawHTML
  node** that holds the source string and is never interpreted as rich text.
- **Edit:** TipTap/ProseMirror document. First line is an H1 that *is* the
  title. Slash commands for blocks, templates, and `/embed` (inserts a RawHTML
  node).
- **Serialize:** a canonical markdown serializer. RawHTML nodes emit their
  stored string unchanged. Serialization is idempotent so unchanged docs
  produce no diff.
- **Source mode:** CodeMirror markdown view, toggleable, for surgical edits.

Lean on `prosemirror-markdown` directly for the parser/serializer rather than
trusting `tiptap-markdown` blindly; the custom RawHTML node and idempotent
output are the parts that need control. Consider `novel` (Notion-style TipTap
editor, React, slash commands) as a UI starting point, swapping its persistence
for markdown round-trip.

## Generic core, bespoke experiences

scribe stays generic like Pages CMS, with hooks for known types:

- **Generic auto-form** renders any collection from the field types in
  `.pages.yml`. Fallback for collections never special-cased.
- **Experience registry** keyed by collection name:
  - `posts` -> document-first writing experience (first-line title, deferred
    metadata, slash commands, embeds).
  - `tags` -> simple two-field form.
  - unknown -> generic auto-form.

  Adding a bespoke experience later = registering a component, not rewriting the
  core.

### Extension config: sidecar, not inline

Per-type UI config (which field is the title, what's deferred, custom widgets,
render type) lives in a **sidecar file scribe owns** (`.scribe.yml` in the
repo, or service-side config), not as custom keys inside `.pages.yml`. Reason:
do not assume Pages CMS silently ignores unknown keys (TODO: verify), and don't
couple scribe to their validator. Move inline later only if `.pages.yml`
provably tolerates namespaced extension keys.

## App-side metadata & notes (private, never committed)

Notes, todos, links, idea-jots per resource live **only in the service's SQLite,
never in the blog repo**. Private by construction, no history pollution. Keyed
by `(collection, path)`.

### The rename limitation (known, accepted)

If a file is renamed directly in git and scribe later syncs, metadata keyed to
the old path orphans. Git move-detection is a fuzzy similarity threshold, not a
fact. Decision: key by path for MVP; accept orphaning-on-external-rename as a
documented limitation. Put one layer of indirection in the metadata store (a
resource-identity table) so we can later add `git --follow` best-effort
rematching or an optional stamped ID without a rewrite. Do **not** stamp IDs
into frontmatter (pollutes files, fights the schema).

## Roadmap

### Phase 0 - MVP (the writing tool)
- Single collection: `posts`. Document-first WYSIWYG over real markdown.
- First line = title. Slash commands. Opaque raw-HTML `/embed` node (non-lossy).
- Source-mode (CodeMirror) toggle.
- Simple tag chips (not the "Add an item" repeater).
- Metadata deferred to a publish sheet; `date` auto, `hasVideo` auto-derived,
  `updatedDate` auto on re-promote.
- Autosave -> staging. Promote -> commit + push -> existing deploy fires.
- Single user. Auth = passkey or shared secret in front of the service.

### Phase 1 - daily-driver gaps
- Notes sidecar (private app-side metadata).
- `tags` collection simple-form experience; generic auto-form fallback.
- Mobile PWA: installable, mobile-first layout.

### Phase 2 - git edges + media
- Conflict path: merge on promote, manual-resolve UI on auto-merge failure.
- Media: reuse the R2 `!upload` flow for inline images / hero.
- Social-style feed navigation (timeline of posts, tap to edit).

### Phase 3 - extensibility + assist
- `.scribe.yml` experience registry, custom field widgets per type.
- Claude-assisted HTML element generation for embeds.

### Out of scope (for now)
- Live styled preview of rendered posts.
- Multi-user.
- Rename-reconciliation of notes metadata.
- 1:1 replacement for every Pages CMS field type on day one.

## Intended repo structure

```
scribe/
  cmd/scribe/main.go        entrypoint
  internal/
    config/                 read .pages.yml + .scribe.yml
    gitrepo/                working-tree ops: clone, save, promote, merge
    store/                  SQLite: notes + app-side metadata
    markdown/               markdown <-> editor-doc pipeline (server-side validation/normalize)
    api/                    HTTP/JSON handlers
  web/                      React + Vite + TipTap PWA
  docs/design.md            this file
```
