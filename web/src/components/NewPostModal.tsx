import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import { slugify } from '../slug'

interface Props {
    open: boolean
    onCancel: () => void
    onCreate: (title: string) => void
}

// Prompts for a title on +write, previews the auto-generated slug, and creates
// on OK. The slug stays editable afterward in details.
export function NewPostModal({ open, onCancel, onCreate }: Props) {
    const [title, setTitle] = useState('')
    const inputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        if (open) {
            setTitle('')
            setTimeout(() => inputRef.current?.focus(), 30)
        }
    }, [open])

    const submit = () => {
        if (!title.trim()) return
        onCreate(title.trim())
    }

    return (
        <AnimatePresence>
            {open && (
                <>
                    <motion.div className="scrim" onClick={onCancel} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
                    <motion.div
                        className="modal"
                        initial={{ opacity: 0, scale: 0.96, y: 8 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.96, y: 8 }}
                        transition={{ duration: 0.16 }}
                    >
                        <div className="modal__title">New post</div>
                        <input
                            ref={inputRef}
                            className="modal__input"
                            value={title}
                            placeholder="Title"
                            onChange={(e) => setTitle(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') submit()
                                if (e.key === 'Escape') onCancel()
                            }}
                        />
                        <div className="modal__slug">
                            slug: <code>{slugify(title) || 'untitled'}</code>
                        </div>
                        <div className="modal__actions">
                            <button className="btn btn--ghost" type="button" onClick={onCancel}>
                                cancel
                            </button>
                            <button className="btn btn--promote" type="button" onClick={submit} disabled={!title.trim()}>
                                create
                            </button>
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    )
}
