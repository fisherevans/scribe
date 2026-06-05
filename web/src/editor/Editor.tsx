import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import { useEffect, useMemo, useRef } from 'react'
import { RawHtml } from './RawHtmlNode'
import { Callout } from './CalloutNode'
import { Figure } from './FigureNode'
import { SlashCommand } from './SlashCommand'
import { createMarkdownParser, serializeMarkdown } from './markdown'
import type { MarkdownParser } from 'prosemirror-markdown'

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
            // Image is inline to match markdown semantics (a lone image is a
            // paragraph containing an inline image), which keeps block
            // separation correct on serialize.
            Image.configure({ inline: true }),
            Link.configure({ openOnClick: false, autolink: false }),
            RawHtml,
            Callout,
            Figure,
            SlashCommand,
        ],
        content: '',
        autofocus: false,
        editorProps: { attributes: { class: 'prose', spellcheck: 'true' } },
        // Markdown is the source of truth; serialize the doc on every change.
        onUpdate: ({ editor }) => onBody(serializeMarkdown(editor.state.doc)),
    })

    // Parser is bound to the editor's schema (built once the editor exists).
    const parser = useMemo<MarkdownParser | null>(
        () => (editor ? createMarkdownParser(editor.schema) : null),
        [editor],
    )

    // Load (parse markdown -> doc) when the selected post changes.
    useEffect(() => {
        if (!editor || !parser || loadedSlug.current === slug) return
        const doc = parser.parse(body || '')
        editor.commands.setContent(doc.toJSON(), false)
        loadedSlug.current = slug
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
