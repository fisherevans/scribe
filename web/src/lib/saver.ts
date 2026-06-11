import { api, AuthError, ConflictError } from '../api'
import type { Resource } from '../types'

// SaveState drives the UI: the topbar indicator and the failure banner.
export type SaveState =
    | { kind: 'idle' }
    | { kind: 'dirty' } // edits not yet persisted
    | { kind: 'saving' }
    | { kind: 'saved' }
    | { kind: 'error'; reason: 'auth' | 'offline' } // unsaved; reason drives the banner

export interface SaverCallbacks {
    onState: (s: SaveState) => void
    onSaved: (c: string, saved: Resource) => void // persisted; update lists, clear the draft
    onConflict: (c: string, slug: string, theirs: Resource) => void
}

// Saver serializes autosaves so two writes are never in flight at once, and
// tracks the server version PER resource (not baked into a stale snapshot) so a
// burst of edits during a slow save can't send an out-of-date version and get a
// bogus 409. It retries transient failures with backoff and surfaces auth /
// offline failures instead of swallowing them - the whole point is that the user
// always knows whether their work is saved.
export class Saver {
    private pending: { c: string; resource: Resource } | null = null
    private versions = new Map<string, string>() // key -> last known server version
    private inFlight = false
    private pausedKey: string | null = null // key with an unresolved conflict; its saves are held
    private fails = 0
    private timer: ReturnType<typeof setTimeout> | null = null
    private waiters: Array<() => void> = []

    constructor(
        private cb: SaverCallbacks,
        private doSave: typeof api.save = api.save,
        private debounceMs = 650,
    ) {}

    private key(c: string, slug: string) {
        return c + '/' + slug
    }

    // Seed the known version for a resource (on load / doc open).
    seed(c: string, slug: string, version?: string) {
        const k = this.key(c, slug)
        if (version) this.versions.set(k, version)
        else this.versions.delete(k)
    }

    // Record an edit. Coalesces; a debounced flush follows.
    request(c: string, resource: Resource) {
        this.pending = { c, resource }
        const k = this.key(c, resource.slug)
        if (resource.version && !this.versions.has(k)) this.versions.set(k, resource.version)
        this.cb.onState({ kind: 'dirty' })
        this.schedule(this.debounceMs)
    }

    // Has unsaved or in-flight work?
    get dirty() {
        return this.inFlight || !!this.pending
    }
    get blocked() {
        return this.pausedKey !== null
    }

    private schedule(delay: number) {
        if (this.timer) clearTimeout(this.timer)
        this.timer = setTimeout(() => this.flush(), delay)
    }

    private flush() {
        if (this.timer) {
            clearTimeout(this.timer)
            this.timer = null
        }
        if (this.inFlight) return
        const job = this.pending
        if (!job) {
            this.settle()
            return
        }
        if (this.pausedKey === this.key(job.c, job.resource.slug)) {
            this.settle() // conflict on this resource; held until resolved
            return
        }
        void this.run(job)
    }

    private async run(job: { c: string; resource: Resource }) {
        const k = this.key(job.c, job.resource.slug)
        this.inFlight = true
        this.cb.onState({ kind: 'saving' })
        try {
            const next = await this.doSave(job.c, job.resource.slug, { ...job.resource, version: this.versions.get(k) })
            this.versions.set(k, next.version ?? '')
            this.cb.onSaved(job.c, next)
            this.fails = 0
            this.inFlight = false
            if (this.pending === job) {
                this.pending = null
                this.cb.onState({ kind: 'saved' })
                this.settle()
            } else {
                // Newer edits arrived while this save was in flight - persist them.
                this.cb.onState({ kind: 'dirty' })
                this.flush()
            }
        } catch (e) {
            this.inFlight = false
            if (e instanceof ConflictError) {
                this.pausedKey = k
                this.cb.onConflict(job.c, job.resource.slug, e.current)
                this.cb.onState({ kind: 'dirty' })
                this.settle()
                return
            }
            if (e instanceof AuthError) {
                this.cb.onState({ kind: 'error', reason: 'auth' }) // stop; re-auth required
                this.settle()
                return
            }
            // Transient (offline / 5xx / parse): keep the pending edit, retry with
            // backoff, and tell the user it's not saved.
            this.fails++
            this.cb.onState({ kind: 'error', reason: 'offline' })
            this.schedule(Math.min(10000, 1000 * 2 ** Math.min(this.fails - 1, 4)))
            this.settle()
        }
    }

    // Flush now and resolve when settled. true = everything saved cleanly. Used by
    // the "done" reconciliation so the user is never told they're done on a failed
    // or conflicted save.
    flushAndWait(): Promise<boolean> {
        if (!this.dirty && !this.blocked) return Promise.resolve(true)
        return new Promise((resolve) => {
            this.waiters.push(() => resolve(!this.dirty && !this.blocked))
            this.flush()
        })
    }

    // Conflict resolved by taking the server's version.
    acceptTheirs(c: string, slug: string, version?: string) {
        const k = this.key(c, slug)
        this.versions.set(k, version ?? '')
        if (this.pending && this.key(this.pending.c, this.pending.resource.slug) === k) this.pending = null
        if (this.pausedKey === k) this.pausedKey = null
        this.cb.onState({ kind: 'saved' })
        this.settle()
    }

    // Conflict resolved by overwriting: force-save the given resource.
    overwrite(c: string, resource: Resource) {
        const k = this.key(c, resource.slug)
        if (this.pausedKey === k) this.pausedKey = null
        this.versions.delete(k) // empty version -> server skips the check
        this.pending = { c, resource }
        this.flush()
    }

    // Drop pending work without saving (discard). Versions are kept.
    reset() {
        if (this.timer) clearTimeout(this.timer)
        this.timer = null
        this.pending = null
        this.pausedKey = null
        this.fails = 0
        this.settle()
    }

    private settle() {
        const w = this.waiters
        this.waiters = []
        w.forEach((fn) => fn())
    }
}
