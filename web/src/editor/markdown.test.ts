import { describe, it, expect } from 'vitest'
import { getSchema } from '@tiptap/core'
import { editorExtensions } from './extensions'
import { createMarkdownParser, serializeMarkdown } from './markdown'

// Build the real editor schema and round-trip markdown through it. This locks
// in the parser/serializer fidelity that the editor depends on.
const schema = getSchema(editorExtensions())
const parser = createMarkdownParser(schema)
const rt = (md: string) => serializeMarkdown(parser.parse(md)).trim()

describe('markdown round-trip', () => {
    it('inline marks and a link', () => {
        const md = 'A **bold** and *italic* and `code` and a [link](https://example.com).'
        expect(rt(md)).toBe(md)
    })

    it('headings (h2-h4)', () => {
        expect(rt('## Section')).toBe('## Section')
        expect(rt('### Sub')).toBe('### Sub')
    })

    it('bullet and ordered lists', () => {
        expect(rt('- one\n- two')).toBe('- one\n- two')
        expect(rt('1. one\n2. two')).toBe('1. one\n2. two')
    })

    it('blockquote', () => {
        expect(rt('> a quote')).toBe('> a quote')
    })

    it('fenced code with language', () => {
        const md = '```js\nconst x = 1\n```'
        expect(rt(md)).toBe(md)
    })

    it('preserves raw HTML verbatim (the non-lossy guarantee)', () => {
        const md = '<iframe src="https://example.com" allowfullscreen></iframe>'
        expect(rt(md)).toBe(md)
    })

    it('block image', () => {
        const md = '![alt text](https://example.com/a.png)'
        expect(rt(md)).toBe(md)
    })

    it('GFM table', () => {
        const md = '| Name | Role |\n| --- | --- |\n| Ada | eng |'
        expect(rt(md)).toBe(md)
    })

    it('a mixed document keeps all its content', () => {
        const md = [
            'Intro with a [link](https://example.com).',
            '',
            '## Heading',
            '',
            '![diagram](https://example.com/d.svg)',
            '',
            '<iframe src="https://example.com/embed"></iframe>',
            '',
            '| a | b |',
            '| --- | --- |',
            '| 1 | 2 |',
        ].join('\n')
        expect(rt(md)).toBe(md)
    })

    it('is idempotent (a second pass changes nothing)', () => {
        const md = 'A **bold** [link](https://x.com).\n\n![img](https://x.com/a.png)\n\n| a | b |\n| --- | --- |\n| 1 | 2 |'
        const once = rt(md)
        expect(rt(once)).toBe(once)
    })
})
