// scribe is collection-aware. Each resource carries its collection (`kind`),
// a slug, and the two orthogonal axes from design.md: `state` is staging vs
// promoted, `draft` (posts only) is listed vs unlisted. The editor renders a
// per-collection "experience" (see collections.tsx).
export type CollectionName = 'posts' | 'tags' | 'snippets'
export type ResourceState = 'staged' | 'promoted'

interface Base {
    kind: CollectionName
    slug: string
    state: ResourceState
    dirty: boolean
}

export interface Post extends Base {
    kind: 'posts'
    title: string
    date: string // yyyy-mm-dd
    description: string
    tags: string[]
    draft: boolean
    body: string // markdown (TipTap HTML in the prototype)
    notes: string // private, app-side only, never committed
}

export interface Tag extends Base {
    kind: 'tags'
    name: string
    description: string
}

// Snippets stand in for "some new resource type we add later." It has no
// bespoke experience, so it exercises the generic auto-form fallback.
export interface Snippet extends Base {
    kind: 'snippets'
    title: string
    content: string
}

export type Resource = Post | Tag | Snippet
