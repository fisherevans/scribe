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

// Saver is the single autosave path. It:
//   - serializes writes so two are never in flight at once,
//   - tracks the server version PER resource (not baked into a stale snapshot)
//     so a burst of edits during a slow save can't send an out-of-date version
//     and get a bogus 409,
//   - keeps pending edits in a map keyed by resource, so editing several docs
//     inside one debounce window never drops a save,
//   - debounces the network write (idle debounce, capped by maxWait so a long
//     continuous edit still saves periodically rather than only on pause),
//   - retries transient failures with backoff and surfaces auth/offline failures
//     instead of swallowing them.
export class Saver {
    private pending = new Map<string, { c: string; resource: Resource }>() // key -> latest unsaved edit
    private versions = new Map<string, string>() // key -> last known server version
    private inFlight = false
    private pausedKey: string | null = null // key with an unresolved conflict; its saves are held
    private fails = 0
    private timer: ReturnType<typeof setTimeout> | null = null
    private dirtySince: number | null = null // when the current unsaved window opened (for maxWait)
    private waiters: Array<(ok: boolean) => void> = []

    constructor(
        private cb: SaverCallbacks,
        private doSave: typeof api.save = api.save,
        private debounceMs = 2000, // save this long after the last keystroke...
        private maxWaitMs = 5000, // ...but never wait longer than this during a continuous edit
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

    // Record an edit. Coalesces per resource; a debounced flush follows.
    request(c: string, resource: Resource) {
        const k = this.key(c, resource.slug)
        this.pending.set(k, { c, resource })
        if (resource.version && !this.versions.has(k)) this.versions.set(k, resource.version)
        if (this.dirtySince === null) this.dirtySince = Date.now()
        this.cb.onState({ kind: 'dirty' })
        this.scheduleDebounced()
    }

    // Has unsaved or in-flight work?
    get dirty() {
        return this.inFlight || this.pending.size > 0
    }
    get blocked() {
        return this.pausedKey !== null
    }

    private scheduleDebounced() {
        const cap = this.dirtySince === null ? this.debounceMs : Math.max(0, this.maxWaitMs - (Date.now() - this.dirtySince))
        this.scheduleIn(Math.min(this.debounceMs, cap))
    }
    private scheduleIn(ms: number) {
        if (this.timer) clearTimeout(this.timer)
        this.timer = setTimeout(() => this.flush(), ms)
    }

    // Run now: push the oldest runnable pending edit. Public so the UI can force
    // a save on doc-switch / unload without waiting for the debounce.
    flush() {
        if (this.timer) {
            clearTimeout(this.timer)
            this.timer = null
        }
        if (this.inFlight) return
        const job = this.nextJob()
        if (!job) {
            // Nothing runnable: either fully drained (clean) or everything left is
            // a held conflict (blocked).
            this.resolveWaiters(this.pending.size === 0)
            return
        }
        void this.run(job)
    }

    // The first pending edit whose resource isn't holding a conflict.
    private nextJob() {
        for (const [k, job] of this.pending) {
            if (k !== this.pausedKey) return job
        }
        return undefined
    }

    private async run(job: { c: string; resource: Resource }) {
        const k = this.key(job.c, job.resource.slug)
        this.inFlight = true
        this.dirtySince = null // this window is being flushed; the next edit opens a fresh one
        this.cb.onState({ kind: 'saving' })
        try {
            const next = await this.doSave(job.c, job.resource.slug, { ...job.resource, version: this.versions.get(k) })
            this.versions.set(k, next.version ?? '')
            this.cb.onSaved(job.c, next)
            this.fails = 0
            this.inFlight = false
            // Drop this edit only if no newer edit for the same resource landed
            // while the save was in flight.
            if (this.pending.get(k) === job) this.pending.delete(k)
            if (this.nextJob()) {
                this.cb.onState({ kind: 'dirty' })
                this.flush() // more to persist
            } else {
                this.cb.onState({ kind: 'saved' })
                this.resolveWaiters(this.pending.size === 0)
            }
        } catch (e) {
            this.inFlight = false
            if (e instanceof ConflictError) {
                this.pausedKey = k // hold this resource; keep its pending edit
                this.cb.onConflict(job.c, job.resource.slug, e.current)
                this.cb.onState({ kind: 'dirty' })
                this.resolveWaiters(false)
                return
            }
            if (e instanceof AuthError) {
                this.cb.onState({ kind: 'error', reason: 'auth' }) // stop; re-auth required
                this.resolveWaiters(false)
                return
            }
            // Transient (offline / 5xx / parse): keep the pending edit, retry with
            // backoff, and tell the user it's not saved.
            this.fails++
            this.cb.onState({ kind: 'error', reason: 'offline' })
            this.scheduleIn(Math.min(10000, 1000 * 2 ** Math.min(this.fails - 1, 4)))
            this.resolveWaiters(false)
        }
    }

    // Flush now and resolve when settled. true = everything saved cleanly. Used by
    // the "done" reconciliation and the unload guard so the user is never told
    // they're done on a failed or conflicted save.
    flushAndWait(): Promise<boolean> {
        if (!this.dirty && !this.blocked) return Promise.resolve(true)
        return new Promise((resolve) => {
            this.waiters.push(resolve)
            this.flush()
        })
    }

    // Conflict resolved by taking the server's version.
    acceptTheirs(c: string, slug: string, version?: string) {
        const k = this.key(c, slug)
        this.versions.set(k, version ?? '')
        this.pending.delete(k)
        if (this.pausedKey === k) this.pausedKey = null
        if (this.nextJob()) this.flush()
        else {
            this.cb.onState({ kind: 'saved' })
            this.resolveWaiters(this.pending.size === 0)
        }
    }

    // Conflict resolved by overwriting: force-save the given resource.
    overwrite(c: string, resource: Resource) {
        const k = this.key(c, resource.slug)
        if (this.pausedKey === k) this.pausedKey = null
        this.versions.delete(k) // empty version -> server skips the check
        this.pending.set(k, { c, resource })
        this.flush()
    }

    // Drop pending work without saving (discard). Versions are kept.
    reset() {
        if (this.timer) clearTimeout(this.timer)
        this.timer = null
        this.pending.clear()
        this.pausedKey = null
        this.fails = 0
        this.dirtySince = null
        this.resolveWaiters(true)
    }

    private resolveWaiters(ok: boolean) {
        if (this.waiters.length === 0) return
        const w = this.waiters
        this.waiters = []
        w.forEach((fn) => fn(ok))
    }
}
