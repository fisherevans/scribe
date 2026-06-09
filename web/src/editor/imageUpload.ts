import { Extension } from '@tiptap/core'
import type { Editor } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'

// Image upload staging. Paste or drag an image file into the body and it lands
// as an `image` block in a *staged* state: the bytes are held client-side (keyed
// by a staging id on the node) while the node view shows a preview and lets you
// name it and pick a destination. Nothing hits the network until you confirm.
// See ImageBlock / UploadStager for the UI, and ContentEditor for the autosave
// guard that holds off saving while anything is staged.

const staged = new Map<string, File>()
let counter = 0

export function stageFile(file: File): string {
    const id = `stage-${counter++}`
    staged.set(id, file)
    return id
}

export function getStagedFile(id: string): File | undefined {
    return staged.get(id)
}

export function clearStagedFile(id: string) {
    staged.delete(id)
}

export const ImageUpload = Extension.create({
    name: 'imageUpload',

    addProseMirrorPlugins() {
        const editor = this.editor
        const ingest = (files: File[], at?: number): boolean => {
            const images = files.filter((f) => f.type.startsWith('image/'))
            if (!images.length) return false
            for (const file of images) {
                const id = stageFile(file)
                const chain = editor.chain().focus()
                if (at != null) chain.setTextSelection(at)
                chain.insertContent({ type: 'image', attrs: { src: '', alt: '', staging: id } }).run()
            }
            return true
        }

        return [
            new Plugin({
                props: {
                    handlePaste(_view, event) {
                        if (!editor.isEditable) return false
                        return ingest(Array.from(event.clipboardData?.files ?? []))
                    },
                    handleDrop(view, event) {
                        if (!editor.isEditable) return false
                        const files = Array.from((event as DragEvent).dataTransfer?.files ?? [])
                        if (!files.length) return false
                        const pos = view.posAtCoords({ left: (event as DragEvent).clientX, top: (event as DragEvent).clientY })?.pos
                        event.preventDefault()
                        return ingest(files, pos)
                    },
                },
            }),
        ]
    },
})

// hasStaged reports whether the doc still holds an un-uploaded image, so the
// editor can hold off autosaving a half-finished `![]()`.
export function hasStaged(editor: Editor): boolean {
    let found = false
    editor.state.doc.descendants((node) => {
        if (found) return false
        if ((node.type.name === 'image' || node.type.name === 'figure') && node.attrs.staging) found = true
        return !found
    })
    return found
}
