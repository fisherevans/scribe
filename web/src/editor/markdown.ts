import MarkdownIt from 'markdown-it'
import { MarkdownParser, MarkdownSerializer } from 'prosemirror-markdown'
import type { Node as PMNode, Schema } from '@tiptap/pm/model'

// Custom markdown <-> ProseMirror pipeline over the TipTap schema. Replaces
// tiptap-markdown, whose html:true path dropped arbitrary raw HTML and merged
// blocks. Here block-level raw HTML (markdown-it `html_block`) maps to the
// opaque RawHtml node and serializes back verbatim, and node serializers
// control block separation explicitly.
//
// Inline raw HTML parsing is disabled so stray `<...>` round-trips as literal
// text rather than being dropped; multi-line tags still parse as block html.

function newMarkdownIt(): MarkdownIt {
    const md = new MarkdownIt({ html: true, linkify: false, typographer: false })
    md.inline.ruler.disable('html_inline')
    // Lift a paragraph that is just an image into a standalone block image, so
    // images are real block nodes (better cursor/backspace behavior) rather
    // than an inline image trapped at the end of a paragraph.
    md.core.ruler.after('inline', 'lone_image_block', (state) => {
        const toks = state.tokens
        for (let i = toks.length - 1; i >= 2; i--) {
            if (toks[i].type !== 'paragraph_close' || toks[i - 1].type !== 'inline' || toks[i - 2].type !== 'paragraph_open') continue
            const kids = toks[i - 1].children || []
            const images = kids.filter((k) => k.type === 'image')
            const onlyImage =
                images.length === 1 &&
                kids.every((k) => k.type === 'image' || k.type === 'softbreak' || (k.type === 'text' && !k.content.trim()))
            if (!onlyImage) continue
            const t = new state.Token('image_block', '', 0)
            t.attrs = images[0].attrs
            t.children = images[0].children
            toks.splice(i - 2, 3, t)
            i -= 2
        }
        return true
    })
    // Map our emitted figure HTML (<figure data-figure>…) back into the image
    // node, carrying its caption, rather than letting it fall through to an
    // opaque rawHtml block. A captioned image and a plain image are one node;
    // the caption is the only difference. Tolerant of attribute order; anything
    // that doesn't match stays raw HTML.
    md.core.ruler.after('inline', 'figure_block', (state) => {
        for (const tok of state.tokens) {
            if (tok.type !== 'html_block' || !/data-figure/.test(tok.content)) continue
            const src = tok.content.match(/<img[^>]*\ssrc="([^"]*)"/i)
            if (!src) continue
            const alt = tok.content.match(/<img[^>]*\salt="([^"]*)"/i)
            const cap = tok.content.match(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i)
            tok.type = 'image_block'
            tok.attrs = [
                ['src', src[1]],
                ['alt', alt ? alt[1] : ''],
                ['caption', cap ? cap[1].trim() : ''],
            ]
        }
        return true
    })
    // Normalize GFM table tokens for the TipTap table schema: drop thead/tbody
    // wrappers (rows become direct children of the table) and wrap each cell's
    // inline content in a paragraph (cells hold block content).
    md.core.ruler.after('inline', 'table_normalize', (state) => {
        const src = state.tokens
        const out: typeof src = []
        for (let i = 0; i < src.length; i++) {
            const t = src[i]
            if (t.type === 'thead_open' || t.type === 'thead_close' || t.type === 'tbody_open' || t.type === 'tbody_close') continue
            out.push(t)
            if ((t.type === 'th_open' || t.type === 'td_open') && src[i + 1]?.type === 'inline') {
                out.push(new state.Token('paragraph_open', 'p', 1), src[i + 1], new state.Token('paragraph_close', 'p', -1))
                i++
            }
        }
        state.tokens = out
        return true
    })
    return md
}

// markdown-it token type -> TipTap node/mark. Names are TipTap's (camelCase).
const tokenSpec = {
    blockquote: { block: 'blockquote' },
    paragraph: { block: 'paragraph' },
    list_item: { block: 'listItem' },
    bullet_list: { block: 'bulletList' },
    ordered_list: {
        block: 'orderedList',
        getAttrs: (tok: any) => ({ start: +(tok.attrGet('start') || 1) }),
    },
    heading: { block: 'heading', getAttrs: (tok: any) => ({ level: +tok.tag.slice(1) }) },
    code_block: { block: 'codeBlock', noCloseToken: true },
    fence: {
        block: 'codeBlock',
        getAttrs: (tok: any) => ({ language: tok.info.trim() || null }),
        noCloseToken: true,
    },
    hr: { node: 'horizontalRule' },
    // Block image (produced by the lone_image_block core rule). No inline image
    // mapping: every image in the corpus is on its own line.
    image_block: {
        node: 'image',
        getAttrs: (tok: any) => ({
            src: tok.attrGet('src'),
            title: tok.attrGet('title') || null,
            // A markdown image keeps its alt in the inline child text (the attr
            // is ''); the figure rule sets it as an attr instead. Prefer the
            // child, fall back to the attr. caption is figure-only.
            alt: (tok.children && tok.children[0] && tok.children[0].content) || tok.attrGet('alt') || '',
            caption: tok.attrGet('caption') || '',
        }),
    },
    hardbreak: { node: 'hardBreak' },
    table: { block: 'table' },
    tr: { block: 'tableRow' },
    th: { block: 'tableHeader' },
    td: { block: 'tableCell' },
    // Block-level raw HTML preserved verbatim (trailing newline trimmed; the
    // serializer re-adds block separation).
    html_block: { node: 'rawHtml', getAttrs: (tok: any) => ({ html: String(tok.content).replace(/\n+$/, '') }) },
    em: { mark: 'italic' },
    strong: { mark: 'bold' },
    s: { mark: 'strike' },
    link: {
        mark: 'link',
        getAttrs: (tok: any) => ({ href: tok.attrGet('href'), title: tok.attrGet('title') || null }),
    },
    code_inline: { mark: 'code', noCloseToken: true },
}

