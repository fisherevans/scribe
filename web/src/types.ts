// Mirrors the post shape scribe reads from the blog's content schema. `body` is
// markdown; the editor is a view over it. `state` is the staging/promote axis,
// `draft` is the listed/unlisted axis - two independent things (see design.md).
export type PostState = 'staged' | 'promoted'

export interface Post {
    slug: string
    title: string
    date: string // yyyy-mm-dd
    description: string
    tags: string[]
    draft: boolean
    body: string // markdown
    state: PostState
    dirty: boolean // unsaved edits in the buffer
    notes: string // private, app-side only, never committed
}
