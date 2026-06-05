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
PWA (React + Vite + TipTap)         scribe Go service (k3s pod, single replica)
  document-first editor                 +-- git checkout of the blog repo   <- staging working tree (NFS PVC)
  slash commands                        +-- SQLite                          <- notes / app-side metadata (NFS PVC)
  opaque raw-HTML embed node            +-- HTTP/JSON API
  source-mode toggle (CodeMirror)       +-- markdown <-> editor-doc pipeline
  installable, mobile-first             +-- git ops (commit / merge / push -> origin/main)
        |                                       |
        +---------------- HTTP/JSON ------------+

Browser -> Cloudflare edge -> Cloudflare Tunnel -> caddy (forward-auth) -> scribe-svc
                                                         |
                                                   auth.fisher.sh (login)
```

Runs on the Nottingham homelab k3s cluster, exposed at `scribe.fisher.sh` via
Cloudflare Tunnel, behind the cluster's auth service (see Auth below). But
scribe must not *depend* on that auth service - it's swappable.

### Auth (swappable)

scribe never implements login. It consumes identity from whatever sits in front
of it, or runs open. This keeps it reusable: someone else can run it locally
with no auth, or front it with Cloudflare Access / oauth2-proxy / their own SSO,
without inheriting `auth.fisher.sh`.

Selected by config (`SCRIBE_AUTH_MODE`):

- **`none`** (default) - open. For local dev or a trusted network. Runs out of
  the box with zero auth setup.
- **`trusted-header`** - read the authenticated user from a configurable header
  set by an upstream proxy (`SCRIBE_AUTH_HEADER`, e.g.
  `Cf-Access-Authenticated-User-Email` for Cloudflare Access, or whatever the
  Nottingham auth service injects). Fails closed: reject requests missing the
  header so it can't be bypassed by hitting the pod directly.

A small `Authenticator` interface with `none` and `trustedHeader` implementations;
adding a mode later (shared-secret, real OIDC) is one more implementation, not a
rewrite. Single user means we don't even map identities - presence of a valid
upstream header is sufficient. The Nottingham deploy uses `trusted-header`
behind caddy forward-auth; that's just one configuration, not a requirement.

### Staging vs production (the mirror model)

There is no "draft" backend state. scribe owns a dedicated **`staging` branch**
in the blog repo; its working tree is checked out on `staging`. Changes move
between `staging` and `main`:

- **Save -> staging.** Write the file into the working tree and commit to
  `staging`. Commit granularity is per-save (debounced); WIP/noisy commits on
  `staging` are fine. This is also the durability mechanism (see backup below).
- **Promote -> production.** Merge `staging` into `main` and push `main`, which
  triggers the existing Astro deploy. If `main` moved underneath (edited on
  GitHub or via Pages CMS), the merge reconciles it; clean merges auto-apply,
  conflicts drop into a manual-resolve flow. Squash the merge for clean `main`
  history, then fast-forward `staging` to `main` so the branches don't diverge.
  Everything is markdown/YAML, so manual merges are tolerable, and conflicts
  should be rare with a single writer.

`origin` push of `staging` is always a fast-forward (scribe is the sole writer
of that branch). Only the `staging -> main` merge can conflict, and only when
`main` advanced independently.

### Durability / backup

`staging` pushes to the public `origin` (`fisherevans/log`) every ~30-60 min.
Drafts on a non-default branch being publicly visible is acceptable: it's no
more exposed than the existing `draft: true` posts, which already deploy to a
public (if unlinked) URL. Lose the pod -> re-clone, check out `staging`,
working tree restored; only edits since the last push are at risk, bounded by
the push interval. The NFS PVC also survives pod reschedule, so the push is
backup/versioning, not the only line of defense.

The one thing that stays out of git is **notes / app-side metadata** - those
live only in the service's SQLite and are never committed (private by design).

Promote is independent of the backup push: it's a local merge of `staging` into
`main` followed by a push of `main` to `origin`.

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
matches the Go default stack, and keeps staging as real files. The homelab k3s
cluster is always-on already, so there is no extra host to manage.

Implementation notes: shell out to the real `git` binary (in the runtime image)
rather than go-git, so merges/conflicts use real git semantics. Use
`modernc.org/sqlite` (pure Go) for the metadata store so the CGO-free
`CGO_ENABLED=0` build matches the cluster convention.

## Deployment (Nottingham k3s)

Follows the `nottingham-cloud/k3s` project convention. `rsvp` is the direct
analog: a single-replica Go + SQLite app on an NFS PVC behind the auth service.

Split of responsibilities:

- **This repo (`scribe`):** app source + `Dockerfile`. Image published to
  `ghcr.io/fisherevans/scribe:vX.Y.Z` (`docker build --platform linux/amd64`,
  then `docker push`; namespace seeds the shared `ghcr-secret`).
- **`nottingham-cloud/k3s/projects/scribe/`:** kustomize manifests (namespace,
  deployment, service, pvc), scaffolded via `make new-project PROJECT=scribe`.

Deployment specifics:

- **Single replica, `strategy: Recreate`.** SQLite and a git working tree both
  want one writer; never run two pods. Identical constraint to rsvp.
- **One NFS PVC mounted at `/data`** holds both the staging git checkout and
  the SQLite metadata DB. NFS + SQLite is already proven on this cluster (rsvp).
- **Secrets (`scribe-secrets`):** a GitHub credential so the pod can fetch
  `main` and push on promote (and push `staging` to the private mirror, if used).
  Prefer a **fine-grained PAT over HTTPS** scoped to just the repo(s) with
  `contents:write` - simpler in-container than an SSH deploy key (no
  known_hosts/agent), nearly as tight. Push URL becomes
  `https://x-access-token:$TOKEN@github.com/fisherevans/log.git`.
