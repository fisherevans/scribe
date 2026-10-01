# One unparseable file no longer takes the editor down

**Date:** 2026-10-01
**Type:** feature
**Version:** v0.4.1
**Author:** claude-code

## What changed

`content.Store.List` used to return on the first `Read` error. It now skips the file,
records a `{slug, path, error}` `Problem`, and keeps going; the error return is
reserved for collection-level failures (unknown collection, unreadable directory).
`GET /api/c/{collection}` returns `{resources, problems}` instead of a bare array, and
the editor shows the skipped files in a dismissible banner above a working app.

The crash screen stopped claiming every failure is a dead service. It now splits
unreachable (unchanged copy), signed out, and "the service answered with an error",
which it quotes verbatim.

## Why

Eleven imported notes in the blog carry emoji in their image `alt` text as JSON-style
`😅` surrogate escapes. js-yaml (Astro) tolerates them, so the site built
and nobody noticed; yaml.v3 (scribe) rejects them. One of those files made `List` fail,
which 500'd the list endpoint, which put the editor on its crash screen - and the crash
screen asked whether the Go service was running, so the failure read as an outage of a
service that was healthy and had just told us exactly what was wrong.

The content is being fixed separately, but the shape of the failure is the real bug: a
writing tool over a repo of 150 files should not be one bad character away from
unusable, and it should name the file rather than describe the wrong problem.

## Context / alternatives

The list response could have stayed a bare array with problems on a separate endpoint,
which would have kept the wire format backward compatible. The envelope won because the
service embeds and serves its own UI (there is no service worker and no version skew),
and because the app already fetches every collection at load - the problems come along
for free rather than costing a second round trip per collection.

Skipped files are logged at warn once per distinct error rather than on every list. The
list is polled, and a permanently broken file would otherwise write the same line
forever; a *changed* error still logs, so a half-fixed file is visible.

The banner overlays the top of the app rather than pushing it down, matching the four
banners already there. It is dismissible, unlike the sync-degraded one, because the
condition it reports can persist for as long as it takes to fix the files.

## Related

- fisher-sh#5
- The content fix for those eleven notes: fisher-sh#4, in `fisherevans/log`
