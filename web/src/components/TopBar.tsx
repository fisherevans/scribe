import { useState } from 'react'
import type { Resource } from '../types'

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'edited' | 'error'

interface Props {
    resource: Resource | null
    showDetails: boolean
    showEdit: boolean
    editMode: boolean
    status: SaveStatus
    stagedCount: number
    publishing: boolean
    liveUrl: string | null
    onMenu: () => void
    onToggleEdit: () => void
    onDetails: () => void
    onPublish: () => void
}

const STATUS_LABEL: Record<SaveStatus, string> = {
    idle: '',
    saving: 'saving…',
    saved: 'saved',
    edited: 'unsaved',
    error: 'not saved',
}

// Deliberately sparse: the page is the primary thing. The bar shows only the
// save status (when not idle), the edit toggle, a publish CTA when there's
// something staged, and an overflow for the occasional actions (details, live).
export function TopBar({ resource, showDetails, showEdit, editMode, status, stagedCount, publishing, liveUrl, onMenu, onToggleEdit, onDetails, onPublish }: Props) {
    const [menuOpen, setMenuOpen] = useState(false)
    const close = (fn: () => void) => () => { setMenuOpen(false); fn() }
    const hasOverflow = showDetails || !!liveUrl

    return (
        <header className="topbar">
            <button className="topbar__menu" onClick={onMenu} type="button" aria-label="browse">≡</button>
            <div className="topbar__status">
                {status !== 'idle' && <span className={'status status--' + status}>{STATUS_LABEL[status]}</span>}
            </div>

            <div className="topbar__actions">
                {stagedCount > 0 && (
                    <button className="btn btn--promote" onClick={onPublish} type="button" disabled={publishing} title="review & publish staged changes">
                        {publishing ? 'publishing…' : `↑ publish ${stagedCount}`}
                    </button>
                )}

                {showEdit && (
                    <button
                        className={'btn ' + (editMode ? 'btn--active' : 'btn--ghost')}
                        onClick={onToggleEdit}
                        type="button"
                        disabled={!resource}
                        title={editMode ? 'done editing (read-only)' : 'edit this post'}
                    >
                        {editMode ? '✓ done' : '✎ edit'}
                    </button>
                )}

                {hasOverflow && (
                    <div className="topbar__more">
                        <button
                            className={'btn btn--ghost topbar__overflow' + (menuOpen ? ' is-active' : '')}
                            onClick={() => setMenuOpen((o) => !o)}
                            type="button"
                            aria-label="more actions"
                        >⋯</button>
                        {menuOpen && <div className="topbar__scrim" onClick={() => setMenuOpen(false)} />}
                        <div className={'topbar__secondary' + (menuOpen ? ' is-open' : '')}>
                            {showDetails && (
                                <button className="btn btn--ghost" onClick={close(onDetails)} type="button" disabled={!resource}>details</button>
                            )}
                            {liveUrl && (
                                <a className="btn btn--ghost topbar__link" href={liveUrl} target="_blank" rel="noreferrer" onClick={() => setMenuOpen(false)}>view live ↗</a>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </header>
    )
}
