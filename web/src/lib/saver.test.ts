import { describe, it, expect, vi } from 'vitest'
import { Saver, type SaveState } from './saver'
import { AuthError, ConflictError, OfflineError } from '../api'
import type { Resource } from '../types'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function res(slug: string, body: string, version?: string): Resource {
    return { collection: 'posts', slug, body, fields: {}, state: 'staged', dirty: true, notes: '', version }
}

function deferred<T>() {
    let resolve!: (v: T) => void
    let reject!: (e: unknown) => void
    const promise = new Promise<T>((rs, rj) => { resolve = rs; reject = rj })
    return { promise, resolve, reject }
}

const silent = { onState() {}, onSaved() {}, onConflict() {} }

describe('Saver', () => {
    // The bug behind the false "conflict with another version" banner: a burst of
    // edits during a slow save sent the version from a stale snapshot, so the
    // second write carried an out-of-date version and got a bogus 409.
    it('sends the latest server version after an in-flight save (no false 409)', async () => {
        const versions: (string | undefined)[] = []
        const d1 = deferred<Resource>()
        let n = 0
        const save = vi.fn(async (_c: string, _slug: string, data: Resource) => {
            versions.push(data.version)
            return ++n === 1 ? d1.promise : { ...data, version: 'v3' }
        })
        const saver = new Saver(silent, save as never, 5)
        saver.seed('posts', 'a', 'v1')

        saver.request('posts', res('a', 'A'))
        await sleep(15)
        expect(save).toHaveBeenCalledTimes(1)
        expect(versions[0]).toBe('v1')

        saver.request('posts', res('a', 'B')) // edit while the first save is in flight
        await sleep(15)
        expect(save).toHaveBeenCalledTimes(1) // held: never two writes at once

        d1.resolve(res('a', 'A', 'v2')) // first save lands, server moved to v2
        await sleep(15)
        expect(save).toHaveBeenCalledTimes(2)
        expect(versions[1]).toBe('v2') // the fix: not the stale 'v1'
    })

    // With a multi-second debounce, editing several docs inside one window must
    // not drop any save - the reason pending is a per-resource map, not one slot.
    it('keeps a pending edit per resource (no drop across docs)', async () => {
        const saved: string[] = []
        const save = vi.fn(async (_c: string, slug: string, data: Resource) => {
            saved.push(slug)
            return { ...data, version: 'v2' }
        })
        const saver = new Saver(silent, save as never, 5)
        saver.request('posts', res('a', 'A', 'v1'))
        saver.request('posts', res('b', 'B', 'v1')) // different doc, same debounce window
        await sleep(20)
        expect(save).toHaveBeenCalledTimes(2)
        expect([...saved].sort()).toEqual(['a', 'b'])
    })

    it('retries a transient failure and recovers', async () => {
        const states: string[] = []
        let n = 0
        const save = vi.fn(async (_c: string, _slug: string, data: Resource) => {
            if (++n === 1) throw new OfflineError()
            return { ...data, version: 'v2' }
        })
        const onState = (s: SaveState) => states.push(s.kind === 'error' ? 'error:' + s.reason : s.kind)
        const saver = new Saver({ onState, onSaved() {}, onConflict() {} }, save as never, 5)

        saver.request('posts', res('a', 'A', 'v1'))
        await sleep(30)
        expect(states).toContain('error:offline') // surfaced, not swallowed
        await sleep(1100) // backoff retry
        expect(n).toBe(2)
        expect(states).toContain('saved')
    })

    it('pauses on conflict and resumes after acceptTheirs', async () => {
        const conflicts: Resource[] = []
        const save = vi.fn(async (_c: string, _slug: string, data: Resource) => {
            if (data.version === 'v1') throw new ConflictError(res('a', 'SERVER', 'v9'))
            return { ...data, version: 'v2' }
        })
        const saver = new Saver({ onState() {}, onSaved() {}, onConflict: (_c, _s, t) => conflicts.push(t) }, save as never, 5)
        saver.seed('posts', 'a', 'v1')

        saver.request('posts', res('a', 'A'))
        await sleep(15)
        expect(conflicts).toHaveLength(1)
        expect(saver.blocked).toBe(true)

        saver.request('posts', res('a', 'B')) // held while the conflict is unresolved
        await sleep(15)
        expect(save).toHaveBeenCalledTimes(1)

        saver.acceptTheirs('posts', 'a', 'v9')
        saver.request('posts', res('a', 'C'))
        await sleep(15)
        expect(save).toHaveBeenCalledTimes(2) // unblocked, saves against the adopted version
    })

    it('flushAndWait reports the real outcome', async () => {
        const ok = new Saver(silent, (async (_c: string, _s: string, d: Resource) => ({ ...d, version: 'v2' })) as never, 5)
        ok.request('posts', res('a', 'A', 'v1'))
        expect(await ok.flushAndWait()).toBe(true)

        const bad = new Saver(silent, (async () => { throw new AuthError() }) as never, 5)
        bad.request('posts', res('b', 'B', 'v1'))
        expect(await bad.flushAndWait()).toBe(false) // never claims success on a failed save
    })
})
