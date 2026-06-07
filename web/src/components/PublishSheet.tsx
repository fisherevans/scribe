import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useMemo, useState } from 'react'
import type { CollectionDef, Resource } from '../types'
import { fbool, flist, fstr } from '../types'
import type { ResourcePatch } from '../collections'
import { slugify } from '../slug'

interface Props {
    resource: Resource | null
    map: Record<string, string> // role -> field
    def: CollectionDef
    allTags: string[]
    open: boolean
    onClose: () => void
    onPatch: (patch: ResourcePatch) => void
    onRename: (from: string, to: string) => void
    onDelete: () => void
}

// Details = the deferred metadata for a post. Mapped optional roles render at
// top; everything the experience doesn't cover (unmapped schema fields) is
// preserved and editable under "additional fields" (hidden by default).
export function PublishSheet({ resource, map, def, allTags, open, onClose, onPatch, onRename, onDelete }: Props) {
    const [tagDraft, setTagDraft] = useState('')
    const [tagFocus, setTagFocus] = useState(false)
    const [slugDraft, setSlugDraft] = useState('')
    const [showAdvanced, setShowAdvanced] = useState(false)
    useEffect(() => setSlugDraft(resource?.slug ?? ''), [resource?.slug])

    const tagsField = map.tags
    const tags = resource && tagsField ? flist(resource, tagsField) : []
    const suggestions = useMemo(() => {
        const q = tagDraft.trim().toLowerCase()
        return allTags.filter((t) => !tags.includes(t) && (q === '' || t.toLowerCase().includes(q))).slice(0, 8)
    }, [allTags, tags, tagDraft])

    // Fields the experience doesn't map -> the raw bucket.
    const advanced = useMemo(() => {
        const mapped = new Set(Object.values(map))
        return def.fields.filter((f) => !mapped.has(f.name))
    }, [def, map])

    if (!resource) return null
    const r = resource
    const setField = (k: string, v: unknown) => onPatch({ fields: { [k]: v } })
    const addTag = (raw: string) => {
        if (!tagsField) return
        const t = raw.trim().toLowerCase().replace(/\s+/g, '-')
        if (t && !tags.includes(t)) setField(tagsField, [...tags, t])
        setTagDraft('')
    }
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

                        {tagsField && (
                            <div className="field">
                                <span className="field__label">tags</span>
                                <div className="chips">
                                    {tags.map((t) => (
                                        <button key={t} className="chip" type="button" onClick={() => setField(tagsField, tags.filter((x) => x !== t))}>{t} <span className="chip__x">✕</span></button>
                                    ))}
                                    <input className="chips__input" value={tagDraft} placeholder={tags.length ? 'add…' : 'add a tag…'} onChange={(e) => setTagDraft(e.target.value)} onFocus={() => setTagFocus(true)} onBlur={() => setTimeout(() => setTagFocus(false), 120)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(suggestions[0] && tagDraft ? suggestions[0] : tagDraft) }
                                            else if (e.key === 'Backspace' && !tagDraft && tags.length) setField(tagsField, tags.slice(0, -1))
                                        }} />
                                </div>
                                {tagFocus && suggestions.length > 0 && (
                                    <div className="suggest">{suggestions.map((t) => <button key={t} type="button" className="suggest__item" onMouseDown={(e) => { e.preventDefault(); addTag(t) }}>{t}</button>)}</div>
                                )}
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

                        {advanced.length > 0 && (
                            <div className="field">
                                <button className="advanced__toggle" type="button" onClick={() => setShowAdvanced((a) => !a)}>
                                    {showAdvanced ? '▾' : '▸'} additional fields <span className="advanced__count">{advanced.length}</span>
                                </button>
                                {showAdvanced && (
                                    <div className="advanced">
                                        {advanced.map((f) => (
                                            <div key={f.name} className="field">
                                                <span className="field__label">{f.label}</span>
                                                {f.list ? (
                                                    <input className="field__input field__input--mono" value={flist(r, f.name).join(', ')} placeholder="comma, separated" onChange={(e) => setField(f.name, e.target.value.split(',').map((s) => s.trim()).filter(Boolean))} />
                                                ) : f.type === 'boolean' ? (
                                                    <label className="toggle"><input type="checkbox" checked={fbool(r, f.name)} onChange={(e) => setField(f.name, e.target.checked)} /><span className="toggle__track" /></label>
                                                ) : f.type === 'text' || f.type === 'rich-text' || f.type === 'code' ? (
                                                    <textarea className="field__input" rows={3} value={fstr(r, f.name)} onChange={(e) => setField(f.name, e.target.value)} />
                                                ) : (
                                                    <input className="field__input" type={f.type === 'date' ? 'date' : f.type === 'number' ? 'number' : 'text'} value={fstr(r, f.name)} onChange={(e) => setField(f.name, f.type === 'number' ? Number(e.target.value) : e.target.value)} />
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

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
