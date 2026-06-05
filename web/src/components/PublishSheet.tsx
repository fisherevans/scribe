import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useMemo, useState } from 'react'
import type { Post } from '../types'
import { slugify } from '../slug'

interface Props {
    post: Post | null
    allTags: string[]
    open: boolean
    onClose: () => void
    onPatch: (patch: Partial<Post>) => void
    onRename: (from: string, to: string) => void
}

// Deferred metadata. None of it gates writing. Tags autocomplete against the
// existing tag collection so you pick the canonical slug instead of guessing
// game-dev vs gamedev. Notes are private app-side state (not yet persisted).
export function PublishSheet({ post, allTags, open, onClose, onPatch, onRename }: Props) {
    const [tagDraft, setTagDraft] = useState('')
    const [tagFocus, setTagFocus] = useState(false)
    const [slugDraft, setSlugDraft] = useState('')
    useEffect(() => {
        setSlugDraft(post?.slug ?? '')
    }, [post?.slug])

    const suggestions = useMemo(() => {
        if (!post) return []
        const have = post.tags ?? []
        const q = tagDraft.trim().toLowerCase()
        return allTags
            .filter((t) => !have.includes(t) && (q === '' || t.toLowerCase().includes(q)))
            .slice(0, 8)
    }, [allTags, post, tagDraft])

    if (!post) return null

    const tags = post.tags ?? []
    const commitSlug = () => {
        if (slugDraft && slugify(slugDraft) !== post.slug) onRename(post.slug, slugDraft)
        else setSlugDraft(post.slug)
    }
    const addTag = (raw: string) => {
        const t = raw.trim().toLowerCase().replace(/\s+/g, '-')
        if (t && !tags.includes(t)) onPatch({ tags: [...tags, t] })
        setTagDraft('')
    }

    return (
        <AnimatePresence>
            {open && (
                <>
                    <motion.div className="scrim" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
                    <motion.aside
                        className="sheet"
                        initial={{ x: '100%' }}
                        animate={{ x: 0 }}
                        exit={{ x: '100%' }}
                        transition={{ type: 'spring', stiffness: 320, damping: 34 }}
                    >
                        <div className="sheet__head">
                            <span className="sheet__title">details</span>
                            <button className="sheet__close" onClick={onClose} type="button">✕</button>
                        </div>

                        <div className="field">
                            <span className="field__label">
                                slug <span className="field__private" style={{ color: 'var(--ink-faint)' }}>filename · URL path</span>
                            </span>
                            <input
                                className="field__input field__input--notes"
                                value={slugDraft}
                                spellCheck={false}
                                onChange={(e) => setSlugDraft(e.target.value)}
                                onBlur={commitSlug}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') e.currentTarget.blur()
                                }}
                            />
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
                                {tags.map((t) => (
                                    <button key={t} className="chip" type="button" onClick={() => onPatch({ tags: tags.filter((x) => x !== t) })}>
                                        {t} <span className="chip__x">✕</span>
                                    </button>
                                ))}
                                <input
                                    className="chips__input"
                                    value={tagDraft}
                                    placeholder={tags.length ? 'add…' : 'add a tag…'}
                                    onChange={(e) => setTagDraft(e.target.value)}
                                    onFocus={() => setTagFocus(true)}
                                    onBlur={() => setTimeout(() => setTagFocus(false), 120)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' || e.key === ',') {
                                            e.preventDefault()
                                            addTag(suggestions[0] && tagDraft ? suggestions[0] : tagDraft)
                                        } else if (e.key === 'Backspace' && !tagDraft && tags.length) {
                                            onPatch({ tags: tags.slice(0, -1) })
                                        }
                                    }}
                                />
                            </div>
                            {tagFocus && suggestions.length > 0 && (
                                <div className="suggest">
                                    {suggestions.map((t) => (
                                        <button key={t} type="button" className="suggest__item" onMouseDown={(e) => { e.preventDefault(); addTag(t) }}>
                                            {t}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className="field field--row">
                            <label className="field field--grow">
                                <span className="field__label">date</span>
                                <input className="field__input" type="date" value={post.date} onChange={(e) => onPatch({ date: e.target.value })} />
                            </label>
                            <label className="field field--grow">
                                <span className="field__label">updated</span>
                                <input className="field__input" type="date" value={post.updatedDate} onChange={(e) => onPatch({ updatedDate: e.target.value })} />
                            </label>
                        </div>

                        <div className="field field--row">
                            <label className="toggle">
                                <input type="checkbox" checked={post.draft} onChange={(e) => onPatch({ draft: e.target.checked })} />
                                <span className="toggle__track" />
                                <span className="field__label">draft</span>
                            </label>
                            <label className="toggle">
                                <input type="checkbox" checked={post.hasVideo} onChange={(e) => onPatch({ hasVideo: e.target.checked })} />
                                <span className="toggle__track" />
                                <span className="field__label">has video</span>
                            </label>
                        </div>

                        <label className="field">
                            <span className="field__label">hero image</span>
                            <input
                                className="field__input"
                                value={post.heroImage}
                                placeholder="https://media.fisher.sh/… or /posts/<slug>/hero.png"
                                onChange={(e) => onPatch({ heroImage: e.target.value })}
                            />
                            {post.heroImage && <img className="field__heropreview" src={post.heroImage} alt="hero preview" />}
                        </label>

                        <label className="field field--notes">
                            <span className="field__label">
                                notes <span className="field__private">private · not yet persisted</span>
                            </span>
                            <textarea
                                className="field__input field__input--notes"
                                rows={5}
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
