import { describe, expect, it } from 'vitest'
import { noteSummary } from './collections'

// A note has no title, so every surface that would show one - the feed row, the
// browser tab - derives it from the body. The awkward cases are real: the blog's
// migration produced notes that are a single embed and no prose at all.
describe('noteSummary', () => {
    it('uses the first sentence of the body', () => {
        expect(noteSummary('Giving the Axiom Proxy a whirl. Threw it well.')).toBe(
            'Giving the Axiom Proxy a whirl. Threw it well.',
        )
    })

    it('falls back to an embed title when there is no prose', () => {
        const body = '<iframe src="https://www.youtube.com/embed/abc" title="LRK Adventure - Update #1"></iframe>'
        expect(noteSummary(body)).toBe('LRK Adventure - Update #1')
    })

    it('ignores markup and link syntax', () => {
        expect(noteSummary('A **sprite editor** I built. [Source](https://example.com)')).toBe(
            'A sprite editor I built. Source',
        )
    })

    it('truncates on a word boundary', () => {
        const out = noteSummary('one two three four five six seven eight nine ten eleven twelve', 20)
        expect(out.endsWith('…')).toBe(true)
        expect(out.length).toBeLessThanOrEqual(21)
        expect(out).not.toMatch(/\s…$/)
    })

    it('is empty for an empty body', () => {
        expect(noteSummary('')).toBe('')
    })
})
