import type { Resource, Schema } from './types'
import type { Mapping } from './mapping'

// Generic client over the schema-driven service. Everything is keyed by
// collection name discovered from /api/schema.

// The session/auth proxy in front of scribe expired - the write didn't reach the
// backend and the user must re-authenticate. Detected, not swallowed.
export class AuthError extends Error {
    constructor() {
        super('not authenticated')
        this.name = 'AuthError'
    }
}

// Couldn't reach the server at all (offline / network blip). Callers retry.
export class OfflineError extends Error {
    constructor() {
        super('cannot reach server')
        this.name = 'OfflineError'
    }
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

function sameOrigin(url: string): boolean {
    try {
        return new URL(url, location.href).origin === location.origin
    } catch {
        return true
    }
}

// request wraps fetch so an expired auth session or a dead connection can never
// masquerade as a successful (or merely "unsaved") response. An auth proxy
// intercepts an expired session one of three ways - a 401/403, a redirect to the
// login origin, or the login HTML served with a 200 - all surfaced as AuthError.
async function request(input: string, init?: RequestInit): Promise<Response> {
    let res: Response
    try {
        res = await fetch(input, init)
    } catch {
        throw new OfflineError()
    }
    if (res.status === 401 || res.status === 403) throw new AuthError()
    if (res.redirected && !sameOrigin(res.url)) throw new AuthError()
    if (res.ok && (res.headers.get('content-type') || '').includes('text/html')) throw new AuthError()
    return res
}

async function json(res: Response) {
    if (!res.ok && res.status !== 204) throw new Error(`${res.status}: ${await res.text()}`)
    return res.status === 204 ? null : res.json()
}

const C = (c: string) => `/api/c/${encodeURIComponent(c)}`
const R = (c: string, slug: string) => `${C(c)}/${encodeURIComponent(slug)}`

export const api = {
    schema(): Promise<Schema> {
        return request('/api/schema').then(json)
    },
    mapping(): Promise<Mapping> {
        return request('/api/mapping').then(json)
    },
    saveMapping(m: Mapping): Promise<Mapping> {
        return request('/api/mapping', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(m),
        }).then(json)
    },
    list(c: string): Promise<Resource[]> {
        return request(C(c)).then(json)
    },
    // Full resource: the service rewrites the whole file, so a partial would drop
    // untouched frontmatter.
    async save(c: string, slug: string, data: Resource): Promise<Resource> {
        const res = await request(R(c, slug), {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(data),
        })
        if (res.status === 409) throw new ConflictError(await res.json())
        return json(res)
    },
    create(c: string): Promise<Resource> {
        return request(C(c), { method: 'POST' }).then(json)
    },
    remove(c: string, slug: string): Promise<void> {
        return request(R(c, slug), { method: 'DELETE' }).then(() => undefined)
    },
    rename(c: string, slug: string, to: string): Promise<{ slug: string }> {
        return request(`${R(c, slug)}/rename`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ to }),
        }).then(json)
    },
    // The staged-vs-main changeset: exactly what publish will land, atomically.
    publishDiff(): Promise<PublishDiff> {
        return request('/api/publish').then(json)
    },
    publish(): Promise<PublishResult> {
        return request('/api/publish', { method: 'POST' }).then(json)
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
        return request('/api/upload', { method: 'POST', body }).then(json)
    },
    capabilities(): Promise<Capabilities> {
        return request('/api/capabilities').then(json)
    },
    // In-repo images the editor can reuse (the post's folder first, then the
    // media root). For the "browse repo images" picker.
    media(slug?: string): Promise<{ items: MediaItem[] }> {
        return request('/api/media' + (slug ? `?slug=${encodeURIComponent(slug)}` : '')).then(json)
    },
    // Version checkpoints that touched this resource, newest first.
    history(c: string, slug: string): Promise<Checkpoint[]> {
        return request(`${R(c, slug)}/history`).then(json)
    },
    // The resource as it was at a given checkpoint (for preview/diff). Read-only,
    // never touches the working tree.
    versionAt(c: string, slug: string, hash: string): Promise<Resource> {
        return request(`${R(c, slug)}/at/${encodeURIComponent(hash)}`).then(json)
    },
    // Restore a past version as the current content, landed as a new checkpoint.
    restore(c: string, slug: string, hash: string): Promise<Resource> {
        return request(`${R(c, slug)}/restore`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ hash }),
        }).then(json)
    },
    syncStatus(): Promise<SyncStatus> {
        return request('/api/sync').then(json)
    },
    syncNow(): Promise<SyncStatus> {
        return request('/api/sync', { method: 'POST' }).then(json)
    },
}

export interface Capabilities {
    upload: { external: boolean }
}

// One version checkpoint in a resource's history.
export interface Checkpoint {
    hash: string
    time: string // RFC3339
    added: number
    removed: number
    summary: string
    published: boolean // already live on the publish branch, vs a draft checkpoint
}

export interface MediaItem {
    name: string
    url: string
}

export interface SyncStatus {
    state: 'ok' | 'conflict' | 'error' | 'disabled' | 'degraded'
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
