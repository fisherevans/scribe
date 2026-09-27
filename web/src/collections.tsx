import type { ComponentType } from 'react'
import type { CollectionDef, Resource } from './types'
import { fstr } from './types'
import type { CollectionMapping } from './mapping'
import { MODELS } from './experiences/models'
import { PostExperience } from './experiences/PostExperience'
import { TagExperience } from './experiences/TagExperience'
import { GenericExperience } from './experiences/GenericExperience'
import { NoteExperience } from './experiences/NoteExperience'

export interface ResourcePatch {
    fields?: Record<string, unknown>
    body?: string
    notes?: string
}

// A Referencer is a resource that points at some target slug through one of its
// reference fields. Used to drive cascade rename/delete across collections.
export interface Referencer {
    collection: string
    slug: string
    field: string
}

export interface ExperienceProps {
    resource: Resource
    def: CollectionDef // schema (field types)
    map: Record<string, string> // role -> schema field name
    references?: Record<string, string> // reference role -> target collection
    onPatch: (p: ResourcePatch) => void
    onEditTitle?: () => void
    onRename?: (from: string, to: string) => void
    onDelete?: () => void
    onOpenRef?: (collection: string, slug: string) => void
    editable?: boolean
}

const COMPONENTS: Record<string, ComponentType<ExperienceProps>> = {
    'blog-post': PostExperience as ComponentType<ExperienceProps>,
    note: NoteExperience as ComponentType<ExperienceProps>,
    tag: TagExperience as ComponentType<ExperienceProps>,
    generic: GenericExperience as ComponentType<ExperienceProps>,
}

// Experiences whose surface is a document you write, rather than a form you
// fill in. They get an explicit edit mode (and a read-only view mode); form
// experiences are always editable. Keyed on the experience, not the collection
// name - the edit button used to be gated on `collection === 'posts'`, which
// meant notes never got one and any site whose primary collection is named
// something else got none either.
export const DOC_EXPERIENCES = ['blog-post', 'note']
export const isDocExperience = (exp?: string) => !!exp && DOC_EXPERIENCES.includes(exp)

// A collection view = an experience + its resolved mapping for one collection,
// plus how to render it in the feed / link to the live site.
export interface CollectionView {
    name: string
    label: string
    glyph: string
    newLabel: string
    hasDetails: boolean
    experience: string
    experienceLabel: string
    def: CollectionDef
    map: Record<string, string>
    references: Record<string, string>
    Experience: ComponentType<ExperienceProps>
    feedTitle: (r: Resource) => string
    feedSub: (r: Resource) => string | undefined
    livePath: (r: Resource) => string | null
}

export function viewFor(def: CollectionDef, m: CollectionMapping): CollectionView {
    const model = MODELS[m.experience] ?? MODELS.generic
    const map = m.fields ?? {}
    const titleField = map.title || map.name
    const fallbackTitle = def.fields.find((f) => f.type === 'string' || f.type === 'text')?.name
    return {
        name: def.name,
        label: def.label || model.label,
        glyph: model.glyph,
        newLabel: model.newLabel,
        hasDetails: model.hasDetails,
        experience: m.experience,
        experienceLabel: model.label,
        def,
        map,
        references: m.references ?? {},
        Experience: COMPONENTS[m.experience] ?? GenericExperience,
        feedTitle: (r) => {
            // A note has no title field, and falling through to "the first
            // string field" would show its stable id. Derive from the body, the
            // way the site itself does.
            if (m.experience === 'note') return noteSummary(r.body) || r.slug
            const f = titleField || fallbackTitle
            return (f ? fstr(r, f) : '') || r.slug
        },
        feedSub: (r) => (map.description ? fstr(r, map.description) || undefined : undefined),
        // Live URL scheme is a per-experience convention (this blog's).
        livePath: (r) => {
            if (m.experience === 'blog-post') {
                const d = map.date ? fstr(r, map.date) : ''
                if (!d) return null
                const [y, mo, dd] = d.split('-')
                return `/posts/${y}/${mo}/${dd}/${r.slug}/`
            }
            if (m.experience === 'note') {
                const d = map.date ? fstr(r, map.date) : ''
                if (!d) return null
                const [y, mo, dd] = d.split('-')
                return `/notes/${y}/${mo}/${dd}/${r.slug}/`
            }
            if (m.experience === 'tag') return `/tags/${r.slug}/`
            return null
        },
    }
}

// First sentence-ish of a note's body, for feed rows and anywhere a title would
// otherwise go. Shallow on purpose - note bodies are short. Raw HTML (an embed)
// contributes no prose, so a note that is only a video falls back to the
// embed's own title.
export function noteSummary(body: string, max = 72): string {
    const embed = /<iframe[^>]*\btitle=["']([^"']+)["']/i.exec(body)
    const text = body
        .replace(/<[^>]+>/g, ' ')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/^[>#\-*+\s]+/gm, '')
        .replace(/[*_`~]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
    if (!text) return embed ? embed[1].trim() : ''
    if (text.length <= max) return text
    const cut = text.slice(0, max)
    const sp = cut.lastIndexOf(' ')
    return (sp > 20 ? cut.slice(0, sp) : cut).replace(/[,;:.\s]+$/, '') + '…'
}
