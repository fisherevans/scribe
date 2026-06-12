import { useEffect, useState } from 'react'
import { api, type Checkpoint } from '../api'
import type { Resource } from '../types'
import { DiffView } from './DiffView'

interface Props {
    collection: string
    slug: string
    current: Resource // the live (last-saved) resource, the diff baseline
    onClose: () => void
    onRestored: (saved: Resource) => void
}

// Version history for one resource: a timeline of checkpoints on the left, a
// read-only preview/diff of the selected one on the right. Viewing is fully
// decoupled from the editor (no autosave is touched); the editor only changes on
// an explicit Restore (which lands a new checkpoint) or when the user copies a
// passage and pastes it themselves.
export function HistoryDrawer({ collection, slug, current, onClose, onRestored }: Props) {
    const [list, setList] = useState<Checkpoint[] | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [sel, setSel] = useState<string | null>(null)
    const [version, setVersion] = useState<Resource | null>(null)
    const [mode, setMode] = useState<'diff' | 'full'>('diff')
    const [confirm, setConfirm] = useState(false)
    const [busy, setBusy] = useState(false)
    const [copied, setCopied] = useState(false)

    useEffect(() => {
        api.history(collection, slug).then(setList).catch((e) => setError(String(e)))
    }, [collection, slug])

    useEffect(() => {
        setConfirm(false)
        if (!sel) {
            setVersion(null)
            return
        }
        let live = true
        api.versionAt(collection, slug, sel)
            .then((v) => live && setVersion(v))
            .catch((e) => live && setError(String(e)))
        return () => {
            live = false
        }
    }, [sel, collection, slug])

    const restore = async (hash: string) => {
        setBusy(true)
        try {
            const saved = await api.restore(collection, slug, hash)
            onRestored(saved)
            onClose()
        } catch (e) {
            setError(String(e))
            setBusy(false)
        }
    }

    const copy = async (body: string) => {
        try {
            await navigator.clipboard.writeText(body)
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
        } catch {
            setError('clipboard unavailable')
        }
    }

    return (
        <div className="hist">
            <div className="hist__scrim" onClick={onClose} />
            <aside className="hist__panel" role="dialog" aria-label="Version history">
                <header className="hist__head">
                    <h2 className="hist__title">Version history</h2>
                    <button className="hist__x" onClick={onClose} type="button" aria-label="close">×</button>
                </header>
                {error && <div className="hist__error">{error}</div>}
                <div className="hist__body">
                    <ol className="hist__list">
                        {list === null && <li className="hist__empty">Loading…</li>}
                        {list !== null && list.length === 0 && <li className="hist__empty">No history yet.</li>}
                        {list?.map((c) => (
                            <li key={c.hash}>
                                <button
                                    type="button"
                                    className={'hist__item' + (sel === c.hash ? ' is-sel' : '')}
                                    onClick={() => setSel(c.hash)}
                                >
                                    <span className="hist__when" title={new Date(c.time).toLocaleString()}>{ago(c.time)}</span>
                                    <span className="hist__size">
                                        {c.added > 0 && <span className="hist__add">+{c.added}</span>}
                                        {c.removed > 0 && <span className="hist__del">-{c.removed}</span>}
                                        {c.added === 0 && c.removed === 0 && <span className="hist__nochg">·</span>}
                                    </span>
                                    <span className={'hist__dot ' + (c.published ? 'is-pub' : 'is-draft')} title={c.published ? 'published' : 'draft checkpoint'} />
                                </button>
                            </li>
                        ))}
                    </ol>

                    <div className="hist__preview">
                        {!version && <div className="hist__hint">Pick a version to preview it.</div>}
                        {version && (
                            <>
                                <div className="hist__bar">
                                    <div className="hist__toggle">
                                        <button type="button" className={mode === 'diff' ? 'is-on' : ''} onClick={() => setMode('diff')}>changes since</button>
                                        <button type="button" className={mode === 'full' ? 'is-on' : ''} onClick={() => setMode('full')}>full version</button>
                                    </div>
                                    <div className="hist__acts">
                                        <button type="button" className="btn btn--ghost" onClick={() => copy(version.body)}>{copied ? 'copied' : 'copy'}</button>
                                        {!confirm ? (
                                            <button type="button" className="btn btn--promote" disabled={busy} onClick={() => setConfirm(true)}>restore</button>
                                        ) : (
                                            <button type="button" className="btn btn--promote" disabled={busy} onClick={() => sel && restore(sel)}>{busy ? 'restoring…' : 'confirm restore'}</button>
                                        )}
                                    </div>
                                </div>
                                {confirm && (
                                    <div className="hist__note">Restores this version as a new checkpoint on top - your current text stays in history and can be restored back.</div>
                                )}
                                {mode === 'diff' ? (
                                    <DiffView before={version.body} after={current.body} />
                                ) : (
                                    <pre className="hist__full">{version.body || '(empty body)'}</pre>
                                )}
                            </>
                        )}
                    </div>
                </div>
            </aside>
        </div>
    )
}

// ago renders a compact relative time ("just now", "12m ago", "3h ago", "2d ago"),
// falling back to a date for anything older than a week.
function ago(iso: string): string {
    const t = new Date(iso).getTime()
    const s = Math.max(0, (Date.now() - t) / 1000)
    if (s < 45) return 'just now'
    const m = s / 60
    if (m < 60) return `${Math.round(m)}m ago`
    const h = m / 60
    if (h < 24) return `${Math.round(h)}h ago`
    const d = h / 24
    if (d < 7) return `${Math.round(d)}d ago`
    return new Date(iso).toLocaleDateString()
}
