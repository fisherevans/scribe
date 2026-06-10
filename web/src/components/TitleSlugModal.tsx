import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import { slugify } from '../slug'

interface Props {
    open: boolean
    mode: 'new' | 'edit'
    initialTitle: string
    initialSlug: string
    onCancel: () => void
    onSubmit: (title: string, slug: string) => void
}

// One modal for both creating a post and editing its title. Shows the slug as
// an editable input. In 'new' mode the slug tracks the title until you edit it;
// in 'edit' mode the slug is left alone unless you change it (so editing a
// title never silently moves the file).
export function TitleSlugModal({ open, mode, initialTitle, initialSlug, onCancel, onSubmit }: Props) {
    const [title, setTitle] = useState(initialTitle)
    const [slug, setSlug] = useState(initialSlug)
    const [slugTouched, setSlugTouched] = useState(mode === 'edit')
    const inputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        if (!open) return
        setTitle(initialTitle)
        setSlug(initialSlug)
        setSlugTouched(mode === 'edit')
        setTimeout(() => inputRef.current?.focus(), 30)
    }, [open, mode, initialTitle, initialSlug])

    const onTitle = (v: string) => {
        setTitle(v)
        if (!slugTouched) setSlug(slugify(v))
    }

    const submit = () => {
        const finalSlug = slugify(slug) || slugify(title)
        if (!title.trim() || !finalSlug) return
        onSubmit(title.trim(), finalSlug)
    }

    return (
        <AnimatePresence>
            {open && (
                <>
                    <motion.div className="scrim" onClick={onCancel} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
                    <motion.div
                        className="modal"
                        style={{ x: '-50%' }}
                        initial={{ opacity: 0, scale: 0.96, y: 8 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.96, y: 8 }}
                        transition={{ duration: 0.16 }}
                    >
                        <div className="modal__title">{mode === 'new' ? 'New post' : 'Edit title'}</div>

                        <label className="modal__field">
                            <span className="modal__label">title</span>
                            <input
                                ref={inputRef}
                                className="modal__input"
                                value={title}
                                placeholder="Title"
                                onChange={(e) => onTitle(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') submit()
                                    if (e.key === 'Escape') onCancel()
                                }}
                            />
                        </label>

                        <label className="modal__field">
                            <span className="modal__label">
                                slug <span className="modal__hint">filename · URL{mode === 'edit' ? ' · changing this moves the file' : ''}</span>
                            </span>
                            <input
                                className="modal__input modal__input--mono"
                                value={slug}
                                placeholder="slug"
                                spellCheck={false}
                                onChange={(e) => {
                                    setSlug(e.target.value)
                                    setSlugTouched(true)
                                }}
                                onBlur={() => setSlug(slugify(slug))}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') submit()
                                    if (e.key === 'Escape') onCancel()
                                }}
                            />
                        </label>

                        <div className="modal__actions">
                            <button className="btn btn--ghost" type="button" onClick={onCancel}>
                                cancel
                            </button>
                            <button className="btn btn--promote" type="button" onClick={submit} disabled={!title.trim()}>
                                {mode === 'new' ? 'create' : 'save'}
                            </button>
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    )
}
