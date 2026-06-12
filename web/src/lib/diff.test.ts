import { describe, it, expect } from 'vitest'
import { inlineSegs, diffRows } from './diff'

describe('inlineSegs (word-level)', () => {
    it('flags only the changed word, not the whole line', () => {
        const { del, add } = inlineSegs('the quick brown fox', 'the slow brown fox')
        // unchanged runs stay unflagged; only "quick"/"slow" are changed
        expect(del.filter((s) => s.changed).map((s) => s.text)).toEqual(['quick'])
        expect(add.filter((s) => s.changed).map((s) => s.text)).toEqual(['slow'])
        // and the rest is preserved verbatim on each side
        expect(del.map((s) => s.text).join('')).toBe('the quick brown fox')
        expect(add.map((s) => s.text).join('')).toBe('the slow brown fox')
    })

    it('handles a pure insertion within a line', () => {
        const { add } = inlineSegs('a c', 'a b c')
        expect(add.filter((s) => s.changed).map((s) => s.text).join('')).toContain('b')
        expect(add.map((s) => s.text).join('')).toBe('a b c')
    })
})

describe('diffRows', () => {
    it('pairs a replaced line so a one-word edit is a del+add with inline highlight', () => {
        const rows = diffRows('hello world\nkeep me', 'hello there\nkeep me')
        const del = rows.find((r) => r.kind === 'del')!
        const add = rows.find((r) => r.kind === 'add')!
        expect(del.segs.filter((s) => s.changed).map((s) => s.text)).toEqual(['world'])
        expect(add.segs.filter((s) => s.changed).map((s) => s.text)).toEqual(['there'])
        // the unchanged line round-trips as a 'same' row
        expect(rows.some((r) => r.kind === 'same' && r.segs.map((s) => s.text).join('') === 'keep me')).toBe(true)
    })

    it('flags a pure added line whole (no counterpart to pair with)', () => {
        const rows = diffRows('one', 'one\ntwo')
        const add = rows.find((r) => r.kind === 'add' && r.segs.map((s) => s.text).join('') === 'two')!
        expect(add.segs.every((s) => s.changed)).toBe(true)
    })
})
