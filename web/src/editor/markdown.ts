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
    image: {
        node: 'image',
        getAttrs: (tok: any) => ({
            src: tok.attrGet('src'),
            title: tok.attrGet('title') || null,
            alt: (tok.children && tok.children[0] && tok.children[0].content) || null,
        }),
    },
    hardbreak: { node: 'hardBreak' },
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
        image(state, node) {
            const title = node.attrs.title ? ' "' + String(node.attrs.title).replace(/"/g, '\\"') + '"' : ''
            state.write('![' + state.esc(node.attrs.alt || '') + '](' + node.attrs.src + title + ')')
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
        figure(state, node) {
            const { src, alt, caption } = node.attrs
            state.write(
                `<figure data-figure="true"><img src="${src}" alt="${alt}"><figcaption>${caption}</figcaption></figure>`,
            )
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

export function serializeMarkdown(doc: PMNode): string {
    return serializer.serialize(doc, { tightLists: true })
}
