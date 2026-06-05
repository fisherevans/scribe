import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Link from '@tiptap/extension-link'
import Table from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableHeader from '@tiptap/extension-table-header'
import TableCell from '@tiptap/extension-table-cell'
import { ImageBlock } from './ImageBlock'
import { useEffect, useMemo, useRef, useState } from 'react'
import { RawHtml } from './RawHtmlNode'
import { Callout } from './CalloutNode'
import { Figure } from './FigureNode'
import { CodeBlock } from './CodeBlock'
import { SlashCommand } from './SlashCommand'
import { BubbleToolbar, LinkShortcut } from './BubbleToolbar'
import GlobalDragHandle from 'tiptap-extension-global-drag-handle'
import { createMarkdownParser, serializeMarkdown } from './markdown'
import type { MarkdownParser } from 'prosemirror-markdown'

const countWords = (text: string) => (text.trim() ? text.trim().split(/\s+/).length : 0)

interface Props {
    slug: string
    title: string
    body: string // markdown
    editable: boolean
    onEditTitle: () => void
    onBody: (markdown: string) => void
}

export function Editor({ slug, title, body, editable, onEditTitle, onBody }: Props) {
    const loadedSlug = useRef<string | null>(null)
    const [words, setWords] = useState(0)
    // Latest props for onCreate (which captures its closure once).
    const bodyRef = useRef(body)
    bodyRef.current = body
    const slugRef = useRef(slug)
    slugRef.current = slug

    const editor = useEditor({
        extensions: [
            StarterKit.configure({ heading: { levels: [2, 3, 4] }, codeBlock: false }),
            CodeBlock,
            Placeholder.configure({
                // Only the top-level paragraph/heading get a placeholder; without
                // this, includeChildren painted it inside empty callouts and code
                // blocks too.
                includeChildren: false,
                placeholder: ({ node }) => {
                    if (node.type.name === 'heading') return 'Section title'
                    if (node.type.name === 'paragraph') return "Write. Press '/' for blocks."
                    return ''
                },
            }),
            ImageBlock,
            Link.configure({ openOnClick: false, autolink: false }),
            RawHtml,
            Callout,
            Figure,
            Table.configure({ resizable: false }),
            TableRow,
            TableHeader,
            TableCell,
            SlashCommand,
            LinkShortcut,
            GlobalDragHandle.configure({ dragHandleWidth: 22, scrollTreshold: 100 }),
        ],
        content: '',
        autofocus: false,
        editable,
        editorProps: { attributes: { class: 'prose', spellcheck: 'true' } },
        // Load initial content once the view is attached - avoids a race where
        // setContent runs before the editor DOM exists (empty on deep-link).
        onCreate: ({ editor }) => {
            const parser = createMarkdownParser(editor.schema)
            editor.commands.setContent(parser.parse(bodyRef.current || '').toJSON(), false)
            loadedSlug.current = slugRef.current
            setWords(countWords(editor.state.doc.textContent))
            // New post: drop the cursor straight into the body.
            if (!bodyRef.current) editor.commands.focus('end')
        },
        // Markdown is the source of truth; serialize the doc on every change.
        onUpdate: ({ editor }) => {
            onBody(serializeMarkdown(editor.state.doc))
            setWords(countWords(editor.state.doc.textContent))
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
        if (editable) editor.commands.focus()
    }, [editor, editable])

    // Reload when switching to a different post (onCreate handles the first).
    useEffect(() => {
        if (!editor || !parser || loadedSlug.current === slug) return
        editor.commands.setContent(parser.parse(body || '').toJSON(), false)
        loadedSlug.current = slug
        setWords(countWords(editor.state.doc.textContent))
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [slug, editor, parser, body])

    // Dev-only: expose a round-trip harness so fidelity can be measured.
    useEffect(() => {
        if (!import.meta.env.DEV || !editor || !parser) return
        ;(window as any).scribeRT = {
            roundtrip: (md: string) => serializeMarkdown(parser.parse(md || '')),
            load: (md: string) => editor.commands.setContent(parser.parse(md || '').toJSON(), false),
            getMarkdown: () => serializeMarkdown(editor.state.doc),
        }
    }, [editor, parser])

    return (
        <article className="page">
            <header className="page__head">
                <h1 className={'page__title-display' + (title ? '' : ' is-empty')}>{title || 'Untitled'}</h1>
                {editable && (
                    <button className="page__edit" type="button" onClick={onEditTitle} title="edit title & slug">
                        ✎ title
                    </button>
                )}
            </header>
            <EditorContent editor={editor} className="page__body" />
            <footer className="page__meta">
                {words} {words === 1 ? 'word' : 'words'} · {Math.max(1, Math.round(words / 220))} min read
            </footer>
            {editor && <BubbleToolbar editor={editor} />}
        </article>
    )
}
