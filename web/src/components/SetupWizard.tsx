import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { Schema } from '../types'
import type { CollectionMapping, Mapping } from '../mapping'
import { FieldMapper } from './FieldMapper'

interface Props {
    open: boolean
    firstRun: boolean
    schema: Schema
    initial: Mapping // resolved recommendations, pre-filled
    onSave: (m: Mapping) => void
    onClose: () => void
}

// First-run setup (and the re-map flow from Settings). Shows every collection
// with a recommended experience + field mapping you confirm or adjust, then
// writes .scribe.yml. Recommends, never auto-configures (Q2).
export function SetupWizard({ open, firstRun, schema, initial, onSave, onClose }: Props) {
    const [working, setWorking] = useState<Mapping>(initial)
    const setCol = (name: string, m: CollectionMapping) =>
        setWorking((w) => ({ collections: { ...w.collections, [name]: m } }))

    return (
        <AnimatePresence>
            {open && (
                <motion.div className="setup" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                    <motion.div className="setup__panel" initial={{ y: 16, scale: 0.99 }} animate={{ y: 0, scale: 1 }} exit={{ y: 16, opacity: 0 }} transition={{ duration: 0.18 }}>
                        <div className="setup__head">
                            <div>
                                <div className="setup__title">{firstRun ? 'Set up scribe for this site' : 'Edit type mappings'}</div>
                                <div className="setup__sub">
                                    Found {schema.collections.length} collections in <code>.pages.yml</code>. scribe recommended an editor for each - confirm or adjust the field mapping, then save.
                                </div>
                            </div>
                            <button className="sheet__close" type="button" onClick={onClose}>✕</button>
                        </div>

                        <div className="setup__body">
                            {schema.collections.map((def) => (
                                <div key={def.name} className="setup__card">
                                    <FieldMapper def={def} value={working.collections[def.name]} onChange={(m) => setCol(def.name, m)} />
                                </div>
                            ))}
                        </div>

                        <div className="setup__foot">
                            <button className="btn btn--ghost" type="button" onClick={onClose}>{firstRun ? 'skip for now' : 'cancel'}</button>
                            <button className="btn btn--promote" type="button" onClick={() => onSave(working)}>
                                {firstRun ? 'Save & start writing' : 'Save mapping'}
                            </button>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    )
}