export function createMarkdownParser(schema: Schema): MarkdownParser {
    // Only register tokens whose node/mark exists in this schema, so a missing
    // extension is a clear gap rather than a parser construction error.
    const spec: Record<string, any> = {}
    for (const [tok, def] of Object.entries(tokenSpec)) {
        const name = (def as any).block || (def as any).node || (def as any).mark
        if (schema.nodes[name] || schema.marks[name]) spec[tok] = def
    }
    return new MarkdownParser(schema, newMarkdownIt(), spec)
}

const serializer = new MarkdownSerializer(
    {
        blockquote(state, node) {
            state.wrapBlock('> ', null, node, () => state.renderContent(node))
        },
        paragraph(state, node) {
            state.renderInline(node)
            state.closeBlock(node)
        },
        heading(state, node) {
            state.write('#'.repeat(node.attrs.level) + ' ')
            state.renderInline(node)
            state.closeBlock(node)
        },
        codeBlock(state, node) {
            state.write('```' + (node.attrs.language || '') + '\n')
            state.text(node.textContent, false)
            state.ensureNewLine()
            state.write('```')
            state.closeBlock(node)
        },
        horizontalRule(state, node) {
            state.write('---')
            state.closeBlock(node)
        },
        bulletList(state, node) {
            state.renderList(node, '  ', () => '- ')
        },
        orderedList(state, node) {
            const start = node.attrs.start || 1
            const maxW = String(start + node.childCount - 1).length
            const space = state.repeat(' ', maxW + 2)
            state.renderList(node, space, (i) => {
                const n = String(start + i)
                return state.repeat(' ', maxW - n.length) + n + '. '
            })
        },
        listItem(state, node) {
            state.renderContent(node)
        },
        // One image node, two renderings: with a caption it serializes to the
        // figure HTML block (caption == subtitle); without, to a plain markdown
        // image. Round-trips with the figure_block parse rule above.
        image(state, node) {
            const { src, alt, caption, title } = node.attrs
            if (caption) {
                state.write(
                    `<figure data-figure="true"><img src="${src}" alt="${alt || ''}"><figcaption>${caption}</figcaption></figure>`,
                )
                state.closeBlock(node)
                return
            }
            const t = title ? ' "' + String(title).replace(/"/g, '\\"') + '"' : ''
            state.write('![' + state.esc(alt || '') + '](' + src + t + ')')
            state.closeBlock(node) // block image
        },
        hardBreak(state, node, parent, index) {
            for (let i = index + 1; i < parent.childCount; i++) {
                if (parent.child(i).type !== node.type) {
                    state.write('\\\n')
                    return
                }
            }
        },
        text(state, node) {
            state.text(node.text || '')
        },
        // GFM table. Rows/cells are rendered here, so they need no own
        // serializers (the walker never visits them).
        table(state, node) {
            const rows: string[][] = []
            node.forEach((row) => {
                const cells: string[] = []
                row.forEach((cell) => cells.push(cellToMarkdown(cell)))
                rows.push(cells)
            })
            if (rows.length === 0) {
                state.closeBlock(node)
                return
            }
            const cols = Math.max(...rows.map((r) => r.length))
            const line = (cells: string[]) => '| ' + Array.from({ length: cols }, (_, i) => cells[i] || ' ').join(' | ') + ' |'
            state.write(line(rows[0]) + '\n')
            state.write('| ' + Array(cols).fill('---').join(' | ') + ' |\n')
            for (let i = 1; i < rows.length; i++) {
                state.write(line(rows[i]))
                if (i < rows.length - 1) state.write('\n')
            }
            state.closeBlock(node)
        },
        // Opaque: written exactly as held.
        rawHtml(state, node) {
            state.write(node.attrs.html || '')
            state.closeBlock(node)
        },
        // Structured custom content -> known HTML blocks.
        callout(state, node) {
            state.write(`<div data-callout="true" data-tone="${node.attrs.tone}">\n\n`)
            state.renderContent(node)
            state.write('</div>')
            state.closeBlock(node)
        },
    },
    {
        bold: { open: '**', close: '**', mixable: true, expelEnclosingWhitespace: true },
        italic: { open: '*', close: '*', mixable: true, expelEnclosingWhitespace: true },
        strike: { open: '~~', close: '~~', mixable: true, expelEnclosingWhitespace: true },
        code: { open: '`', close: '`', escape: false },
        link: {
            open: () => '[',
            close(_state, mark) {
                const title = mark.attrs.title ? ' "' + String(mark.attrs.title).replace(/"/g, '\\"') + '"' : ''
                return '](' + mark.attrs.href + title + ')'
            },
        },
    },
)

// Render a table cell's inline content to a single line of markdown (common
// marks only; pipes escaped). Cells are simple by design.
function cellToMarkdown(cell: PMNode): string {
    let out = ''
    cell.descendants((n) => {
        if (!n.isText) return true
        let text = n.text || ''
        const has = (name: string) => n.marks.some((m) => m.type.name === name)
        if (has('code')) text = '`' + text + '`'
        if (has('bold')) text = '**' + text + '**'
        if (has('italic')) text = '*' + text + '*'
        const link = n.marks.find((m) => m.type.name === 'link')
        if (link) text = '[' + text + '](' + link.attrs.href + ')'
        out += text
        return false
    })
    return out.replace(/\|/g, '\\|').replace(/\n/g, ' ').trim()
}

export function serializeMarkdown(doc: PMNode): string {
    return serializer.serialize(doc, { tightLists: true })
}
