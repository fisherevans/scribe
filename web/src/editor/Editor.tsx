import { useState } from 'react'
import { ContentEditor } from './ContentEditor'

interface Props {
    slug: string
    title: string
    body: string // markdown
    editable: boolean
    onEditTitle: () => void
    onBody: (markdown: string) => void
}

// The post writing surface: page chrome (title header, word-count footer) around
// the shared ContentEditor.
export function Editor({ slug, title, body, editable, onEditTitle, onBody }: Props) {
    const [words, setWords] = useState(0)
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
            <ContentEditor docKey={slug} body={body} editable={editable} onBody={onBody} onWords={setWords} />
            <footer className="page__meta">
                {words} {words === 1 ? 'word' : 'words'} · {Math.max(1, Math.round(words / 220))} min read
            </footer>
        </article>
    )
}
