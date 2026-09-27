# Notes can be authored in scribe

**Date:** 2026-09-27

The blog grew a second content type - notes: short, titleless, photo-first
entries - and rolled them out as the main stream. Scribe could not write one.
Four things were in the way, and only the first two were known.

## 1. Only the primary collection minted a stable id

`Store.Write` gated id minting on `name == s.schema.Primary`. The blog's
comments key on that id and its content schema **refuses to publish an entry
without one**, so every note saved from scribe arrived id-less and failed the
site build.

A collection now mints if it is primary **or it declares an `id` field**. That
is how a site opts a second collection in without inventing a new config
concept - the blog's `.pages.yml` already declared `id` on notes and nothing
was reading it.

## 2. A declared list of objects was destroyed on save

`renderField` rendered a declared list by stringifying each item. For a list of
objects - a note's `images: [{src, alt}]` - `fmt.Sprint` on a map yields
`map[alt:... src:...]`, which is not YAML. The media was gone on first save.

This is why `images` had to be left **undeclared** in both CMS configs: an
undeclared field passes through `renderUnknown` untouched. A list containing any
non-scalar now goes to the marshaller whole, so the field can be declared and
edited like anything else. `renderUnknown` also gained a 2-space indent so a
frontmatter block no longer mixes two indent widths.

## 3. There was no note experience

A note is not a blog post with fields hidden - the absence of a title *is* the
format. So `NoteExperience` has no title slot at all: the date row is the
header, the photos sit under it, the body is whatever there is to say.

`NoteGallery` edits the `images` list - upload to the site's external CDN, alt
text per photo, reorder, remove. Photos live in frontmatter rather than in the
prose because a note is photo-first: the pictures are the entry, not
illustrations inside it, and the site decides whether they lead or follow based
on how long the caption is.

Supporting changes: a `gallery` role type; `chooseExperience` recommends `note`
for a frontmatter collection with no title-ish field (checked *before*
blog-post, which would otherwise match on any string field - a note's `id` is
one); `feedTitle` derives from the body for notes, because falling through to
"the first string field" showed the id; `livePath` knows
`/notes/YYYY/MM/DD/slug/`.

## 4. Edit mode was gated on a collection name

Found while verifying the above: the edit button was `showEdit={collection ===
'posts'}`. A hardcoded collection **name**, so notes had no way into edit mode -
and neither would any site whose primary collection is called something else.
`formExp` had the same shape, classifying a note as a form rather than a writing
surface. Both now key on `isDocExperience()`.

## Verification

End to end against a local scribe pointed at the blog checkout: create a note,
save it with two images, read it back, save again. Id minted and stable across
saves, images intact, `astro build` accepts the result. Go tests cover 1 and 2
and both fail against the previous `content.go`; a vitest covers the derived
note title, including the notes that are one embed and no prose - the blog's
migration made several.
