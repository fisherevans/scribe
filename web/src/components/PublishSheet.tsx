import { AnimatePresence, motion } from 'framer-motion'
import { useState } from 'react'
import type { Post } from '../types'

interface Props {
    post: Post | null
    open: boolean
    onClose: () => void
    onPatch: (patch: Partial<Post>) => void
}

// The deferred metadata. None of this gates writing; it lives here and is only
// opened when you choose to. Tags are plain chips, not a repeater. Notes are
// private app-side state, never committed to git.
export function PublishSheet({ post, open, onClose, onPatch }: Props) {
    const [tagDraft, setTagDraft] = useState('')

    if (!post) return null

    const addTag = (raw: string) => {
        const t = raw.trim().toLowerCase().replace(/\s+/g, '-')
        if (t && !post.tags.includes(t)) onPatch({ tags: [...post.tags, t] })
        setTagDraft('')
    }

    return (
        <AnimatePresence>
            {open && (
                <>
                    <motion.div
                        className="scrim"
                        onClick={onClose}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                    />
                    <motion.aside
                        className="sheet"
                        initial={{ x: '100%' }}
                        animate={{ x: 0 }}
                        exit={{ x: '100%' }}
                        transition={{ type: 'spring', stiffness: 320, damping: 34 }}
                    >
                        <div className="sheet__head">
                            <span className="sheet__title">details</span>
                            <button className="sheet__close" onClick={onClose} type="button">
                                ✕
                            </button>
                        </div>

                        <label className="field">
                            <span className="field__label">description</span>
                            <textarea
                                className="field__input"
                                rows={3}
                                value={post.description}
                                placeholder="Used in RSS + summary listings"
                                onChange={(e) => onPatch({ description: e.target.value })}
                            />
                        </label>

                        <div className="field">
                            <span className="field__label">tags</span>
                            <div className="chips">
                                {post.tags.map((t) => (
                                    <button key={t} className="chip" type="button" onClick={() => onPatch({ tags: post.tags.filter((x) => x !== t) })}>
                                        {t} <span className="chip__x">✕</span>
                                    </button>
                                ))}
                                <input
                                    className="chips__input"
                                    value={tagDraft}
                                    placeholder={post.tags.length ? 'add…' : 'add a tag…'}
                                    onChange={(e) => setTagDraft(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' || e.key === ',') {
                                            e.preventDefault()
                                            addTag(tagDraft)
                                        } else if (e.key === 'Backspace' && !tagDraft && post.tags.length) {
                                            onPatch({ tags: post.tags.slice(0, -1) })
                                        }
                                    }}
                                />
                            </div>
                        </div>

                        <div className="field field--row">
                            <label className="field field--grow">
                                <span className="field__label">date</span>
                                <input
                                    className="field__input"
                                    type="date"
                                    value={post.date}
                                    onChange={(e) => onPatch({ date: e.target.value })}
                                />
                            </label>
                            <label className="toggle">
                                <input
                                    type="checkbox"
                                    checked={post.draft}
                                    onChange={(e) => onPatch({ draft: e.target.checked })}
                                />
                                <span className="toggle__track" />
                                <span className="field__label">draft</span>
                            </label>
                        </div>

                        <label className="field field--notes">
                            <span className="field__label">
                                notes <span className="field__private">private · never committed</span>
                            </span>
                            <textarea
                                className="field__input field__input--notes"
                                rows={6}
                                value={post.notes}
                                placeholder="Links, reminders, todos, half-ideas. Stays on the scribe side, out of git."
                                onChange={(e) => onPatch({ notes: e.target.value })}
                            />
                        </label>
                    </motion.aside>
                </>
            )}
        </AnimatePresence>
    )
}
