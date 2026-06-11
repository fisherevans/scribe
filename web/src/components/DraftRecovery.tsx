import { AnimatePresence, motion } from 'framer-motion'
import { useState } from 'react'
import type { Resource } from '../types'
import type { Draft } from '../lib/drafts'
import { DiffView } from './DiffView'

export interface RecoverItem {
    draft: Draft
    server: Resource | undefined // current server copy, if the resource still exists
    label: string // human title for the resource
}

interface Props {
    items: RecoverItem[]
    onRestore: (item: RecoverItem) => void
    onDiscard: (item: RecoverItem) => void
    onClose: () => void // dismiss for now; drafts are kept for the next load
}

function ago(at: number): string {
    const s = Math.max(0, Math.floor((Date.now() - at) / 1000))
    if (s < 60) return 'just now'
    const m = Math.floor(s / 60)
    if (m < 60) return `${m} min ago`
    const h = Math.floor(m / 60)
    if (h < 24) return `${h} hr ago`
    return `${Math.floor(h / 24)} d ago`
}

// Shown on load when localStorage holds edits that never made it to the server -
// the recovery path after an auth loss or crash. Each draft can be inspected
// (line diff vs the current file), restored, or discarded.
export function DraftRecovery({ items, onRestore, onDiscard, onClose }: Props) {
    const [open, setOpen] = useState<string | null>(items[0] ? key(items[0]) : null)
    if (items.length === 0) return null

    return (
        <AnimatePresence>
            <motion.div className="scrim scrim--modal" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
            <motion.div
                className="cascade recover"
                style={{ x: '-50%', y: '-50%' }}
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ type: 'spring', stiffness: 360, damping: 30 }}
            >
                <div className="cascade__head">
                    <h2 className="cascade__title">Unsaved changes found</h2>
                    <p className="cascade__sub">
                        {items.length === 1 ? 'An edit on this device' : `${items.length} edits on this device`} never finished saving. Restore or discard.
                    </p>
                </div>

                <div className="recover__list">
                    {items.map((it) => {
                        const k = key(it)
                        const isOpen = open === k
                        return (
                            <div key={k} className="recover__item">
                                <div className="recover__row">
                                    <div className="recover__meta">
                                        <span className="recover__label">{it.label}</span>
                                        <span className="recover__sub">{it.draft.collection} · edited {ago(it.draft.at)}</span>
                                    </div>
                                    <div className="recover__actions">
                                        <button type="button" className="btn btn--ghost" onClick={() => setOpen(isOpen ? null : k)}>
                                            {isOpen ? 'hide diff' : 'view diff'}
                                        </button>
                                        <button type="button" className="btn btn--ghost" onClick={() => onDiscard(it)}>discard</button>
                                        <button type="button" className="btn btn--promote" onClick={() => onRestore(it)}>restore</button>
                                    </div>
                                </div>
                                {isOpen && <DiffView before={it.server?.body ?? ''} after={it.draft.resource.body} />}
                            </div>
                        )
                    })}
                </div>

                <button className="cascade__cancel" type="button" onClick={onClose}>Decide later</button>
            </motion.div>
        </AnimatePresence>
    )
}

const key = (it: RecoverItem) => `${it.draft.collection}/${it.draft.slug}`
