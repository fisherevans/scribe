import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useMemo, useState } from 'react'
import type { CollectionDef, Resource } from '../types'
import { fbool, flist, fstr } from '../types'
import type { ResourcePatch } from '../collections'
import { RawFields } from './RawFields'
import { ReferencePicker } from './ReferencePicker'
import { slugify } from '../slug'

interface Props {
    resource: Resource | null
    map: Record<string, string> // role -> field
    references: Record<string, string> // reference role -> target collection
    def: CollectionDef
    open: boolean
    onClose: () => void
    onPatch: (patch: ResourcePatch) => void
    onRename: (from: string, to: string) => void
    onDelete: () => void
    onOpenRef?: (collection: string, slug: string) => void
}

// Details = the deferred metadata for a post. Mapped optional roles render at
// top; everything the experience doesn't cover (unmapped schema fields) is
// preserved and editable under "additional fields" (hidden by default).
export function PublishSheet({ resource, map, references, def, open, onClose, onPatch, onRename, onDelete, onOpenRef }: Props) {
    const [slugDraft, setSlugDraft] = useState('')
    useEffect(() => setSlugDraft(resource?.slug ?? ''), [resource?.slug])

    const covered = useMemo(() => new Set(Object.values(map)), [map])

    if (!resource) return null
    const r = resource
    const setField = (k: string, v: unknown) => onPatch({ fields: { [k]: v } })
    const commitSlug = () => {
        if (slugDraft && slugify(slugDraft) !== r.slug) onRename(r.slug, slugDraft)
        else setSlugDraft(r.slug)
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
                            <input className="field__input field__input--mono" value={slugDraft} spellCheck={false} onChange={(e) => setSlugDraft(e.target.value)} onBlur={commitSlug} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }} />
                        </div>

                        {map.description && (
                            <label className="field">
                                <span className="field__label">description</span>
                                <textarea className="field__input" rows={3} value={fstr(r, map.description)} placeholder="Used in RSS + summary listings" onChange={(e) => setField(map.description, e.target.value)} />
                            </label>
                        )}

                        {map.tags && references.tags && (
                            <div className="field">
                                <span className="field__label">tags</span>
                                <ReferencePicker target={references.tags} value={flist(r, map.tags)} onChange={(slugs) => setField(map.tags, slugs)} onOpen={onOpenRef && ((slug) => onOpenRef(references.tags, slug))} />
                            </div>
                        )}

                        {(map.date || map.updatedDate) && (
                            <div className="field field--row">
                                {map.date && <label className="field field--grow"><span className="field__label">date</span><input className="field__input" type="date" value={fstr(r, map.date)} onChange={(e) => setField(map.date, e.target.value)} /></label>}
                                {map.updatedDate && <label className="field field--grow"><span className="field__label">updated</span><input className="field__input" type="date" value={fstr(r, map.updatedDate)} onChange={(e) => setField(map.updatedDate, e.target.value)} /></label>}
                            </div>
                        )}

                        {map.draft && (
                            <div className="field field--row">
                                <label className="toggle"><input type="checkbox" checked={fbool(r, map.draft)} onChange={(e) => setField(map.draft, e.target.checked)} /><span className="toggle__track" /><span className="field__label">draft</span></label>
                            </div>
                        )}

                        {map.heroImage && (
                            <label className="field">
                                <span className="field__label">hero image</span>
                                <input className="field__input" value={fstr(r, map.heroImage)} placeholder="https://… or /…" onChange={(e) => setField(map.heroImage, e.target.value)} />
                                {fstr(r, map.heroImage) && <img className="field__heropreview" src={fstr(r, map.heroImage)} alt="hero preview" />}
                            </label>
                        )}

                        <RawFields resource={r} def={def} covered={covered} onPatch={onPatch} />

                        <label className="field field--notes">
                            <span className="field__label">notes <span className="field__private">private · never committed</span></span>
                            <textarea className="field__input field__input--notes" rows={5} value={r.notes} placeholder="Links, reminders, todos. Stays on the scribe side, out of git." onChange={(e) => onPatch({ notes: e.target.value })} />
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
