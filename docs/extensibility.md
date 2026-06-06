# scribe - extensibility architecture & roadmap

The north-star design. Supersedes the phase roadmap in [design.md](design.md),
which described the bootstrap vertical slice (hardcoded posts + tags). This doc
is the trajectory from that slice to a flexible, extensible publishing tool.

## Vision

scribe is a **publishing client** for content that lives in a Pages-CMS-backed
repo. It is not a website builder. It does not design layouts, define resource
types, author render templates, or manage themes - Pages CMS (and the site's own
framework) already does that. scribe's job is to make *writing and managing the
content* of that site pleasant, and to do so against **whatever the author set
up**.

Pages CMS lets people define arbitrary collections with arbitrary fields. So
scribe cannot assume a fixed shape. It has to:

- Read the site's schema and accommodate it.
- Offer great bespoke editing for the common shapes (a blog post, a tag) out of
  the box.
- Let anyone extend or replace those editors - as a public plugin or a local
  fork - when their site doesn't fit the defaults.

## Principles

1. **Publish, don't design.** Editing content, not building the site.
2. **Accommodate the author's schema.** The `.pages.yml` the author wrote is the
   contract; scribe maps onto it, never the reverse. Never require schema changes.
3. **Preserve everything.** Fields scribe doesn't understand are kept verbatim on
   save. A round-trip never drops data.
4. **Core + plugins.** A small, excellent core (blog-post, tag, generic) shipped
   as the reference plugins; everything beyond is a plugin built on the same SDK
   the core uses. No privileged internals.
5. **Forkable.** A plugin is a unit you can copy and change. "My blog uses three
   kinds of tags" is solved by forking the tag plugin, not patching scribe.

## Where we are (honest)

A working two-type vertical slice: `posts` and `tags` are hardcoded in the Go
service (fixed dirs, a fixed frontmatter struct) and in the web app (a
hardcoded experience registry, a `Post` type whose fields match the blog). The
markdown round-trip, notes store, view/edit, slug/rename, and the editor UX are
solid and largely reusable. But nothing is schema-driven yet, and the
"experiences" are in-tree components, not plugins. The vision requires
generalizing the data layer and turning the experience registry into a real
plugin system with a mapping layer.

## Target architecture

Seven layers, bottom up:

### 1. Schema layer - read `.pages.yml`
Parse the site's `.pages.yml` into a normalized schema: collections, and for
each, its fields (name, type, required, list, options). Types follow Pages CMS:
`string`, `text`, `rich-text`, `date`, `boolean`, `image`, `select`, `number`,
`object`, `reference`, lists thereof. This replaces the hardcoded posts/tags
knowledge. Everything above is driven by it.

### 2. Generic content layer
A resource is `{ collection, slug, fields: map, body? }` - frontmatter as an
open map, plus an optional markdown body. The Go service reads/writes any
collection generically (frontmatter map + body passthrough), driven by the
schema. Unknown fields are preserved. The HTTP API is generic over collection.
The current typed `Post`/`Tag` handling collapses into this.

### 3. Experience plugin contract
An **experience** is the editing UI for a kind of content. It declares a
**content model** - the fields it knows how to edit, each with a role/type:

```
blog-post model:
  required: title (text), date (date), body (markdown)
  optional: description (text), tags (reference[]), draft (boolean),
            heroImage (image), updatedDate (date)
```

and provides: an `Editor` component (renders the model fields + a data context),
a feed renderer (title/subtitle/icon), and metadata (id, label). Core experiences:
`blog-post`, `tag`, and `generic` (the auto-form/raw fallback for anything
unmapped). An experience consumes only the public SDK - the same one third
parties get.

### 4. Mapping layer - `.scribe.yml`
The bridge between an author's `.pages.yml` collection and an experience. Lives
in `.scribe.yml` in the repo (travels with the site, like `.pages.yml`), editable
from the settings UI:

```yaml
collections:
  posts:
    experience: blog-post
    map:                 # experience-field: pages-cms-field
      title: title
      date: date
      body: body
      description: description
      tags: tags
      draft: draft
    # pages.yml fields not mapped (hasVideo, coAuthor, projectName, …) fall
    # through to the raw/other-metadata editor.
  tags:
    experience: tag
    map: { name: name, description: description }
```

Three buckets of fields, which is the heart of "accommodate whatever they did":

- **Mapped required** - must bind to an existing `.pages.yml` field; validated.
  Missing required mapping = the experience can't be used for that collection.
