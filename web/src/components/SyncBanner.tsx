import { AnimatePresence, motion } from 'framer-motion'
import type { SyncStatus } from '../api'

interface Props {
    status: SyncStatus | null
    retrying: boolean
    onRetry: () => void
}

// SyncBanner surfaces a non-ok git sync state. The service never auto-resolves
// conflicts (an external Pages-CMS edit clashing with a staged change), so when
// that happens this is how the writer finds out and triggers a manual retry.
export function SyncBanner({ status, retrying, onRetry }: Props) {
    const show = status != null && (status.state === 'conflict' || status.state === 'error')
    return (
        <AnimatePresence>
            {show && (
                <motion.div
                    className={'syncbanner syncbanner--' + status!.state}
                    initial={{ y: -40, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: -40, opacity: 0 }}
                    transition={{ type: 'spring', stiffness: 320, damping: 30 }}
                >
                    <span className="syncbanner__icon">{status!.state === 'conflict' ? '⚠' : '⛓'}</span>
                    <span className="syncbanner__msg">
                        {status!.state === 'conflict' ? 'Sync paused: ' : 'Sync error: '}
                        {status!.message || 'the publish branch moved and needs manual reconcile.'}
                    </span>
                    <button className="syncbanner__btn" type="button" onClick={onRetry} disabled={retrying}>
                        {retrying ? 'retrying…' : 'retry'}
                    </button>
                </motion.div>
            )}
        </AnimatePresence>
    )
}
