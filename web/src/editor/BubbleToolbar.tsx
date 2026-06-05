import { BubbleMenu } from '@tiptap/react'
import type { Editor } from '@tiptap/react'
import { Extension } from '@tiptap/core'
import { useEffect, useRef, useState } from 'react'

// ⌘K opens the link editor (decoupled from React via a window event so the
// ProseMirror keymap doesn't need to reach into component state).
export const LinkShortcut = Extension.create({
    name: 'linkShortcut',
    addKeyboardShortcuts() {
        return {
            'Mod-k': () => {
                window.dispatchEvent(new CustomEvent('scribe-open-link'))
                return true
            },
        }
    },
})

// Floating toolbar on text selection: bold / italic / inline code / link, with
// an inline link editor. This is the WYSIWYG affordance that removes the need
// to hand-type markdown for inline formatting.
export function BubbleToolbar({ editor }: { editor: Editor }) {
    const [linkMode, setLinkMode] = useState(false)
    const [url, setUrl] = useState('')
    const inputRef = useRef<HTMLInputElement>(null)

    const openLink = () => {
        setUrl(editor.getAttributes('link').href || '')
        setLinkMode(true)
        setTimeout(() => inputRef.current?.focus(), 20)
    }

    useEffect(() => {
        const h = () => {
            if (editor.state.selection.empty && !editor.isActive('link')) return
            openLink()
        }
        window.addEventListener('scribe-open-link', h)
        return () => window.removeEventListener('scribe-open-link', h)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [editor])

    const applyLink = () => {
        const href = url.trim()
        if (href) editor.chain().focus().extendMarkRange('link').setLink({ href }).run()
        else editor.chain().focus().extendMarkRange('link').unsetLink().run()
        setLinkMode(false)
    }

    return (
        <BubbleMenu
            editor={editor}
            tippyOptions={{ duration: 120, onHidden: () => setLinkMode(false) }}
            shouldShow={({ editor, from, to }) =>
                editor.isEditable && (from !== to || editor.isActive('link')) && !editor.isActive('codeBlock') && !editor.isActive('image')
            }
        >
            {linkMode ? (
                <div className="bubble bubble--link">
                    <input
                        ref={inputRef}
                        className="bubble__url"
                        value={url}
                        placeholder="https://…"
                        spellCheck={false}
                        onChange={(e) => setUrl(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault()
                                applyLink()
                            }
                            if (e.key === 'Escape') setLinkMode(false)
                        }}
                    />
                    <button className="bubble__btn" type="button" onMouseDown={(e) => { e.preventDefault(); applyLink() }} title="apply">
                        ↵
                    </button>
                    {editor.isActive('link') && (
                        <button
                            className="bubble__btn bubble__btn--danger"
                            type="button"
                            onMouseDown={(e) => { e.preventDefault(); setUrl(''); editor.chain().focus().extendMarkRange('link').unsetLink().run(); setLinkMode(false) }}
                            title="remove link"
                        >
                            ✕
                        </button>
                    )}
                </div>
            ) : (
                <div className="bubble">
                    <button className={'bubble__btn' + (editor.isActive('bold') ? ' is-active' : '')} type="button" onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleBold().run() }} title="bold">
                        <b>B</b>
                    </button>
                    <button className={'bubble__btn' + (editor.isActive('italic') ? ' is-active' : '')} type="button" onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleItalic().run() }} title="italic">
                        <i>I</i>
                    </button>
                    <button className={'bubble__btn' + (editor.isActive('code') ? ' is-active' : '')} type="button" onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleCode().run() }} title="code">
                        {'</>'}
                    </button>
                    <span className="bubble__sep" />
                    <button className={'bubble__btn' + (editor.isActive('link') ? ' is-active' : '')} type="button" onMouseDown={(e) => { e.preventDefault(); openLink() }} title="link (⌘K)">
                        🔗
                    </button>
                </div>
            )}
        </BubbleMenu>
    )
}
