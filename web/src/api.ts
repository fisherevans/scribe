import type { CollectionName, Resource } from './types'

// Real client against the Go service (proxied at /api by Vite in dev). Same
// shape as the former mock, so the app is agnostic to which is behind it.
async function json(res: Response) {
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`)
    return res.json()
}

export const api = {
    list(c: CollectionName): Promise<Resource[]> {
        return fetch(`/api/${c}`).then(json)
    },
    // `data` is the full resource - the service rewrites the whole file, so a
    // partial would drop untouched frontmatter.
    save(c: CollectionName, slug: string, data: Resource): Promise<Resource> {
        return fetch(`/api/${c}/${encodeURIComponent(slug)}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(data),
        }).then(json)
    },
    promote(c: CollectionName, slug: string): Promise<Resource> {
        return fetch(`/api/${c}/${encodeURIComponent(slug)}/promote`, { method: 'POST' }).then(json)
    },
    create(c: CollectionName): Promise<Resource> {
        return fetch(`/api/${c}`, { method: 'POST' }).then(json)
    },
}
