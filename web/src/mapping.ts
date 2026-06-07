import type { CollectionDef, FieldDef, Schema } from './types'
import { MODELS, type RoleDef } from './experiences/models'

// .scribe.yml shape (mirrors internal/mapping).
export interface CollectionMapping {
    experience: string
    fields: Record<string, string> // role -> schema field name ('body' role omitted; it's the markdown body)
}
export interface Mapping {
    collections: Record<string, CollectionMapping>
}

// roleTypeMatches: does a schema field plausibly satisfy a role's type?
function roleTypeMatches(role: RoleDef, f: FieldDef): boolean {
    switch (role.type) {
        case 'text': return ['string', 'text', 'rich-text'].includes(f.type)
        case 'date': return f.type === 'date'
        case 'boolean': return f.type === 'boolean'
        case 'reference': return f.list
        case 'image': return f.type === 'image'
        case 'number': return f.type === 'number'
        default: return false
    }
}

// matchField: pick a schema field for a role - exact name first, then by type.
function matchField(def: CollectionDef, role: RoleDef): string | undefined {
    if (role.role === 'body') {
        // The markdown body shows up in .pages.yml as a rich-text field (usually
        // named body/content). Bind it so it's recognized as covered (the editor
        // still uses the actual file body, not this frontmatter field).
        const named = def.fields.find((f) => ['body', 'content', 'markdown'].includes(f.name))
        return named?.name ?? def.fields.find((f) => f.type === 'rich-text')?.name
    }
    if (def.fields.some((f) => f.name === role.role)) return role.role
    return def.fields.find((f) => roleTypeMatches(role, f))?.name
}

// chooseExperience: a basic field-shape heuristic. Recommendations only - the
// setup flow confirms them.
function chooseExperience(def: CollectionDef): string {
    const has = (pred: (f: FieldDef) => boolean) => def.fields.some(pred)
    if (def.format === 'yaml-frontmatter' && has((f) => ['string', 'text'].includes(f.type))) return 'blog-post'
    if (has((f) => f.name === 'name')) return 'tag'
    return 'generic'
}

// recommend an experience + field bindings for a collection.
export function recommend(def: CollectionDef): CollectionMapping {
    const exp = chooseExperience(def)
    const fields: Record<string, string> = {}
    for (const role of MODELS[exp].roles) {
        const f = matchField(def, role)
        if (f) fields[role.role] = f
    }
    return { experience: exp, fields }
}

// resolve the active mapping for every collection: stored (.scribe.yml) wins,
// else a recommendation. Always returns a binding per collection.
export function resolve(schema: Schema, stored: Mapping | null): Mapping {
    const out: Mapping = { collections: {} }
    for (const def of schema.collections) {
        out.collections[def.name] = stored?.collections?.[def.name] ?? recommend(def)
    }
    return out
}

// isConfigured: does the repo already have an explicit .scribe.yml covering all
// collections? (Used to decide whether to run the first-run setup.)
export function isConfigured(schema: Schema, stored: Mapping | null): boolean {
    if (!stored) return false
    return schema.collections.every((c) => stored.collections?.[c.name])
}
