import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useMemo, useState } from 'react'
import type { Resource } from '../types'
import { fbool, flist, fstr } from '../types'
import type { ResourcePatch } from '../collections'
import { slugify } from '../slug'

interface Props {
    resource: Resource | null
    allTags: string[]
    open: boolean
    onClose: () => void
    onPatch: (patch: ResourcePatch) => void
    onRename: (from: string, to: string) => void
    onDelete: () => void
}

// Deferred metadata for posts. Reads/writes the resource's frontmatter fields.
// (M2 derives which fields show here from the mapping; for now it knows the
// post fields directly.)
export function PublishSheet({ resource, allTags, open, onClose, onPatch, onRename, onDelete }: Props) {
    const [tagDraft, setTagDraft] = useState('')
    const [tagFocus, setTagFocus] = useState(false)
    const [slugDraft, setSlugDraft] = useState('')
    useEffect(() => {
        setSlugDraft(resource?.slug ?? '')
    }, [resource?.slug])

    const tags = resource ? flist(resource, 'tags') : []
    const suggestions = useMemo(() => {
        const q = tagDraft.trim().toLowerCase()
        return allTags.filter((t) => !tags.includes(t) && (q === '' || t.toLowerCase().includes(q))).slice(0, 8)
    }, [allTags, tags, tagDraft])

    if (!resource) return null

    const setField = (k: string, v: unknown) => onPatch({ fields: { [k]: v } })
    const addTag = (raw: string) => {
        const t = raw.trim().toLowerCase().replace(/\s+/g, '-')
        if (t && !tags.includes(t)) setField('tags', [...tags, t])
        setTagDraft('')
    }
    const commitSlug = () => {
        if (slugDraft && slugify(slugDraft) !== resource.slug) onRename(resource.slug, slugDraft)
        else setSlugDraft(resource.slug)
    }

    return (
        <AnimatePresence>
            {open && (
                <>
                    <motion.div className="scrim" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
                    <motion.aside className="sheet" initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', stiffness: 320, damping: 34 }}>
                        <div className="sheet__head">
                            <span className="sheet__title">details</span>
                            <button className="sheet__close" onClick={onClose} type="button">✕</button>
                        </div>

                        <div className="field">
                            <span className="field__label">slug <span className="field__private" style={{ color: 'var(--ink-faint)' }}>filename · URL path</span></span>
                            <input
                                className="field__input field__input--mono"
                                value={slugDraft}
                                spellCheck={false}
                                onChange={(e) => setSlugDraft(e.target.value)}
                                onBlur={commitSlug}
                                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
                            />
                        </div>

                        <label className="field">
                            <span className="field__label">description</span>
                            <textarea className="field__input" rows={3} value={fstr(resource, 'description')} placeholder="Used in RSS + summary listings" onChange={(e) => setField('description', e.target.value)} />
                        </label>

                        <div className="field">
                            <span className="field__label">tags</span>
                            <div className="chips">
                                {tags.map((t) => (
                                    <button key={t} className="chip" type="button" onClick={() => setField('tags', tags.filter((x) => x !== t))}>
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
                                        if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(suggestions[0] && tagDraft ? suggestions[0] : tagDraft) }
                                        else if (e.key === 'Backspace' && !tagDraft && tags.length) setField('tags', tags.slice(0, -1))
                                    }}
                                />
                            </div>
                            {tagFocus && suggestions.length > 0 && (
                                <div className="suggest">
                                    {suggestions.map((t) => (
                                        <button key={t} type="button" className="suggest__item" onMouseDown={(e) => { e.preventDefault(); addTag(t) }}>{t}</button>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className="field field--row">
                            <label className="field field--grow">
                                <span className="field__label">date</span>
                                <input className="field__input" type="date" value={fstr(resource, 'date')} onChange={(e) => setField('date', e.target.value)} />
                            </label>
                            <label className="field field--grow">
                                <span className="field__label">updated</span>
                                <input className="field__input" type="date" value={fstr(resource, 'updatedDate')} onChange={(e) => setField('updatedDate', e.target.value)} />
                            </label>
                        </div>

                        <div className="field field--row">
                            <label className="toggle">
                                <input type="checkbox" checked={fbool(resource, 'draft')} onChange={(e) => setField('draft', e.target.checked)} />
                                <span className="toggle__track" /><span className="field__label">draft</span>
                            </label>
                            <label className="toggle">
                                <input type="checkbox" checked={fbool(resource, 'hasVideo')} onChange={(e) => setField('hasVideo', e.target.checked)} />
                                <span className="toggle__track" /><span className="field__label">has video</span>
                            </label>
                        </div>

                        <label className="field">
                            <span className="field__label">hero image</span>
                            <input className="field__input" value={fstr(resource, 'heroImage')} placeholder="https://… or /posts/<slug>/hero.png" onChange={(e) => setField('heroImage', e.target.value)} />
                            {fstr(resource, 'heroImage') && <img className="field__heropreview" src={fstr(resource, 'heroImage')} alt="hero preview" />}
                        </label>

                        <label className="field field--notes">
                            <span className="field__label">notes <span className="field__private">private · never committed</span></span>
                            <textarea className="field__input field__input--notes" rows={5} value={resource.notes} placeholder="Links, reminders, todos. Stays on the scribe side, out of git." onChange={(e) => onPatch({ notes: e.target.value })} />
                        </label>

                        <div className="sheet__danger">
                            <button className="btn btn--danger btn--block" type="button" onClick={onDelete}>🗑 Delete post</button>
                        </div>
                    </motion.aside>
                </>
            )}
        </AnimatePresence>
    )
}
