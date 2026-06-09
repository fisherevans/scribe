import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'
import { useEffect, useState } from 'react'
import { ImageEditModal } from './ImageEditModal'
import { clearStagedFile, getStagedFile } from './imageUpload'

// Block image, named `image` so the markdown pipeline maps cleanly. One node
// covers both a plain image and a captioned figure - the caption is the only
// difference (present -> <figure>, absent -> bare <img>). A real block atom, so
// the cursor sits before/after it and backspace selects rather than eating it.
// Editing happens in a modal (see ImageEditModal), not inline: clicking the
// block opens the structured editor; leaving edit mode just shows the render.
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
            caption: { default: '' },
            title: { default: null },
            // Staging id for a pending paste/drop upload; never serialized (the
            // autosave guard skips a doc that still has one). Cleared once a real
            // src lands.
            staging: { default: null, rendered: false },
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
                    commands.insertContent({ type: this.name, attrs: { src: '', alt: '', caption: '' } }),
        }
    },
})

function ImageBlockView({ node, updateAttributes, deleteNode, editor }: NodeViewProps) {
    const { src, alt, caption, staging } = node.attrs as { src: string; alt: string; caption: string; staging: string | null }
    const stagedFile = staging ? getStagedFile(staging) : undefined
    const editable = editor.isEditable
    // Open the modal on insert when there's nothing placed yet (fresh slash
    // command or a pasted file waiting to upload); otherwise on click.
    const [open, setOpen] = useState(() => editable && (!src || Boolean(stagedFile)))

    // A staging marker whose file is gone (e.g. after reload) is dead weight.
    useEffect(() => {
        if (staging && !stagedFile) updateAttributes({ staging: null })
    }, [staging, stagedFile, updateAttributes])

    // Leaving edit mode closes the editor - no lingering forms.
    useEffect(() => {
        if (!editable) setOpen(false)
    }, [editable])

    const apply = (draft: { src: string; alt: string; caption: string }) => {
        if (staging) clearStagedFile(staging)
        updateAttributes({ ...draft, staging: null })
        setOpen(false)
    }
    const cancel = () => {
        if (staging) clearStagedFile(staging)
        // A never-placed image (cancelled on first insert) shouldn't leave an
        // empty block behind.
        if (!src) deleteNode()
        else updateAttributes({ staging: null })
        setOpen(false)
    }

    const openEditor = () => setOpen(true)

    return (
        <NodeViewWrapper className={'imageblock' + (caption ? ' imageblock--figure' : '')} data-empty={src ? undefined : 'true'}>
            {src ? (
                caption ? (
                    <figure className="figure" onClick={editable ? openEditor : undefined}>
                        <img className="figure__img" src={src} alt={alt} />
                        <figcaption className="figure__cap">{caption}</figcaption>
                    </figure>
                ) : (
                    <img className="imageblock__img" src={src} alt={alt} onClick={editable ? openEditor : undefined} />
                )
            ) : (
                <div className="imageblock__placeholder" contentEditable={false} onClick={editable ? openEditor : undefined}>
                    <span>🖼 click to add an image</span>
                </div>
            )}

            {editable && (
                <div className="blocktools" contentEditable={false}>
                    <button type="button" onClick={openEditor} title="edit">✎</button>
                    <button type="button" onClick={() => deleteNode()} title="delete">✕</button>
                </div>
            )}

            {open && editable && (
                <ImageEditModal initial={{ src, alt, caption }} stagedFile={stagedFile} onApply={apply} onCancel={cancel} />
            )}
        </NodeViewWrapper>
    )
}
