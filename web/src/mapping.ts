import type { CollectionDef, FieldDef, Schema } from './types'
import { MODELS, type RoleDef } from './experiences/models'

// .scribe.yml shape (mirrors internal/mapping).
export interface CollectionMapping {
    experience: string
    fields: Record<string, string> // role -> schema field name ('body' role omitted; it's the markdown body)
    references?: Record<string, string> // reference role -> target collection
}
export interface Mapping {
    collections: Record<string, CollectionMapping>
}

// referenceTargets: for each reference role on an experience, pick a target
// collection (a collection named like the role, e.g. tags -> tags).
function referenceTargets(experience: string, schema: Schema): Record<string, string> {
    const out: Record<string, string> = {}
    for (const role of MODELS[experience]?.roles ?? []) {
        if (role.type !== 'reference') continue
        const target = schema.collections.find((c) => c.name === role.role) || schema.collections.find((c) => c.name === role.role + 's')
        if (target) out[role.role] = target.name
    }
    return out
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

// matchByName: the unambiguous case - the collection has a field named exactly
// like the role. The body role is special: it is the markdown body, which
// .pages.yml declares as a rich-text field usually named body/content.
function matchByName(def: CollectionDef, role: RoleDef): string | undefined {
    if (role.role === 'body') {
        return def.fields.find((f) => ['body', 'content', 'markdown'].includes(f.name))?.name
    }
    return def.fields.find((f) => f.name === role.role)?.name
}

// matchByType: the guess - the first field whose type could satisfy the role.
function matchByType(def: CollectionDef, role: RoleDef, taken: Set<string>): string | undefined {
    if (role.role === 'body') {
        return def.fields.find((f) => f.type === 'rich-text' && !taken.has(f.name))?.name
    }
    return def.fields.find((f) => roleTypeMatches(role, f) && !taken.has(f.name))?.name
}

// chooseExperience: a basic field-shape heuristic. Recommendations only - the
// setup flow confirms them.
function chooseExperience(def: CollectionDef): string {
    const has = (pred: (f: FieldDef) => boolean) => def.fields.some(pred)
    // A frontmatter collection with no title-ish field is a note: the absence
    // of a title is the defining property of the format, so it is also the
    // cleanest thing to detect. Checked before blog-post, which would otherwise
    // match on any string field (a note's stable `id` is one).
    const titleish = (f: FieldDef) => ['title', 'name', 'heading', 'label'].includes(f.name)
    if (def.format === 'yaml-frontmatter' && !has(titleish)) return 'note'
    if (def.format === 'yaml-frontmatter' && has((f) => ['string', 'text'].includes(f.type))) return 'blog-post'
    if (has((f) => f.name === 'name')) return 'tag'
    return 'generic'
}

// mapFieldsFor fills role->field bindings for a given experience by matching its
// roles against the collection's fields. Used when (re)choosing an experience.
//
// Name matches are resolved for every role before any type guessing, and no
// field is bound twice. Both matter once an experience has two roles of the same
// type: blog-post has `draft` and `featured`, and a single-pass matcher would let
// whichever came first consume the one boolean field by type - so a site with a
// `draft` field and no `featured` field got a featured toggle wired to draft.
export function mapFieldsFor(experience: string, def: CollectionDef): Record<string, string> {
    const roles = MODELS[experience]?.roles ?? []
    const fields: Record<string, string> = {}
    const taken = new Set<string>()
    const bind = (role: string, field: string | undefined) => {
        if (!field) return
        fields[role] = field
        taken.add(field)
    }
    for (const role of roles) bind(role.role, matchByName(def, role))
    for (const role of roles) {
        if (fields[role.role]) continue
        bind(role.role, matchByType(def, role, taken))
    }
    return fields
}

// recommend an experience + field bindings for a collection.
export function recommend(def: CollectionDef): CollectionMapping {
    const exp = chooseExperience(def)
    return { experience: exp, fields: mapFieldsFor(exp, def) }
}

// resolve the active mapping for every collection: stored (.scribe.yml) wins,
// else a recommendation. Always returns a binding per collection.
export function resolve(schema: Schema, stored: Mapping | null): Mapping {
    const out: Mapping = { collections: {} }
    for (const def of schema.collections) {
        const m = stored?.collections?.[def.name] ?? recommend(def)
        // Fill reference targets if the stored mapping didn't specify them.
        const references = { ...referenceTargets(m.experience, schema), ...(m.references ?? {}) }
        out.collections[def.name] = { ...m, references }
    }
    return out
}

// isConfigured: does the repo already have an explicit .scribe.yml covering all
// collections? (Used to decide whether to run the first-run setup.)
export function isConfigured(schema: Schema, stored: Mapping | null): boolean {
    if (!stored) return false
    return schema.collections.every((c) => stored.collections?.[c.name])
}
