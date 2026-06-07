import type { ComponentType } from 'react'
import type { CollectionDef, Resource } from './types'
import { fstr } from './types'
import type { CollectionMapping } from './mapping'
import { MODELS } from './experiences/models'
import { PostExperience } from './experiences/PostExperience'
import { TagExperience } from './experiences/TagExperience'
import { GenericExperience } from './experiences/GenericExperience'

export interface ResourcePatch {
    fields?: Record<string, unknown>
    body?: string
    notes?: string
}

export interface ExperienceProps {
    resource: Resource
    def: CollectionDef // schema (field types)
    map: Record<string, string> // role -> schema field name
    onPatch: (p: ResourcePatch) => void
    onEditTitle?: () => void
    onDelete?: () => void
    editable?: boolean
}

const COMPONENTS: Record<string, ComponentType<ExperienceProps>> = {
    'blog-post': PostExperience as ComponentType<ExperienceProps>,
    tag: TagExperience as ComponentType<ExperienceProps>,
    generic: GenericExperience as ComponentType<ExperienceProps>,
}

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
        Experience: COMPONENTS[m.experience] ?? GenericExperience,
        feedTitle: (r) => {
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
            if (m.experience === 'tag') return `/tags/${r.slug}/`
            return null
        },
    }
}
