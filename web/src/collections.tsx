import type { ComponentType } from 'react'
import type { CollectionName, Post, Resource, Snippet, Tag } from './types'
import { PostExperience } from './experiences/PostExperience'
import { TagExperience } from './experiences/TagExperience'
import { GenericExperience, type FieldDef } from './experiences/GenericExperience'

// The experience registry. Adding a resource type = adding an entry here:
// point it at a bespoke experience component, or omit one and it falls back to
// the generic auto-form driven by `fields`. The data shape itself comes from
// .pages.yml; this layer is scribe's own UI config (the .scribe.yml sidecar in
// the design doc), and Pages CMS neither sees nor needs it.
export interface ExperienceProps {
    resource: Resource
    onPatch: (p: Partial<Resource>) => void
    onEditTitle?: () => void // posts only: open the title/slug modal
    onDelete?: () => void // delete this resource
    editable?: boolean // posts only: view vs edit mode
}

export interface CollectionDef {
    name: CollectionName
    label: string
    glyph: string
    newLabel: string
    hasDetails: boolean // posts carry the deferred publish sheet
    experienceLabel: string // human label for the editing UI this type uses
    Experience: ComponentType<ExperienceProps>
    feedTitle: (r: Resource) => string
    feedSub: (r: Resource) => string | undefined
    // Live URL on the deployed blog, given a domain. null = no public page.
    livePath: (r: Resource) => string | null
}

const snippetFields: FieldDef[] = [
    { key: 'title', label: 'Title', type: 'text', placeholder: 'Internal name' },
    { key: 'content', label: 'Content', type: 'multiline', placeholder: 'Reusable HTML / markdown fragment' },
]

const strip = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

export const COLLECTIONS: Record<CollectionName, CollectionDef> = {
    posts: {
        name: 'posts',
        label: 'Posts',
        glyph: '✎',
        newLabel: '+ write',
        hasDetails: true,
        experienceLabel: 'Document editor',
        Experience: PostExperience as ComponentType<ExperienceProps>,
        feedTitle: (r) => (r as Post).title || 'Untitled',
        feedSub: (r) => (r as Post).description || undefined,
        // /posts/YYYY/MM/DD/<slug>/ (date is UTC; see src/lib/posts.ts)
        livePath: (r) => {
            const p = r as Post
            if (!p.date) return null
            const [y, m, d] = p.date.split('-')
            return `/posts/${y}/${m}/${d}/${p.slug}/`
        },
    },
    tags: {
        name: 'tags',
        label: 'Tags',
        glyph: '#',
        newLabel: '+ new tag',
        hasDetails: false,
        experienceLabel: 'Simple form',
        Experience: TagExperience as ComponentType<ExperienceProps>,
        feedTitle: (r) => (r as Tag).name || r.slug,
        feedSub: (r) => (r as Tag).description || undefined,
        livePath: (r) => `/tags/${r.slug}/`,
    },
    snippets: {
        name: 'snippets',
        label: 'Snippets',
        glyph: '◇',
        newLabel: '+ new snippet',
        hasDetails: false,
        experienceLabel: 'Auto-form (generic fallback)',
        // No bespoke component -> generic auto-form from the field schema.
        Experience: (p: ExperienceProps) => GenericExperience({ ...p, fields: snippetFields }),
        feedTitle: (r) => (r as Snippet).title || 'Untitled',
        feedSub: (r) => strip((r as Snippet).content) || undefined,
        livePath: () => null,
    },
}

// Real repo has posts + tags. `snippets` stays registered as the generic-form
// example but is not surfaced (no such collection on disk).
export const COLLECTION_ORDER: CollectionName[] = ['posts', 'tags']
