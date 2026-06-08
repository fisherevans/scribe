import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'
import { useState } from 'react'

// Block image (named `image` so the markdown pipeline maps cleanly). A real
// block node, so the cursor sits before/after it and backspace selects rather
// than silently eating the picture. Hover controls let you edit the URL/alt or
// delete it after insertion.
declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        imageBlock: { insertImage: () => ReturnType }
    }
}

export const ImageBlock = Node.create({
    name: 'image',
    group: 'block',
    atom: true,
    draggable: true,
    selectable: true,

    addAttributes() {
        return {
            src: { default: '' },
            alt: { default: '' },
            title: { default: null },
        }
    },

    parseHTML() {
        return [{ tag: 'img[src]' }]
    },

    renderHTML({ HTMLAttributes }) {
        return ['img', mergeAttributes(HTMLAttributes)]
    },

    addNodeView() {
        return ReactNodeViewRenderer(ImageBlockView)
    },

    addCommands() {
        return {
            insertImage:
                () =>
                ({ commands }) =>
                    commands.insertContent({ type: this.name, attrs: { src: '', alt: '' } }),
        }
    },
})

function ImageBlockView({ node, updateAttributes, deleteNode, editor }: NodeViewProps) {
    const { src, alt } = node.attrs as { src: string; alt: string }
    const [editing, setEditing] = useState(!src)
    const editable = editor.isEditable

    return (
        <NodeViewWrapper className="imageblock" data-empty={src ? undefined : 'true'}>
            {src ? (
                <img className="imageblock__img" src={src} alt={alt} />
            ) : (
                <div className="imageblock__placeholder" contentEditable={false}>
                    <span>🖼 no image - paste a URL below</span>
                </div>
            )}

            {editable && (
                <div className="blocktools" contentEditable={false}>
                    <button type="button" onClick={() => setEditing((e) => !e)} title="edit">
                        ✎
                    </button>
                    <button type="button" onClick={() => deleteNode()} title="delete">
                        ✕
                    </button>
                </div>
            )}

            {editing && editable && (
                <div className="imageblock__edit" contentEditable={false}>
                    <input
                        className="blockinput"
                        placeholder="image URL (media.fisher.sh/… or /posts/<slug>/…)"
                        value={src}
                        spellCheck={false}
                        onChange={(e) => updateAttributes({ src: e.target.value })}
                    />
                    <input
                        className="blockinput"
                        placeholder="alt text"
                        value={alt}
                        onChange={(e) => updateAttributes({ alt: e.target.value })}
                    />
                </div>
            )}
        </NodeViewWrapper>
    )
}
