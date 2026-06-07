import type { ComponentType } from 'react'
import type { CollectionDef, Resource } from './types'
import { fstr } from './types'
import { PostExperience } from './experiences/PostExperience'
import { TagExperience } from './experiences/TagExperience'
import { GenericExperience } from './experiences/GenericExperience'

// A patch expresses an edit to a resource: merge some frontmatter fields, set
// the body, or set the private notes.
export interface ResourcePatch {
    fields?: Record<string, unknown>
    body?: string
    notes?: string
}

export interface ExperienceProps {
    resource: Resource
    def: CollectionDef // this collection's schema (field types)
    onPatch: (p: ResourcePatch) => void
    onEditTitle?: () => void
    onDelete?: () => void
    editable?: boolean
}

// A collection view = how scribe presents one collection: which editing
// experience, how to render it in the feed, where it lives on the live site.
// Known collections (posts, tags) get bespoke experiences; anything else falls
// back to a schema-driven generic form. (M2 replaces this name-keyed switch with
// the .scribe.yml mapping layer.)
export interface CollectionView {
    name: string
    label: string
    glyph: string
    newLabel: string
    hasDetails: boolean
    experienceLabel: string
    def: CollectionDef
    Experience: ComponentType<ExperienceProps>
    feedTitle: (r: Resource) => string
    feedSub: (r: Resource) => string | undefined
    livePath: (r: Resource) => string | null
}

export function viewFor(def: CollectionDef): CollectionView {
    if (def.name === 'posts') {
        return {
            name: def.name, label: def.label || 'Posts', glyph: '✎', newLabel: '+ write',
            hasDetails: true, experienceLabel: 'Document editor', def,
            Experience: PostExperience as ComponentType<ExperienceProps>,
            feedTitle: (r) => fstr(r, 'title') || 'Untitled',
            feedSub: (r) => fstr(r, 'description') || undefined,
            // /posts/YYYY/MM/DD/<slug>/ (date is UTC; see src/lib/posts.ts)
            livePath: (r) => {
                const d = fstr(r, 'date')
                if (!d) return null
                const [y, m, dd] = d.split('-')
                return `/posts/${y}/${m}/${dd}/${r.slug}/`
            },
        }
    }
    if (def.name === 'tags') {
        return {
            name: def.name, label: def.label || 'Tags', glyph: '#', newLabel: '+ new tag',
            hasDetails: false, experienceLabel: 'Simple form', def,
            Experience: TagExperience as ComponentType<ExperienceProps>,
            feedTitle: (r) => fstr(r, 'name') || r.slug,
            feedSub: (r) => fstr(r, 'description') || undefined,
            livePath: (r) => `/tags/${r.slug}/`,
        }
    }
    // Generic fallback for any other collection.
    const titleField = def.fields.find((f) => f.type === 'string' || f.type === 'text')
    return {
        name: def.name, label: def.label || def.name, glyph: '◇', newLabel: '+ new',
        hasDetails: false, experienceLabel: 'Auto-form (generic)', def,
        Experience: GenericExperience as ComponentType<ExperienceProps>,
        feedTitle: (r) => (titleField ? fstr(r, titleField.name) || r.slug : r.slug),
        feedSub: () => undefined,
        livePath: () => null,
    }
}