- **Health endpoint `/api/health`** to match the cluster's probe convention
  (liveness + readiness), not `/healthz`.
- **Expose:** add a `handle` block for `scribe.fisher.sh` to
  `infra/auth/caddy-config.yaml`, `make deploy-auth`, then
  `make route-add HOSTNAME=scribe.fisher.sh SERVICE=http://caddy.auth.svc.cluster.local:80`.

Promote pushes to the blog repo's `main`, which triggers the existing
`log.fisher.sh` deploy pipeline. scribe does not deploy the blog itself; it just
moves commits.

### Secrets (Bitwarden)

Follows the per-app BW-item convention (`rsvp` item -> `configure-rsvp` target).

- New BW item **`scribe`** holding the GitHub PAT (field e.g. `github-token`),
  and any backup-mirror credential if option 2 is chosen.
- **Deploy:** a `configure-scribe` Makefile target in `nottingham-cloud/k3s`
  pulls the fields and materializes the `scribe-secrets` Secret (same shape as
  `configure-rsvp`).
- **Local dev:** the *same* BW item, read via `scripts/bw-field.sh scribe
  github-token`, exported into the dev environment. One source of truth for the
  credential across local and deployed - no separate `.env` checked in.

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

### Round-trip status (verified against the real repo, 2026-06)

Implemented in `web/src/editor/markdown.ts`: a custom `prosemirror-markdown`
parser + serializer over the TipTap schema. markdown-it `html_block` tokens map
to the opaque RawHtml node and serialize verbatim; inline raw-HTML parsing is
disabled so stray `<...>` survives as literal text. tiptap-markdown was removed.

Measured by loading all 24 real posts, serializing back, and diffing:

- **18/24 byte-identical** on the first pass. **Raw HTML is preserved**
  (trianglizer's `<iframe>` is byte-identical), links and images round-trip.
- The other 6 differ only in **cosmetic normalization that renders identically**:
  bullet marker `*`->`-`, trailing whitespace stripped, escape churn
  (`\-`/`\.` dropped, `[x]`->`\[x\]`), and redundant `*` around bold-links.
- **22/24 are idempotent** (`rt(rt(x)) == rt(x)`); the 2 that aren't (old posts
  with bold-links nested in italic) **converge to a fixed point after 2-3
  passes** - bounded churn, never content loss.
- Frontmatter (Go side) round-trips clean modulo cosmetic YAML quoting
  (`"x"`->bare, `"x"`->`'x'`).

Conclusion: content, links, images, and raw HTML are preserved; remaining diffs
are render-identical style normalization within the design's accepted trade-off.
The full edit -> API -> file write path is validated end-to-end. Saving real
content is safe; the first save of a hand-written post may normalize cosmetics,
then stabilizes.

### Custom content: structured vs opaque

The `/` menu inserts two kinds of custom block, and the distinction drives how
each round-trips to markdown:

- **Structured blocks** (e.g. Callout `div[data-callout][data-tone]`, Figure
  `figure > img + figcaption`). The editor understands their shape and they
  serialize to a known, stable HTML/markdown form the blog can style. New
  "templates/plugins" are this kind: a node with defined attributes + a
  serialize rule. Editable inline.
- **Opaque blocks** (RawHTML). The editor never parses them; the source string
  round-trips verbatim. The escape hatch for arbitrary hand-written or
  generated HTML (iframes, SVG, one-off custom elements).

Prototype status: both implemented as TipTap nodes
(`web/src/editor/{CalloutNode,FigureNode,RawHtmlNode}.tsx`) with React node
views. The markdown serialization rules for the structured ones are still
pending (part of the round-trip pipeline above); opaque is already verbatim.

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

Prototype status: the registry is implemented in `web/src/collections.tsx`. Each
collection maps to an `Experience` component (`posts` -> `PostExperience`,
`tags` -> `TagExperience`) plus feed renderers; collections without a bespoke
component fall back to `GenericExperience`, driven by a field schema (the
`snippets` collection demonstrates this path). A far-left rail switches between
collections.

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
- Autosave -> commit to `staging`. Promote -> merge `staging` into `main` +
  push -> existing deploy fires.
- Single user. Auth is swappable: `none` for local, `trusted-header` behind the
  cluster forward-auth when deployed. scribe implements no login.
- Deploy to Nottingham k3s as a `make new-project` app at `scribe.fisher.sh`
  (see Deployment + Secrets).

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
