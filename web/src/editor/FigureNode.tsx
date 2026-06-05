import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'

// Figure: image + caption, serializing to a clean <figure><img><figcaption>.
// Upload is a later phase; for now the source is a URL (the blog references
// media.fisher.sh CDN paths, which paste straight in).
declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        figure: { insertFigure: () => ReturnType }
    }
}

export const Figure = Node.create({
    name: 'figure',
    group: 'block',
    atom: true,
    draggable: true,

    addAttributes() {
        return {
            src: { default: '' },
            alt: { default: '' },
            caption: { default: '' },
        }
    },

    parseHTML() {
        return [
            {
                tag: 'figure[data-figure]',
                getAttrs: (el) => {
                    const node = el as HTMLElement
                    const img = node.querySelector('img')
                    const cap = node.querySelector('figcaption')
                    return {
                        src: img?.getAttribute('src') ?? '',
                        alt: img?.getAttribute('alt') ?? '',
                        caption: cap?.textContent ?? '',
                    }
                },
            },
        ]
    },

    renderHTML({ HTMLAttributes }) {
        const { src, alt, caption } = HTMLAttributes as { src: string; alt: string; caption: string }
        return [
            'figure',
            mergeAttributes({ 'data-figure': 'true' }),
            ['img', { src, alt }],
            ['figcaption', {}, caption ?? ''],
        ]
    },

    addNodeView() {
        return ReactNodeViewRenderer(FigureView)
    },

    addCommands() {
        return {
            insertFigure:
                () =>
                ({ commands }) =>
                    commands.insertContent({ type: this.name, attrs: { src: '', alt: '', caption: '' } }),
        }
    },
})

function FigureView({ node, updateAttributes, editor }: NodeViewProps) {
    const { src, alt, caption } = node.attrs as { src: string; alt: string; caption: string }
    const editable = editor.isEditable
    return (
        <NodeViewWrapper className="figure" data-empty={src ? undefined : 'true'}>
            {src ? (
                <img className="figure__img" src={src} alt={alt} />
            ) : (
                <div className="figure__drop" contentEditable={false}>
                    <span className="figure__dropglyph">🖼</span>
                    <input
                        className="figure__url"
                        placeholder="paste an image URL (media.fisher.sh/…)"
                        disabled={!editable}
                        onChange={(e) => updateAttributes({ src: e.target.value })}
                    />
                </div>
            )}
            <div className="figure__captionrow" contentEditable={false}>
                <input
                    className="figure__caption"
                    value={caption}
                    placeholder="Add a caption"
                    disabled={!editable}
                    onChange={(e) => updateAttributes({ caption: e.target.value })}
                />
                {src && editable && (
                    <button className="figure__change" type="button" onClick={() => updateAttributes({ src: '' })}>
                        change
                    </button>
                )}
            </div>
        </NodeViewWrapper>
    )
}
