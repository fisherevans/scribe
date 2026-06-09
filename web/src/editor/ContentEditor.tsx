import { useEditor, EditorContent } from '@tiptap/react'
import { useEffect, useMemo, useRef } from 'react'
import { BubbleToolbar } from './BubbleToolbar'
import { editorExtensions } from './extensions'
import { createMarkdownParser, serializeMarkdown } from './markdown'
import { hasStaged } from './imageUpload'
import type { MarkdownParser } from 'prosemirror-markdown'

const countWords = (text: string) => (text.trim() ? text.trim().split(/\s+/).length : 0)

interface Props {
    docKey: string // identity of the document being edited; a change reloads content
    body: string // markdown
    editable: boolean
    onBody: (markdown: string) => void
    onWords?: (n: number) => void
    className?: string
    autoFocus?: boolean // grab focus when (re)enabled; off for always-on form editors
}

// The TipTap markdown surface, decoupled from any page chrome. Both the post
// editor and the tag page-content editor compose this.
export function ContentEditor({ docKey, body, editable, onBody, onWords, className, autoFocus = true }: Props) {
    const loadedKey = useRef<string | null>(null)
    const bodyRef = useRef(body)
    bodyRef.current = body
    const keyRef = useRef(docKey)
    keyRef.current = docKey
    const wordsRef = useRef(onWords)
    wordsRef.current = onWords

    const editor = useEditor({
        extensions: editorExtensions(),
        content: '',
        autofocus: false,
        editable,
        editorProps: { attributes: { class: 'prose', spellcheck: 'true' } },
        // Load initial content once the view is attached - avoids a race where
        // setContent runs before the editor DOM exists (empty on deep-link).
        onCreate: ({ editor }) => {
            const parser = createMarkdownParser(editor.schema)
            editor.commands.setContent(parser.parse(bodyRef.current || '').toJSON(), false)
            loadedKey.current = keyRef.current
            wordsRef.current?.(countWords(editor.state.doc.textContent))
            if (autoFocus && !bodyRef.current) editor.commands.focus('end')
        },
        // Markdown is the source of truth; serialize the doc on every change.
        // Hold off while an image is staged - serializing now would autosave a
        // half-finished `![]()`. The upload's completion fires another update.
        onUpdate: ({ editor }) => {
            if (!hasStaged(editor)) onBody(serializeMarkdown(editor.state.doc))
            wordsRef.current?.(countWords(editor.state.doc.textContent))
        },
    })

    const parser = useMemo<MarkdownParser | null>(
        () => (editor ? createMarkdownParser(editor.schema) : null),
        [editor],
    )

    // Toggle read-only/editable; focus the body when entering edit mode.
    // emitUpdate=false is critical: setEditable's default emit would fire
    // onUpdate and autosave (silently rewriting the file just by opening edit).
    useEffect(() => {
        if (!editor) return
        editor.setEditable(editable, false)
        if (editable && autoFocus) editor.commands.focus()
    }, [editor, editable, autoFocus])

    // Reload when switching to a different document (onCreate handles the first).
    useEffect(() => {
        if (!editor || !parser || loadedKey.current === docKey) return
        editor.commands.setContent(parser.parse(body || '').toJSON(), false)
        loadedKey.current = docKey
        wordsRef.current?.(countWords(editor.state.doc.textContent))
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [docKey, editor, parser, body])

    // Dev-only: round-trip harness for fidelity measurement.
    useEffect(() => {
        if (!import.meta.env.DEV || !editor || !parser) return
        ;(window as any).scribeRT = {
            roundtrip: (md: string) => serializeMarkdown(parser.parse(md || '')),
            load: (md: string) => editor.commands.setContent(parser.parse(md || '').toJSON(), false),
            getMarkdown: () => serializeMarkdown(editor.state.doc),
        }
    }, [editor, parser])

    return (
        <>
            {/* The `tiptap` class is load-bearing: the global drag handle only keeps
                itself visible while the mouse moves onto an element whose class is
                `tiptap` or `drag-handle`. Our editor DOM is classed `prose`, so
                without this the handle vanishes the instant the cursor leaves the
                text toward the gutter where the handle lives. */}
            <EditorContent editor={editor} className={(className ?? 'page__body') + ' tiptap'} />
            {editor && <BubbleToolbar editor={editor} />}
        </>
    )
}
