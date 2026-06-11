import { motion } from 'framer-motion'
import type { PublishChange } from '../api'

export type PublishPhase = 'review' | 'publishing' | 'done' | 'error'

interface Props {
    diff: PublishChange[] | null // null = still loading
    phase: PublishPhase
    result: number
    error: string | null
    onConfirm: () => void
    onClose: () => void
}

const GLYPH: Record<PublishChange['status'], string> = {
    added: '+',
    modified: '~',
    deleted: '−',
    renamed: '→',
}

// PublishReview shows the full staged-vs-main changeset, then commits + pushes
// it as one unit. Publishing is all-or-nothing: a cascading edit (e.g. a tag
// rename that touched several posts) lands together or not at all, so the diff
// is reviewed and confirmed as a batch rather than per-resource.
// The parent mounts this only while the publish flow is active; it owns no
// open/close state and closing is an unmount (no AnimatePresence - reliable
// dismissal matters more than an exit animation on the critical publish path).
export function PublishReview({ diff, phase, result, error, onConfirm, onClose }: Props) {
    const n = diff?.length ?? 0
    const byCollection = group(diff ?? [])

    return (
        <>
            <motion.div className="scrim scrim--modal" onClick={phase === 'publishing' ? undefined : onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} />
            <motion.div
                className="publish"
                style={{ x: '-50%', y: '-50%' }}
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ type: 'spring', stiffness: 360, damping: 30 }}
            >
                {phase === 'done' ? (
                    <div className="publish__center">
                        <div className="publish__big">✓</div>
                        <h2 className="publish__title">All pushed up</h2>
                        <p className="publish__sub">{result} {result === 1 ? 'change' : 'changes'} published to the publish branch.</p>
                        <button className="btn btn--promote btn--block" type="button" onClick={onClose}>Done</button>
                    </div>
                ) : phase === 'error' ? (
                    <div className="publish__center">
                        <div className="publish__big publish__big--bad">!</div>
                        <h2 className="publish__title">Publish failed</h2>
                        <p className="publish__sub publish__sub--err">{error}</p>
                        <p className="publish__hint">Nothing was published. Your staged changes are intact - fix the issue and try again.</p>
                        <button className="btn btn--block" type="button" onClick={onClose}>Close</button>
                    </div>
                ) : (
                    <>
                        <div className="publish__head">
                            <h2 className="publish__title">Publish changes</h2>
                            <p className="publish__sub">
                                {diff === null ? 'Gathering the changeset…' : n === 0 ? 'Nothing staged - everything is already published.' : `${n} ${n === 1 ? 'change' : 'changes'} will be committed and pushed together.`}
                            </p>
                        </div>

                        {n > 0 && (
                            <div className="publish__list">
                                {byCollection.map(([col, items]) => (
                                    <div key={col} className="publish__group">
                                        <div className="publish__groupname">{col}</div>
                                        {items.map((c) => (
                                            <div key={c.slug} className={'publish__row publish__row--' + c.status}>
                                                <span className="publish__glyph" title={c.status}>{GLYPH[c.status]}</span>
                                                <span className="publish__rowtitle">{c.title}</span>
                                                <span className="publish__rowstatus">
                                                    {c.status === 'renamed' && c.from ? `${c.from} → ${c.slug}` : c.status}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                ))}
                            </div>
                        )}

                        <div className="publish__actions">
                            <button className="btn" type="button" onClick={onClose} disabled={phase === 'publishing'}>Cancel</button>
                            <button className="btn btn--promote" type="button" onClick={onConfirm} disabled={n === 0 || phase === 'publishing'}>
                                {phase === 'publishing' ? 'publishing…' : `↑ Publish ${n || ''}`.trim()}
                            </button>
                        </div>
                    </>
                )}
            </motion.div>
        </>
    )
}

function group(changes: PublishChange[]): [string, PublishChange[]][] {
    const m = new Map<string, PublishChange[]>()
    for (const c of changes) {
        const arr = m.get(c.collection) ?? []
        arr.push(c)
        m.set(c.collection, arr)
    }
    return [...m.entries()].map(([k, v]) => [k, v.sort((a, b) => a.title.localeCompare(b.title))])
}
