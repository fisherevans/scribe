import type { Resource, Schema } from './types'
import type { Mapping } from './mapping'

// Generic client over the schema-driven service. Everything is keyed by
// collection name discovered from /api/schema.
async function json(res: Response) {
    if (!res.ok && res.status !== 204) throw new Error(`${res.status}: ${await res.text()}`)
    return res.status === 204 ? null : res.json()
}

// Thrown by save() on a 409: the file changed since the client read it. Carries
// the current server resource so the UI can reload/overwrite/merge.
export class ConflictError extends Error {
    current: Resource
    constructor(current: Resource) {
        super('conflict')
        this.name = 'ConflictError'
        this.current = current
    }
}

const C = (c: string) => `/api/c/${encodeURIComponent(c)}`
const R = (c: string, slug: string) => `${C(c)}/${encodeURIComponent(slug)}`

export const api = {
    schema(): Promise<Schema> {
        return fetch('/api/schema').then(json)
    },
    mapping(): Promise<Mapping> {
        return fetch('/api/mapping').then(json)
    },
    saveMapping(m: Mapping): Promise<Mapping> {
        return fetch('/api/mapping', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(m),
        }).then(json)
    },
    list(c: string): Promise<Resource[]> {
        return fetch(C(c)).then(json)
    },
    // Full resource: the service rewrites the whole file, so a partial would drop
    // untouched frontmatter.
    async save(c: string, slug: string, data: Resource): Promise<Resource> {
        const res = await fetch(R(c, slug), {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(data),
        })
        if (res.status === 409) throw new ConflictError(await res.json())
        return json(res)
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
    // The staged-vs-main changeset: exactly what publish will land, atomically.
    publishDiff(): Promise<PublishDiff> {
        return fetch('/api/publish').then(json)
    },
    publish(): Promise<PublishResult> {
        return fetch('/api/publish', { method: 'POST' }).then(json)
    },
    // Upload an image. dest 'external' runs the configured upload command (CDN);
    // 'local' copies into the site media dir, grouped per-post when a slug is
    // given. name is the chosen base filename (extension is kept server-side).
    upload(file: File, opts: { dest: 'external' | 'local'; name?: string; slug?: string }): Promise<{ url: string }> {
        const body = new FormData()
        body.append('file', file)
        body.append('dest', opts.dest)
        if (opts.name) body.append('name', opts.name)
        if (opts.slug) body.append('slug', opts.slug)
        return fetch('/api/upload', { method: 'POST', body }).then(json)
    },
    capabilities(): Promise<Capabilities> {
        return fetch('/api/capabilities').then(json)
    },
    // In-repo images the editor can reuse (the post's folder first, then the
    // media root). For the "browse repo images" picker.
    media(slug?: string): Promise<{ items: MediaItem[] }> {
        return fetch('/api/media' + (slug ? `?slug=${encodeURIComponent(slug)}` : '')).then(json)
    },
    syncStatus(): Promise<SyncStatus> {
        return fetch('/api/sync').then(json)
    },
    syncNow(): Promise<SyncStatus> {
        return fetch('/api/sync', { method: 'POST' }).then(json)
    },
}

export interface Capabilities {
    upload: { external: boolean }
}

export interface MediaItem {
    name: string
    url: string
}

export interface SyncStatus {
    state: 'ok' | 'conflict' | 'error' | 'disabled'
    message: string
    rev: string
    lastSync?: string
    lastBackup?: string
    push: boolean
}

export interface PublishChange {
    collection: string
    slug: string
    title: string
    status: 'added' | 'modified' | 'deleted' | 'renamed'
    from?: string
}
export interface PublishDiff {
    changes: PublishChange[]
    enabled: boolean
}
export interface PublishResult {
    published: number
    enabled: boolean
}
