// A resource is generic: its collection, slug, an open frontmatter field map,
// and a markdown body. The typed Post/Tag shapes are gone - the editor reads
// and writes through `fields` so scribe works against any schema. `state` is the
// staging axis; `notes` is private app-side metadata.
export type ResourceState = 'staged' | 'promoted'

export interface Resource {
    collection: string
    slug: string
    fields: Record<string, unknown>
    body: string
    state: ResourceState
    dirty: boolean
    notes: string
}

// ---- schema (from /api/schema) -----------------------------------------
export interface FieldDef {
    name: string
    label: string
    type: string // string, text, rich-text, date, boolean, image, number, select, object, code
    required: boolean
    list: boolean
    options?: string[] // for select fields
}
export interface CollectionDef {
    name: string
    label: string
    path: string
    format: string
    ext: string
    fields: FieldDef[]
}
export interface Schema {
    collections: CollectionDef[]
    primary: string
}

// ---- field accessors ----------------------------------------------------
export const fstr = (r: Resource, k: string): string => {
    const v = r.fields[k]
    return typeof v === 'string' ? v : v == null ? '' : String(v)
}
export const fbool = (r: Resource, k: string): boolean => r.fields[k] === true
export const flist = (r: Resource, k: string): string[] =>
    Array.isArray(r.fields[k]) ? (r.fields[k] as string[]) : []
