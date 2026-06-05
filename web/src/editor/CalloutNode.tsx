import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, NodeViewContent, ReactNodeViewRenderer } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'

// Callout is *structured* custom content (contrast with RawHtml, which is
// opaque). It has a tone and real editable prose inside, and serializes to a
// known shape (div[data-callout][data-tone]) that the blog can style. This is
// the kind of block a "plugin/template" produces.
declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        callout: { insertCallout: (tone?: Tone) => ReturnType }
    }
}

type Tone = 'info' | 'idea' | 'warn'
const TONES: { tone: Tone; glyph: string; label: string }[] = [
    { tone: 'info', glyph: 'i', label: 'note' },
    { tone: 'idea', glyph: '✷', label: 'idea' },
    { tone: 'warn', glyph: '!', label: 'heads-up' },
]

export const Callout = Node.create({
    name: 'callout',
    group: 'block',
    content: 'block+',
    defining: true,

    addAttributes() {
        return {
            tone: {
                default: 'info',
                parseHTML: (el) => (el as HTMLElement).getAttribute('data-tone') ?? 'info',
                renderHTML: (attrs) => ({ 'data-tone': attrs.tone }),
            },
        }
    },

    parseHTML() {
        return [{ tag: 'div[data-callout]' }]
    },

    renderHTML({ HTMLAttributes }) {
        return ['div', mergeAttributes({ 'data-callout': 'true' }, HTMLAttributes), 0]
    },

    addNodeView() {
        return ReactNodeViewRenderer(CalloutView)
    },

    // tiptap-markdown: emit the callout wrapper with its inner content rendered
    // as markdown between blank lines (so block content parses back correctly).
    addStorage() {
        return {
            markdown: {
                serialize(state: any, node: any) {
                    state.write(`<div data-callout="true" data-tone="${node.attrs.tone}">\n\n`)
                    state.renderContent(node)
                    state.write('</div>')
                    state.closeBlock(node)
                },
                parse: {},
            },
        }
    },

    addCommands() {
        return {
            insertCallout:
                (tone: Tone = 'info') =>
                ({ commands }) =>
                    commands.insertContent({
                        type: this.name,
                        attrs: { tone },
                        content: [{ type: 'paragraph' }],
                    }),
        }
    },
})

function CalloutView({ node, updateAttributes, deleteNode, editor }: NodeViewProps) {
    const tone: Tone = node.attrs.tone ?? 'info'
    const current = TONES.find((t) => t.tone === tone) ?? TONES[0]
    return (
        <NodeViewWrapper className="callout" data-tone={tone}>
            <div className="callout__rail" contentEditable={false}>
                <span className="callout__glyph">{current.glyph}</span>
                {editor.isEditable && (
                    <div className="callout__tones">
                        {TONES.map((t) => (
                            <button
                                key={t.tone}
                                type="button"
                                className={'callout__tone' + (t.tone === tone ? ' is-active' : '')}
                                title={t.label}
                                onClick={() => updateAttributes({ tone: t.tone })}
                            >
                                {t.glyph}
                            </button>
                        ))}
                        <button className="callout__tone callout__del" type="button" title="delete" onClick={() => deleteNode()}>
                            ✕
                        </button>
                    </div>
                )}
            </div>
            <NodeViewContent className="callout__body" />
        </NodeViewWrapper>
    )
}
