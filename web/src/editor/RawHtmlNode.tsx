import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'
import { useState } from 'react'

// RawHtml is the opaque escape hatch. The editor treats the HTML as an inert
// string it never parses into rich nodes, so hand-written iframes / SVG /
// custom elements round-trip byte-for-byte. This is what makes editing the
// posts folder non-lossy. In markdown it serializes back as a raw HTML block
// (handled server-side); here it round-trips via the data-raw-html wrapper.
declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        rawHtml: {
            insertRawHtml: (html: string) => ReturnType
        }
    }
}

export const RawHtml = Node.create({
    name: 'rawHtml',
    group: 'block',
    atom: true,
    selectable: true,
    draggable: true,

    addAttributes() {
        return {
            html: {
                default: '',
                parseHTML: (el) => (el as HTMLElement).getAttribute('data-html') ?? (el as HTMLElement).innerHTML,
                renderHTML: (attrs) => ({ 'data-html': attrs.html }),
            },
        }
    },

    parseHTML() {
        return [{ tag: 'div[data-raw-html]' }]
    },

    renderHTML({ HTMLAttributes }) {
        return ['div', mergeAttributes({ 'data-raw-html': 'true' }, HTMLAttributes)]
    },

    addNodeView() {
        return ReactNodeViewRenderer(RawHtmlView)
    },

    addCommands() {
        return {
            insertRawHtml:
                (html: string) =>
                ({ commands }) =>
                    commands.insertContent({ type: this.name, attrs: { html } }),
        }
    },
})

function RawHtmlView({ node, updateAttributes, editor }: NodeViewProps) {
    const html: string = node.attrs.html ?? ''
    const [mode, setMode] = useState<'preview' | 'source'>(html.trim() ? 'preview' : 'source')
    const editable = editor.isEditable

    return (
        <NodeViewWrapper className="embed" data-mode={mode}>
            <div className="embed__bar" contentEditable={false}>
                <span className="embed__label">raw&nbsp;html</span>
                <div className="embed__toggle">
                    <button
                        className={mode === 'preview' ? 'is-active' : ''}
                        onClick={() => setMode('preview')}
                        type="button"
                    >
                        preview
                    </button>
                    <button
                        className={mode === 'source' ? 'is-active' : ''}
                        onClick={() => setMode('source')}
                        type="button"
                    >
                        source
                    </button>
                </div>
            </div>
            {mode === 'preview' ? (
                <div
                    className="embed__preview"
                    contentEditable={false}
                    // The whole point: rendered, never parsed into the document model.
                    dangerouslySetInnerHTML={{ __html: html || '<span class="embed__empty">empty embed</span>' }}
                />
            ) : (
                <textarea
                    className="embed__source"
                    value={html}
                    spellCheck={false}
                    disabled={!editable}
                    placeholder="<iframe …>  ·  <svg …>  ·  any raw HTML, preserved verbatim"
                    onChange={(e) => updateAttributes({ html: e.target.value })}
                />
            )}
        </NodeViewWrapper>
    )
}
