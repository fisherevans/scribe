# Featured toggle, and the schema reloads on sync

**Date:** 2026-10-01
**Type:** feature
**Version:** v0.5.0
**Author:** claude-code

## What changed

`blog-post` has a `featured` role, rendered as a toggle beside `draft` in the post
details sheet and labelled "featured on home page". The blog's `.scribe.yml` binds
`featured: featured`.

Separately, and the more interesting half: the content store no longer holds the
schema it was constructed with for the life of the process. It holds it atomically
and re-parses `.pages.yml` after each successful git sync when the file's content
hash changed, clearing the parsed-resource cache with it. The web app pulls
`/api/schema` and `/api/mapping` on the same sync-triggered refetch that already
pulled the resources, so a schema change reaches an open tab without a reload.

`mapFieldsFor` also stopped letting two roles bind the same field.

## Why

Fisher could not find how to feature a post. The field had been in the blog's
`.pages.yml` since 2026-09-29 and the editor had never shown it, because scribe
parsed the schema exactly once in `main` and the sync loop pulls content - the
schema is not content. The field was two weeks old and invisible, and the only way
to make it appear was a pod restart nobody knew to do.

That is the actual bug. The missing toggle is a presentation problem on top of it:
even once the schema loads, a field with no role falls into the collapsed
"additional fields" reveal at the bottom of the sheet, which is the right place for
a field the editor knows nothing about and the wrong place for the one that decides
what the home page leads with.

The auto-mapping fix is a hazard the new role introduced rather than a bug anyone
hit. `mapFieldsFor` matched each role in turn and fell back to "first field of a
compatible type". `draft` and `featured` are both boolean, so on a site that
declares `draft` and no `featured`, whichever role was matched second would have
been handed the `draft` field - a featured toggle that publishes and unpublishes.
Name matches are now resolved for every role before any type guessing, and no field
is bound twice.

## Context / alternatives

**Reloading on a watch rather than on sync.** An fsnotify watch on `.pages.yml`
would catch an edit made directly in the working tree too. It was not worth a
dependency and a goroutine for a file that only changes when a pull brings it in -
scribe is the only other writer of that tree and it does not write `.pages.yml`.
The hook is the sync, which is also the moment the UI already refetches.

**A hash, not mtime+size.** The content cache keys on mtime+size, which is fine for
content files. `.pages.yml` is small enough to hash, and a git checkout flipping
between two same-length revisions inside one mtime tick is exactly the case a
schema fingerprint must not miss.

**Backfilling missing roles in `resolve`.** Adding a role to a model still requires
every site's `.scribe.yml` to bind it, which is why shipping this needed a config
change in the blog repo as well as an image. `resolve` could auto-bind any unbound
role whose name matches a field. It does not, deliberately: the field mapper writes
an unmapped role by deleting the key, so "never mapped" and "deliberately unmapped"
are the same state on disk, and backfilling would silently override the second one.
A stored `.scribe.yml` stays authoritative.

**Clearing the resource cache on swap.** Parsing is schema-driven - declared field
types bias scalar handling - so everything cached was parsed under the old field
set. Dropping the cache is cheaper to reason about than working out which entries
a given schema diff invalidates.

## Related

- fisher-sh#6
- The blog-side config: `featured: featured` in `.scribe.yml`, in `fisherevans/log`
