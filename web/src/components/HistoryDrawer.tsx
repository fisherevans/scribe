import { useEffect, useRef, useState } from 'react'
import { api, type Checkpoint } from '../api'
import type { Resource } from '../types'
import { DiffView } from './DiffView'

interface Props {
    collection: string
    slug: string
    current: Resource // the live (last-saved) resource
    onClose: () => void
    onRestored: (saved: Resource) => void
}

// 'current' is the live draft; otherwise a checkpoint hash.
type Ref = 'current' | string

// Version history for one resource: a timeline of checkpoints on the left, a
// read-only preview/diff of the selected one on the right. The diff can compare
// the selected version against the current draft (default) or against any other
// checkpoint, so you can see what changed between any two points. Viewing is
// fully decoupled from the editor (no autosave is touched); the editor only
// changes on an explicit Restore (which lands a new checkpoint) or when the user
// copies a passage and pastes it themselves.
export function HistoryDrawer({ collection, slug, current, onClose, onRestored }: Props) {
    const [list, setList] = useState<Checkpoint[] | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [sel, setSel] = useState<string | null>(null) // selected checkpoint (the "target")
    const [base, setBase] = useState<Ref>('current') // what to diff the target against
    const [version, setVersion] = useState<Resource | null>(null)
    const [baseBody, setBaseBody] = useState<string>(current.body)
    const [mode, setMode] = useState<'diff' | 'full'>('diff')
    const [confirm, setConfirm] = useState(false)
    const [busy, setBusy] = useState(false)
    const [copied, setCopied] = useState(false)

    // Cache fetched version bodies so flipping the compare base doesn't refetch.
    const bodies = useRef(new Map<string, string>())

    useEffect(() => {
        api.history(collection, slug).then(setList).catch((e) => setError(String(e)))
    }, [collection, slug])

    // Load the selected (target) version. Reset the compare base to "current"
    // each time a different version is picked.
    useEffect(() => {
        setConfirm(false)
        setBase('current')
        if (!sel) {
            setVersion(null)
            return
        }
        let live = true
        fetchBody(sel)
            .then((body) => live && setVersion({ ...current, body }))
            .catch((e) => live && setError(String(e)))
        return () => {
            live = false
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sel, collection, slug])

    // Load the compare base's body (current draft, or another checkpoint).
    useEffect(() => {
        let live = true
        if (base === 'current') {
            setBaseBody(current.body)
            return
        }
        fetchBody(base)
            .then((body) => live && setBaseBody(body))
            .catch((e) => live && setError(String(e)))
        return () => {
            live = false
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [base, current.body])

    const fetchBody = async (hash: string): Promise<string> => {
        const hit = bodies.current.get(hash)
        if (hit !== undefined) return hit
        const v = await api.versionAt(collection, slug, hash)
        bodies.current.set(hash, v.body)
        return v.body
    }

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

    // Order the two sides chronologically so the diff reads oldest -> newest
    // regardless of which the user picked as target vs base.
    const timeOf = (ref: Ref): number => (ref === 'current' ? Date.now() : msOf(list, ref))
    const labelOf = (ref: Ref): string => (ref === 'current' ? 'current' : agoFor(list, ref))
    const older: Ref = sel && timeOf(base) < timeOf(sel) ? base : sel ?? 'current'
    const newer: Ref = older === base ? (sel ?? 'current') : base
    const bodyOf = (ref: Ref): string => (ref === 'current' ? current.body : ref === sel ? (version?.body ?? '') : baseBody)

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
                        {!version && <div className="hist__hint">Pick a version to preview it, or compare any two.</div>}
                        {version && (
                            <>
                                <div className="hist__bar">
                                    <div className="hist__toggle">
                                        <button type="button" className={mode === 'diff' ? 'is-on' : ''} onClick={() => setMode('diff')}>diff</button>
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
                                    <>
                                        <div className="hist__cmp">
                                            <span>comparing</span>
                                            <select className="hist__base" value={base} onChange={(e) => setBase(e.target.value)}>
                                                <option value="current">current draft</option>
                                                {list?.map((c) => (
                                                    <option key={c.hash} value={c.hash} disabled={c.hash === sel}>{ago(c.time)} ({c.hash.slice(0, 7)})</option>
                                                ))}
                                            </select>
                                            <span className="hist__arrow">→ this version</span>
                                            <span className="hist__cmpnote">({labelOf(older)} → {labelOf(newer)})</span>
                                        </div>
                                        <DiffView before={bodyOf(older)} after={bodyOf(newer)} />
                                    </>
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

function msOf(list: Checkpoint[] | null, hash: string): number {
    const c = list?.find((x) => x.hash === hash)
    return c ? new Date(c.time).getTime() : 0
}

function agoFor(list: Checkpoint[] | null, hash: string): string {
    const c = list?.find((x) => x.hash === hash)
    return c ? ago(c.time) : hash.slice(0, 7)
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
