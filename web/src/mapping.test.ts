import { describe, expect, it } from 'vitest'
import type { CollectionDef, FieldDef } from './types'
import { mapFieldsFor, recommend, resolve } from './mapping'

const f = (name: string, type: string, extra: Partial<FieldDef> = {}): FieldDef =>
    ({ name, label: name, type, required: false, list: false, ...extra })

const posts = (fields: FieldDef[]): CollectionDef =>
    ({ name: 'posts', label: 'Posts', path: 'src/content/posts', format: 'yaml-frontmatter', ext: '.md', fields })

// The blog's own shape: the roles the post editor renders as first-class fields
// all have same-named schema fields, so nothing needs mapping by hand.
const blogPosts = posts([
    f('title', 'string'),
    f('date', 'date'),
    f('description', 'text'),
    f('tags', 'string', { list: true }),
    f('hasVideo', 'boolean'),
    f('heroImage', 'image'),
    f('updatedDate', 'date'),
    f('featured', 'boolean'),
    f('draft', 'boolean'),
    f('body', 'code'),
])

describe('mapFieldsFor', () => {
    it('binds featured and draft to their own same-named fields', () => {
        const m = mapFieldsFor('blog-post', blogPosts)
        expect(m.featured).toBe('featured')
        expect(m.draft).toBe('draft')
    })

    it('binds every blog-post role on the real blog schema', () => {
        const m = mapFieldsFor('blog-post', blogPosts)
        expect(m).toEqual({
            title: 'title', body: 'body', description: 'description', tags: 'tags',
            date: 'date', draft: 'draft', featured: 'featured',
            updatedDate: 'updatedDate', heroImage: 'heroImage',
        })
    })

    // The regression the featured role could have caused: two boolean roles and
    // one boolean field. Guessing by type must not hand `draft`'s field to
    // `featured` as well, or the featured toggle would silently publish/unpublish.
    it('never binds two roles to the same field', () => {
        const m = mapFieldsFor('blog-post', posts([
            f('title', 'string'), f('draft', 'boolean'), f('body', 'rich-text'),
        ]))
        expect(m.draft).toBe('draft')
        expect(m.featured).toBeUndefined()
        const bound = Object.values(m)
        expect(new Set(bound).size).toBe(bound.length)
    })

    // Name matches win over type guesses regardless of role order: `featured`
    // declared before `draft` must not let draft's type guess take it.
    it('resolves name matches before guessing by type', () => {
        const m = mapFieldsFor('blog-post', posts([
            f('title', 'string'), f('featured', 'boolean'), f('body', 'rich-text'),
        ]))
        expect(m.featured).toBe('featured')
        expect(m.draft).toBeUndefined()
    })
})

describe('resolve', () => {
    // A stored .scribe.yml is authoritative: a role it does not bind stays
    // unbound (the field falls into the raw "additional fields" bucket) rather
    // than being auto-bound behind the author's back.
    it('does not backfill roles the stored mapping leaves out', () => {
        const stored = { collections: { posts: { experience: 'blog-post', fields: { title: 'title', draft: 'draft' } } } }
        const got = resolve({ collections: [blogPosts], primary: 'posts' }, stored)
        expect(got.collections.posts.fields.featured).toBeUndefined()
        expect(got.collections.posts.fields.draft).toBe('draft')
    })

    it('recommends a full mapping for a collection .scribe.yml does not cover', () => {
        const got = resolve({ collections: [blogPosts], primary: 'posts' }, null)
        expect(got.collections.posts.fields.featured).toBe('featured')
    })
})

describe('recommend', () => {
    it('reads the blog posts collection as a blog-post', () => {
        expect(recommend(blogPosts).experience).toBe('blog-post')
    })
})
