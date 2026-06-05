import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { useEffect, useRef } from 'react'
import { RawHtml } from './RawHtmlNode'
import { Callout } from './CalloutNode'
import { Figure } from './FigureNode'
import { SlashCommand } from './SlashCommand'

interface Props {
    slug: string
    title: string
    body: string
    onTitle: (t: string) => void
    onBody: (html: string) => void
}

export function Editor({ slug, title, body, onTitle, onBody }: Props) {
    const titleRef = useRef<HTMLTextAreaElement>(null)

    const editor = useEditor({
        extensions: [
            StarterKit.configure({
                heading: { levels: [2, 3, 4] }, // H1 is the title field
            }),
            Placeholder.configure({
                placeholder: ({ node }) =>
                    node.type.name === 'heading' ? 'Section title' : "Write. Press '/' for blocks.",
                includeChildren: true,
            }),
            RawHtml,
            Callout,
            Figure,
            SlashCommand,
        ],
        content: body,
        autofocus: false,
        editorProps: {
            attributes: { class: 'prose', spellcheck: 'true' },
        },
        onUpdate: ({ editor }) => onBody(editor.getHTML()),
    })

    // Swap content when the selected post changes, without firing onUpdate.
    useEffect(() => {
        if (editor && editor.getHTML() !== body) editor.commands.setContent(body, false)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [slug, editor])

    // Auto-grow the title to its content.
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
