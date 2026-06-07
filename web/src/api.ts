import type { Resource, Schema } from './types'

// Generic client over the schema-driven service. Everything is keyed by
// collection name discovered from /api/schema.
async function json(res: Response) {
    if (!res.ok && res.status !== 204) throw new Error(`${res.status}: ${await res.text()}`)
    return res.status === 204 ? null : res.json()
}

const C = (c: string) => `/api/c/${encodeURIComponent(c)}`
const R = (c: string, slug: string) => `${C(c)}/${encodeURIComponent(slug)}`

export const api = {
    schema(): Promise<Schema> {
        return fetch('/api/schema').then(json)
    },
    list(c: string): Promise<Resource[]> {
        return fetch(C(c)).then(json)
    },
    // Full resource: the service rewrites the whole file, so a partial would drop
    // untouched frontmatter.
    save(c: string, slug: string, data: Resource): Promise<Resource> {
        return fetch(R(c, slug), {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(data),
        }).then(json)
    },
    create(c: string): Promise<Resource> {
        return fetch(C(c), { method: 'POST' }).then(json)
    },
    remove(c: string, slug: string): Promise<void> {
        return fetch(R(c, slug), { method: 'DELETE' }).then(() => undefined)
    },
    rename(c: string, slug: string, to: string): Promise<{ slug: string }> {
        return fetch(`${R(c, slug)}/rename`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ to }),
        }).then(json)
    },
    promote(c: string, slug: string): Promise<Resource> {
        return fetch(`${R(c, slug)}/promote`, { method: 'POST' }).then(json)
    },
}
