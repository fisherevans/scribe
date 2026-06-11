import { AnimatePresence, motion } from 'framer-motion'
import type { SyncStatus } from '../api'

interface Props {
    status: SyncStatus | null
    retrying: boolean
    onRetry: () => void
}

// SyncBanner surfaces a non-ok git sync state. Three cases:
//   - conflict: an external edit clashed with a staged change; the writer
//     reconciles via retry (the service never auto-resolves).
//   - error: a transient sync/push failure; retryable.
//   - degraded: git failed to start, so edits save to disk but can't be staged
//     or published. Not retryable from the UI (needs an operator restart), so no
//     retry button - just a loud, persistent heads-up that work isn't publishing.
export function SyncBanner({ status, retrying, onRetry }: Props) {
    const state = status?.state
    const show = state === 'conflict' || state === 'error' || state === 'degraded'
    const degraded = state === 'degraded'
    return (
        <AnimatePresence>
            {show && (
                <motion.div
                    className={'syncbanner syncbanner--' + state}
                    initial={{ y: -40, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: -40, opacity: 0 }}
                    transition={{ type: 'spring', stiffness: 320, damping: 30 }}
                >
                    <span className="syncbanner__icon">{state === 'error' ? '⛓' : '⚠'}</span>
                    <span className="syncbanner__msg">
                        {degraded ? (
                            <>
                                <strong>Can't access git.</strong> Your edits are saved to disk but <strong>can't be staged or published</strong> until this is fixed.
                                {status?.message ? ' ' + status.message : ''}
                            </>
                        ) : (
                            <>
                                {state === 'conflict' ? 'Sync paused: ' : 'Sync error: '}
                                {status?.message || 'the publish branch moved and needs manual reconcile.'}
                            </>
                        )}
                    </span>
                    {!degraded && (
                        <button className="syncbanner__btn" type="button" onClick={onRetry} disabled={retrying}>
                            {retrying ? 'retrying…' : 'retry'}
                        </button>
                    )}
                </motion.div>
            )}
        </AnimatePresence>
    )
}
