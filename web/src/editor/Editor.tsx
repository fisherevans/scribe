import { useState, type ReactNode } from 'react'
import { ContentEditor } from './ContentEditor'

interface Props {
    slug: string
    title: string
    body: string // markdown
    editable: boolean
    onEditTitle?: () => void // when omitted, no title-edit affordance is shown
    onBody: (markdown: string) => void
    emptyTitle?: string
    meta?: ReactNode // inline metadata (date/description/tags) between title and body
}

// The post writing surface: page chrome (title header, word-count footer) around
// the shared ContentEditor. Reused for the tag full-screen page-content editor.
export function Editor({ slug, title, body, editable, onEditTitle, onBody, emptyTitle = 'Untitled', meta }: Props) {
    const [words, setWords] = useState(0)
    return (
        <article className="page">
            <header className="page__head">
                <h1 className={'page__title-display' + (title ? '' : ' is-empty')}>
                    <TitleText text={title || emptyTitle} pencil={editable && !!onEditTitle} onEditTitle={onEditTitle} />
                </h1>
            </header>
            {meta}
            <ContentEditor docKey={slug} body={body} editable={editable} onBody={onBody} onWords={setWords} />
            <footer className="page__meta">
                {words} {words === 1 ? 'word' : 'words'} · {Math.max(1, Math.round(words / 220))} min read
            </footer>
        </article>
    )
}

// Title text with an optional trailing pencil. The last word and the pencil are
// kept on one line (a nowrap span) so the icon never wraps to a line by itself
// when the title wraps.
function TitleText({ text, pencil, onEditTitle }: { text: string; pencil: boolean; onEditTitle?: () => void }) {
    if (!pencil) return <>{text}</>
    const words = text.split(' ')
    const last = words[words.length - 1]
    const head = words.slice(0, -1).join(' ')
    return (
        <>
            {head && head + ' '}
            <span className="page__title-tail">
                {last}
                <button className="page__edit-pencil" type="button" onClick={onEditTitle} title="edit title & slug" aria-label="edit title & slug">✎</button>
            </span>
        </>
    )
}
