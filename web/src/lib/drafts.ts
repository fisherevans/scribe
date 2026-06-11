import type { Resource } from '../types'

// Local safety net against silent save loss. Every edit writes the full resource
// to localStorage; a successful save clears it. A draft that survives a reload
// therefore means the last edits never reached the server (auth loss, crash,
// closed tab mid-save) - exactly the case we want to recover. Drafts are scoped
// per collection/slug and never touch the blog repo.

const PREFIX = 'scribe:draft:'
const keyFor = (c: string, slug: string) => `${PREFIX}${c}/${slug}`

export interface Draft {
    collection: string
    slug: string
    resource: Resource
    at: number // epoch ms of the edit
}

export function writeDraft(c: string, resource: Resource) {
    try {
        const d: Draft = { collection: c, slug: resource.slug, resource, at: Date.now() }
        localStorage.setItem(keyFor(c, resource.slug), JSON.stringify(d))
    } catch {
        // Quota / disabled storage: the in-memory copy and the server are still
        // the real sources of truth. Best-effort only.
    }
}

export function clearDraft(c: string, slug: string) {
    try {
        localStorage.removeItem(keyFor(c, slug))
    } catch {
        /* ignore */
    }
}

export function listDrafts(): Draft[] {
    const out: Draft[] = []
    try {
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i)
            if (!k || !k.startsWith(PREFIX)) continue
            const raw = localStorage.getItem(k)
            if (!raw) continue
            try {
                const d = JSON.parse(raw) as Draft
                if (d && d.resource && typeof d.slug === 'string') out.push(d)
            } catch {
                /* skip corrupt entry */
            }
        }
    } catch {
        /* storage unavailable */
    }
    return out.sort((a, b) => b.at - a.at)
}

// A draft is only worth recovering if it actually diverges from what's on the
// server now. Compares the parts the editor can change: body, frontmatter
// fields, and private notes. Clears stale (matching) drafts as a side effect so
// recovery prompts stay honest.
export function recoverableDraft(d: Draft, server: Resource | undefined): boolean {
    if (!server) return true // resource no longer in the loaded set; surface it
    const same =
        d.resource.body === server.body &&
        (d.resource.notes ?? '') === (server.notes ?? '') &&
        JSON.stringify(d.resource.fields ?? {}) === JSON.stringify(server.fields ?? {})
    if (same) clearDraft(d.collection, d.slug)
    return !same
}
