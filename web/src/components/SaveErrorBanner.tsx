import { motion } from 'framer-motion'

export type SaveErrorReason = 'auth' | 'offline'

// Prominent, persistent banner for a failed save. The whole point of the save
// hardening: a failure can never read as "saved" or quietly sit as "unsaved".
// auth = the session proxy expired, work won't save until re-login. offline =
// the server is unreachable; the saver keeps retrying in the background.
export function SaveErrorBanner({ reason }: { reason: SaveErrorReason }) {
    const auth = reason === 'auth'
    return (
        <motion.div
            className={'saveerr' + (auth ? ' saveerr--auth' : '')}
            initial={{ y: -8, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            role="alert"
        >
            <span className="saveerr__icon">{auth ? '⚠' : '↻'}</span>
            <span className="saveerr__msg">
                {auth ? (
                    <>
                        <strong>You're signed out.</strong> Your changes are <strong>not being saved</strong>. They're kept on this device - reload to sign back in, then they'll save.
                    </>
                ) : (
                    <>
                        <strong>Can't reach the server.</strong> Your changes are <strong>not saved yet</strong> - retrying automatically. Keep this tab open.
                    </>
                )}
            </span>
            {auth && (
                <button type="button" className="saveerr__btn" onClick={() => location.reload()}>
                    Reload
                </button>
            )}
        </motion.div>
    )
}
