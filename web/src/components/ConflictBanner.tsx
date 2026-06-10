import { motion } from 'framer-motion'

// Shown when the open resource changed on disk (another tab/device, or an
// external edit) since it was read. Autosave is paused; the writer chooses to
// take the other version or overwrite with theirs.
export function ConflictBanner({ title, onReload, onOverwrite }: { title: string; onReload: () => void; onOverwrite: () => void }) {
    return (
        <motion.div className="conflictbanner" initial={{ y: -8, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
            <span className="conflictbanner__msg">
                <strong>“{title}”</strong> was changed somewhere else since you opened it. Saving is paused so nothing gets clobbered.
            </span>
            <div className="conflictbanner__actions">
                <button type="button" className="conflictbanner__btn" onClick={onReload}>Load theirs</button>
                <button type="button" className="conflictbanner__btn conflictbanner__btn--primary" onClick={onOverwrite}>Keep mine</button>
            </div>
        </motion.div>
    )
}
