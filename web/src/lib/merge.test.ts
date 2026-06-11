import { describe, it, expect } from 'vitest'
import { fieldDiffs, bodyItems, pickBody, buildMerged, type Side } from './merge'
import type { Resource } from '../types'

const res = (fields: Record<string, unknown>, body: string): Resource => ({
    collection: 'posts',
    slug: 'p',
    fields,
    body,
    state: 'staged',
    dirty: false,
    notes: 'mynotes',
})

describe('fieldDiffs', () => {
    it('reports only differing keys, over the union', () => {
        const mine = res({ title: 'A', desc: 'mine', extra: 1 }, '')
        const theirs = res({ title: 'A', desc: 'theirs', only: 2 }, '')
        const d = fieldDiffs(mine, theirs).sort((a, b) => a.key.localeCompare(b.key))
        expect(d).toEqual([
            { key: 'desc', mine: 'mine', theirs: 'theirs' },
            { key: 'extra', mine: 1, theirs: undefined },
            { key: 'only', mine: undefined, theirs: 2 },
        ])
    })

    it('treats deep-equal arrays as unchanged', () => {
        const mine = res({ tags: ['a', 'b'] }, '')
        const theirs = res({ tags: ['a', 'b'] }, '')
        expect(fieldDiffs(mine, theirs)).toEqual([])
    })
})

describe('bodyItems + pickBody', () => {
    it('is empty when bodies match', () => {
        expect(bodyItems('same\n', 'same\n')).toEqual([])
    })

    it('keeps shared context and isolates the changed hunk', () => {
        const mine = 'line1\nMINE\nline3\n'
        const theirs = 'line1\nTHEIRS\nline3\n'
        const items = bodyItems(mine, theirs)
        const hunks = items.filter((i) => !i.equal)
        expect(hunks).toHaveLength(1)
        expect(hunks[0].mineText).toBe('MINE\n')
        expect(hunks[0].theirsText).toBe('THEIRS\n')
        // default (mine) reconstructs mine exactly
        expect(pickBody(items, {})).toBe(mine)
    })

    it('honors per-hunk side selection, including both', () => {
        const mine = 'a\nMINE\nz\n'
        const theirs = 'a\nTHEIRS\nz\n'
        const items = bodyItems(mine, theirs)
        const h = items.find((i) => !i.equal)!
        expect(pickBody(items, { [h.id]: 'theirs' })).toBe('a\nTHEIRS\nz\n')
        expect(pickBody(items, { [h.id]: 'both' })).toBe('a\nTHEIRS\nMINE\nz\n')
    })

    it('handles a pure addition on mine', () => {
        const mine = 'a\nb\nc\n'
        const theirs = 'a\nc\n'
        const items = bodyItems(mine, theirs)
        const h = items.find((i) => !i.equal)!
        expect(h.mineText).toBe('b\n')
        expect(h.theirsText ?? '').toBe('')
        expect(pickBody(items, { [h.id]: 'theirs' })).toBe(theirs)
        expect(pickBody(items, { [h.id]: 'mine' })).toBe(mine)
    })
})

describe('buildMerged', () => {
    it('combines chosen field sides and body, keeping mine identity/notes', () => {
        const mine = res({ title: 'T', desc: 'mine-desc', tags: ['x'] }, 'a\nMINE\nz\n')
        const theirs = res({ title: 'T', desc: 'theirs-desc', tags: ['x'] }, 'a\nTHEIRS\nz\n')
        const diffs = fieldDiffs(mine, theirs)
        const items = bodyItems(mine.body, theirs.body)
        const h = items.find((i) => !i.equal)!
        const fieldChoices: Record<string, Side> = { desc: 'theirs' }
        const bodyChoices: Record<number, Side> = { [h.id]: 'mine' }
        const merged = buildMerged(mine, diffs, fieldChoices, items, bodyChoices)
        expect(merged.fields).toEqual({ title: 'T', desc: 'theirs-desc', tags: ['x'] })
        expect(merged.body).toBe('a\nMINE\nz\n')
        expect(merged.notes).toBe('mynotes')
        expect(merged.dirty).toBe(true)
    })

    it('dropping a field mine deleted: choosing mine omits the key', () => {
        const mine = res({ title: 'T' }, '')
        const theirs = res({ title: 'T', stale: 'gone' }, '')
        const diffs = fieldDiffs(mine, theirs)
        const merged = buildMerged(mine, diffs, { stale: 'mine' }, [], {})
        expect('stale' in merged.fields).toBe(false)
    })
})
