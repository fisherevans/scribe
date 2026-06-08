import { AnimatePresence, motion } from 'framer-motion'
import { useData } from '../data'
import type { Referencer } from '../collections'

export interface Cascade {
    kind: 'rename' | 'delete'
    collection: string
    from: string
    to?: string
    title: string
    refs: Referencer[]
}

interface Props {
    cascade: Cascade | null
    onResolve: (updateRefs: boolean) => void
    onCancel: () => void
}

// When a referenced resource is renamed or deleted, other resources still point
// at the old slug. This dialog previews who's affected and lets you choose
// whether to cascade the change. Per the locked UX, updating refs is the
// default (the prominent button).
export function CascadeDialog({ cascade, onResolve, onCancel }: Props) {
    const data = useData()
    const c = cascade
    const n = c?.refs.length ?? 0
    const noun = n === 1 ? 'resource' : 'resources'

    return (
        <AnimatePresence>
            {c && (
                <>
                    <motion.div className="scrim scrim--modal" onClick={onCancel} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
                    <motion.div
                        className="cascade"
                        initial={{ opacity: 0, scale: 0.96, y: 8 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.96, y: 8 }}
                        transition={{ type: 'spring', stiffness: 360, damping: 30 }}
                    >
                        <div className="cascade__head">
                            {c.kind === 'rename' ? (
                                <h2 className="cascade__title">Rename “{c.title}”?</h2>
                            ) : (
                                <h2 className="cascade__title">Delete “{c.title}”?</h2>
                            )}
                            <p className="cascade__sub">
                                {c.kind === 'rename' ? (
                                    <>
                                        <span className="cascade__slug">{c.from}</span> → <span className="cascade__slug">{c.to}</span>.{' '}
                                    </>
                                ) : null}
                                {n} {noun} reference it.
                            </p>
                        </div>

                        <ul className="cascade__refs">
                            {c.refs.slice(0, 8).map((ref) => (
                                <li key={`${ref.collection}/${ref.slug}`} className="cascade__ref">
                                    <span className="cascade__refcol">{ref.collection}</span>
                                    {data.labelFor(ref.collection, ref.slug)}
                                </li>
                            ))}
                            {n > 8 && <li className="cascade__ref cascade__ref--more">+{n - 8} more</li>}
                        </ul>

                        <div className="cascade__actions">
                            <button className="btn" type="button" onClick={() => onResolve(false)}>
                                {c.kind === 'rename' ? 'Rename only' : 'Delete only'}
                            </button>
                            <button className="btn btn--promote" type="button" onClick={() => onResolve(true)}>
                                {c.kind === 'rename' ? `Rename & update ${n}` : `Delete & clean ${n}`}
                            </button>
                        </div>
                        <button className="cascade__cancel" type="button" onClick={onCancel}>Cancel</button>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    )
}