- **Mapped optional** - bound if present, otherwise the editor hides them.
- **Unmapped** - everything else in the collection. Rendered by the raw editor
  (structured field widgets where the type is known, a YAML/JSON escape hatch
  otherwise), with a "show me what the editor doesn't cover" filter so you can
  see and edit the leftover metadata without hunting.

### 5. Field widgets
A widget per Pages CMS field type (string, text, date, boolean, image, select,
list, object, reference). Experiences render mapped fields through these; the raw
editor renders unmapped fields through the same set. One widget library, used by
core and plugins.

### 6. Data access API
A runtime context handed to every experience so it can reach other resources -
this is what makes tag autocomplete, cross-type editing, and cascades possible:

```
resources.list(collection)        // read-only, for autocomplete / pickers
resources.get(collection, slug)
resources.save / create / rename / delete(collection, …)   // cross-type edits
resources.referencers(collection, slug)   // who points at this (via reference fields)
```

Exposed as React hooks (`useResourceList('tags')`) over the generic Go API, with
caching. `reference` fields (e.g. `post.tags -> tags`) are first-class: the
picker resolves and offers them, and referencers power cascades.

### 7. Core SDK & plugin distribution
A core package exports the reusable pieces: the document/markdown editor,
`ReferencePicker` (the tag chips, generalized), field widgets, the raw editor,
the data hooks, and the experience contract types. Plugins import from it; a
common editor (e.g. tags) is one shared export reused across plugins.

**Distribution decision (needs a call):** v1 plugins are **build-time** - a
deployment configures which plugins it uses (core, npm packages, or a local
`plugins/` dir) and builds. "Fork a plugin" = fork the package, point your build
at it. This is simpler and safe (no arbitrary runtime JS) and fits both "public
plugin package" and "local deployment." **Runtime/dynamic plugin loading** (drop
in a plugin without rebuilding) is a harder stretch goal (bundling, API
stability, trust) - deferred, not designed-out.

## Cascades & cross-resource editing

`reference` fields + `referencers()` enable the marquee behaviors:

- Edit a tag inline from a post (the picker opens the tag experience).
- Rename a tag -> "update the N posts that reference it?" with a preview.
- Delete a referenced resource -> warn about / clean up referencers.

These live in the core tag experience as the reference implementation, built only
on the SDK, so a fork inherits them.

## Roadmap (milestones)

Each milestone stays shippable and keeps posts/tags working (regression-guarded
by the markdown round-trip tests). M1 is the keystone refactor.

### M1 - Schema-driven core
De-hardcode the data layer. Parse `.pages.yml`; generic resource model; generic
store + API over any collection; web data client. Posts/tags keep working
through the generic layer.

### M2 - Experience contract + mapping
Formalize the experience plugin interface. Add `.scribe.yml` mapping + loader +
validation + a settings UI to view/edit mappings. Refactor PostExperience/
TagExperience to implement the contract, driven by mapping (no hardcoded fields).

### M3 - Field widgets + raw editor
Widget-per-type library. Raw/other-metadata editor (widgets + YAML escape hatch +
"show only what's not in the UI"). Experiences render mapped fields via widgets,
remainder via the raw editor.

### M4 - Data access API + references
Data hooks over the generic API with caching. First-class `reference` fields.
Generalize the tag chips into a `ReferencePicker` using the API.

### M5 - Cascades & cross-resource editing
`referencers()`, cascade rename/delete with preview, inline edit of a referenced
resource from another experience.

### M6 - Core SDK + plugin packaging
Extract the SDK (editors, widgets, hooks, contract types) with a stable export
surface. Implement build-time plugin registration (config: core + npm + local
dir). Ship core plugins (blog-post, tag, generic) consuming only the SDK.
Authoring docs + an example third-party plugin.

### M7 - Distribution, versioning, deferred infra
Plugin API versioning/stability policy. Then the deferred infra: staging/promote
git layer, the image-upload plugin, k3s deploy, auth modes.

## Open decisions

- **Build-time vs runtime plugins** (recommend build-time for v1).
- **`.scribe.yml` location** - in-repo (recommended; travels with the site) vs
  service-side.
- **How generic to make M1** - full Pages CMS type coverage now, or the subset
  the blog uses first and widen later (recommend: model all types, implement
  widgets lazily).
- **Reference fields in Pages CMS** - Pages CMS may not have a native `reference`
  type; tags are a `string`+`list`. Decide how scribe recognizes a field as a
  reference (convention in `.scribe.yml`: `tags -> reference(tags)`).
