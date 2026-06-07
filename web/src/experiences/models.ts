// An experience's content model: the fields (roles) it knows how to edit, with
// a type and whether it's required. The mapping (.scribe.yml) binds each role to
// a real schema field. The `body` role is special - it maps to the markdown
// body, not a frontmatter field.
export type RoleType = 'text' | 'markdown' | 'date' | 'boolean' | 'reference' | 'image' | 'number'

export interface RoleDef {
    role: string
    label: string
    type: RoleType
    required: boolean
    list?: boolean
}

export interface ExperienceModel {
    id: string
    label: string
    glyph: string
    newLabel: string
    hasDetails: boolean
    roles: RoleDef[]
}

export const MODELS: Record<string, ExperienceModel> = {
    'blog-post': {
        id: 'blog-post', label: 'Blog post', glyph: '✎', newLabel: '+ write', hasDetails: true,
        roles: [
            { role: 'title', label: 'Title', type: 'text', required: true },
            { role: 'body', label: 'Body', type: 'markdown', required: true },
            { role: 'description', label: 'Description', type: 'text', required: false },
            { role: 'tags', label: 'Tags', type: 'reference', required: false, list: true },
            { role: 'date', label: 'Date', type: 'date', required: false },
            { role: 'draft', label: 'Draft', type: 'boolean', required: false },
            { role: 'updatedDate', label: 'Updated', type: 'date', required: false },
            { role: 'heroImage', label: 'Hero image', type: 'image', required: false },
        ],
    },
    tag: {
        id: 'tag', label: 'Tag', glyph: '#', newLabel: '+ new tag', hasDetails: false,
        roles: [
            { role: 'name', label: 'Name', type: 'text', required: true },
            { role: 'description', label: 'Description', type: 'text', required: false },
        ],
    },
    generic: {
        id: 'generic', label: 'Generic form', glyph: '◇', newLabel: '+ new', hasDetails: false,
        roles: [],
    },
}

export const EXPERIENCE_IDS = Object.keys(MODELS)
