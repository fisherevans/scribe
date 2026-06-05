import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import { Markdown } from 'tiptap-markdown'
import { useEffect, useRef } from 'react'
import { RawHtml } from './RawHtmlNode'
import { Callout } from './CalloutNode'
import { Figure } from './FigureNode'
import { SlashCommand } from './SlashCommand'

interface Props {
    slug: string
    title: string
    body: string // markdown
    onTitle: (t: string) => void
    onBody: (markdown: string) => void
}

export function Editor({ slug, title, body, onTitle, onBody }: Props) {
    const titleRef = useRef<HTMLTextAreaElement>(null)
    const loadedSlug = useRef<string | null>(null)

    const editor = useEditor({
        extensions: [
            StarterKit.configure({ heading: { levels: [2, 3, 4] } }),
            Placeholder.configure({
                placeholder: ({ node }) =>
                    node.type.name === 'heading' ? 'Section title' : "Write. Press '/' for blocks.",
                includeChildren: true,
            }),
            Image,
            Link.configure({ openOnClick: false, autolink: false }),
            RawHtml,
            Callout,
            Figure,
            SlashCommand,
            // Markdown is the source of truth: content loads from markdown and
            // getMarkdown() serializes the doc back. html:true preserves raw HTML
            // blocks (routed to the opaque RawHtml node via its parseHTML rule).
            Markdown.configure({ html: true, transformPastedText: true, breaks: false }),
        ],
        content: '',
        autofocus: false,
        editorProps: { attributes: { class: 'prose', spellcheck: 'true' } },
        onUpdate: ({ editor }) => onBody(editor.storage.markdown.getMarkdown()),
    })

    // Load (parse) the markdown body when the selected post changes.
    useEffect(() => {
        if (!editor || loadedSlug.current === slug) return
        editor.commands.setContent(body, false)
        loadedSlug.current = slug
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [slug, editor, body])

    // Dev-only: expose the editor so round-trip fidelity can be inspected.
    useEffect(() => {
        if (import.meta.env.DEV && editor) (window as unknown as { scribeEditor?: unknown }).scribeEditor = editor
    }, [editor])

    useEffect(() => {
        const el = titleRef.current
        if (!el) return
        el.style.height = 'auto'
        el.style.height = el.scrollHeight + 'px'
    }, [title])

    return (
        <article className="page">
            <textarea
                ref={titleRef}
                className="page__title"
                value={title}
                rows={1}
                placeholder="Untitled"
                spellCheck
                onChange={(e) => onTitle(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' || (e.key === 'ArrowDown' && e.currentTarget.selectionStart === title.length)) {
                        e.preventDefault()
                        editor?.commands.focus('start')
                    }
                }}
            />
            <EditorContent editor={editor} className="page__body" />
        </article>
    )
}
