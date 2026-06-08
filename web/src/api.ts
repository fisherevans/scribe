import type { Resource, Schema } from './types'
import type { Mapping } from './mapping'

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
    // The staged-vs-main changeset: exactly what publish will land, atomically.
    publishDiff(): Promise<PublishDiff> {
        return fetch('/api/publish').then(json)
    },
    publish(): Promise<PublishResult> {
        return fetch('/api/publish', { method: 'POST' }).then(json)
    },
    syncStatus(): Promise<SyncStatus> {
        return fetch('/api/sync').then(json)
    },
    syncNow(): Promise<SyncStatus> {
        return fetch('/api/sync', { method: 'POST' }).then(json)
    },
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
