import { AnimatePresence, motion } from 'framer-motion'
import { useState } from 'react'
import type { ContentProblem } from '../api'

interface Props {
    problems: ContentProblem[]
}

// The service's error reads "parse notes/<slug>: yaml: line 9: ...". The path is
// already on the line above it here, so drop the redundant prefix and show only
// what went wrong.
function reason(p: ContentProblem): string {
    const i = p.error.indexOf(`/${p.slug}: `)
    return i === -1 ? p.error : p.error.slice(i + p.slug.length + 3)
}

// Files the service couldn't read, named so they can be fixed. Deliberately
// non-blocking: the rest of the collection loaded and is editable, so this is a
// notice above the app, not the crash screen it used to be. Dismissible for the
// session - the list is polled, and a broken file you've already seen shouldn't
// keep stealing the top of the window.
export function ContentProblemsBanner({ problems }: Props) {
    const [dismissed, setDismissed] = useState(false)
    const [open, setOpen] = useState(false)
    const show = problems.length > 0 && !dismissed
    const n = problems.length
    return (
        <AnimatePresence>
            {show && (
                <motion.div
                    className="probbanner"
                    initial={{ y: -40, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: -40, opacity: 0 }}
                    transition={{ type: 'spring', stiffness: 320, damping: 30 }}
                    role="status"
                >
                    <span className="probbanner__icon">⚠</span>
                    <div className="probbanner__msg">
                        <strong>
                            {n === 1 ? '1 file could not be read' : `${n} files could not be read`}
                        </strong>{' '}
                        and {n === 1 ? 'is' : 'are'} hidden from the list. Everything else loaded normally.
                        {open && (
                            <ul className="probbanner__list">
                                {problems.map((p) => (
                                    <li key={p.path}>
                                        <code>{p.path}</code>
                                        <span className="probbanner__err">{reason(p)}</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                    <div className="probbanner__actions">
                        <button className="probbanner__btn" type="button" onClick={() => setOpen((v) => !v)}>
                            {open ? 'hide' : 'details'}
                        </button>
                        <button className="probbanner__btn" type="button" onClick={() => setDismissed(true)}>
                            dismiss
                        </button>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    )
}
