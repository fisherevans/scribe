import { AnimatePresence, motion } from 'framer-motion'
import { useMemo, useState } from 'react'
import { useData } from '../data'
import { slugify } from '../slug'

export interface Orphan {
    collection: string // the target collection that's missing this slug (e.g. tags)
    slug: string // the referenced-but-undefined slug
}

interface Props {
    orphan: Orphan | null
    onCreate: (collection: string, slug: string) => void // make it a first-class entry
    onReassign: (collection: string, slug: string, to: string) => void // replace across refs
    onRemove: (collection: string, slug: string) => void // strip from all refs
    onCancel: () => void
}

// Resolve an orphaned reference: a slug used by content (e.g. a tag on posts)
// with no resource of its own. Rather than silently creating it, offer the real
// choices - create it, reassign those references to another tag, or remove it -
// after showing exactly which content is affected.
export function OrphanDialog({ orphan, onCreate, onReassign, onRemove, onCancel }: Props) {
    const data = useData()
    const [mode, setMode] = useState<'menu' | 'reassign'>('menu')
    const [target, setTarget] = useState('')

    const o = orphan
    const refs = o ? data.referencers(o.collection, o.slug) : []
    const n = refs.length
    const kind = o ? o.collection.replace(/s$/, '') : ''
    const noun = n === 1 ? 'post' : 'posts'

    // Existing entries in the target collection, for the reassign chooser.
    const options = useMemo(() => {
        if (!o) return []
        const q = target.trim().toLowerCase()
        return data
            .list(o.collection)
            .filter((r) => r.slug !== o.slug && (q === '' || data.labelFor(o.collection, r.slug).toLowerCase().includes(q) || r.slug.includes(q)))
            .slice(0, 8)
    }, [data, o, target])

    const close = () => { setMode('menu'); setTarget(''); onCancel() }
    const reassignTo = (slug: string) => {
        const to = slugify(slug)
        if (o && to && to !== o.slug) onReassign(o.collection, o.slug, to)
        setMode('menu'); setTarget('')
    }

    return (
        <AnimatePresence>
            {o && (
                <>
                    <motion.div className="scrim scrim--modal" onClick={close} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
                    <motion.div
                        className="cascade"
                        style={{ x: '-50%', y: '-50%' }}
                        initial={{ opacity: 0, scale: 0.96 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.96 }}
                        transition={{ type: 'spring', stiffness: 360, damping: 30 }}
                    >
                        <div className="cascade__head">
                            <h2 className="cascade__title">Orphaned {kind}: “{o.slug}”</h2>
                            <p className="cascade__sub">
                                <span className="cascade__slug">{o.slug}</span> is used by {n} {noun} but has no {kind} of its own.
                            </p>
                        </div>

                        <ul className="cascade__refs">
                            {refs.slice(0, 8).map((ref) => (
                                <li key={`${ref.collection}/${ref.slug}`} className="cascade__ref">
                                    <span className="cascade__refcol">{ref.collection}</span>
                                    {data.labelFor(ref.collection, ref.slug)}
                                </li>
                            ))}
                            {n > 8 && <li className="cascade__ref cascade__ref--more">+{n - 8} more</li>}
                        </ul>

                        {mode === 'menu' ? (
                            <>
                                <div className="orphan__opts">
                                    <button type="button" className="orphan__opt" onClick={() => onCreate(o.collection, o.slug)}>
                                        <span className="orphan__optlabel">Make it a {kind}</span>
                                        <span className="orphan__optsub">Create a first-class {kind} entry and open it.</span>
                                    </button>
                                    <button type="button" className="orphan__opt" onClick={() => setMode('reassign')}>
                                        <span className="orphan__optlabel">Reassign to another {kind}</span>
                                        <span className="orphan__optsub">Replace it across the {n} {noun} with an existing {kind}.</span>
                                    </button>
                                    <button type="button" className="orphan__opt orphan__opt--danger" onClick={() => onRemove(o.collection, o.slug)}>
                                        <span className="orphan__optlabel">Remove from {noun}</span>
                                        <span className="orphan__optsub">Strip “{o.slug}” from all {n} {noun}.</span>
                                    </button>
                                </div>
                                <button className="cascade__cancel" type="button" onClick={close}>Do nothing</button>
                            </>
                        ) : (
                            <>
                                <div className="orphan__reassign">
                                    <input
                                        className="modal__input modal__input--mono"
                                        autoFocus
                                        value={target}
                                        spellCheck={false}
                                        placeholder={`replace with which ${kind}?`}
                                        onChange={(e) => setTarget(e.target.value)}
                                        onKeyDown={(e) => { if (e.key === 'Enter') reassignTo(options[0]?.slug ?? target); else if (e.key === 'Escape') setMode('menu') }}
                                    />
                                    {options.length > 0 && (
                                        <div className="orphan__suggest">
                                            {options.map((r) => (
                                                <button key={r.slug} type="button" className="orphan__suggestitem" onClick={() => reassignTo(r.slug)}>
                                                    {data.labelFor(o.collection, r.slug)} <span className="orphan__suggestslug">{r.slug}</span>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                                <div className="cascade__actions">
                                    <button className="btn" type="button" onClick={() => { setMode('menu'); setTarget('') }}>Back</button>
                                    <button className="btn btn--promote" type="button" disabled={!target.trim()} onClick={() => reassignTo(options[0]?.slug ?? target)}>
                                        Reassign {n} {noun}
                                    </button>
                                </div>
                            </>
                        )}
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    )
}
