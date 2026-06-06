import { useState } from 'react'
import type { Resource } from '../types'

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'edited'

interface Props {
    resource: Resource | null
    showDetails: boolean
    showEdit: boolean
    editMode: boolean
    status: SaveStatus
    promoting: boolean
    onMenu: () => void
    onTheme: () => void
    onToggleEdit: () => void
    onDetails: () => void
    onDelete: () => void
    onPromote: () => void
}

const STATUS_LABEL: Record<SaveStatus, string> = {
    idle: '',
    saving: 'saving…',
    saved: 'saved',
    edited: 'unsaved',
}

export function TopBar({ resource, showDetails, showEdit, editMode, status, promoting, onMenu, onTheme, onToggleEdit, onDetails, onDelete, onPromote }: Props) {
    const canPromote = resource && (resource.state === 'staged' || resource.dirty || status === 'edited')
    const [menuOpen, setMenuOpen] = useState(false)
    // Secondary-action handlers also close the overflow menu (mobile).
    const close = (fn: () => void) => () => {
        setMenuOpen(false)
        fn()
    }

    return (
        <header className="topbar">
            <button className="topbar__menu" onClick={onMenu} type="button" aria-label="browse">
                ≡
            </button>
            <div className="topbar__status">
                {showEdit && !editMode && <span className="viewbadge">viewing</span>}
                <span className={'status status--' + status}>{STATUS_LABEL[status]}</span>
            </div>

            <div className="topbar__actions">
                {showEdit && (
                    <button
                        className={'btn ' + (editMode ? 'btn--promote' : 'btn--ghost')}
                        onClick={onToggleEdit}
                        type="button"
                        disabled={!resource}
                        title={editMode ? 'done editing (read-only)' : 'edit this post'}
                    >
                        {editMode ? '✓ done' : '✎ edit'}
                    </button>
                )}

                <div className="topbar__more">
                    <button
                        className={'btn btn--ghost topbar__overflow' + (menuOpen ? ' is-active' : '')}
                        onClick={() => setMenuOpen((o) => !o)}
                        type="button"
                        aria-label="more actions"
                    >
                        ⋯
                    </button>
                    {menuOpen && <div className="topbar__scrim" onClick={() => setMenuOpen(false)} />}
                    <div className={'topbar__secondary' + (menuOpen ? ' is-open' : '')}>
                        {showDetails && (
                            <button className="btn btn--ghost" onClick={close(onDetails)} type="button" disabled={!resource}>
                                details
                            </button>
                        )}
                        <button className="btn btn--ghost" onClick={close(onTheme)} type="button" title="theme">
                            <span className="topbar__ico">aA</span>
                            <span className="topbar__label">theme</span>
                        </button>
                        <button className="btn btn--ghost btn--danger" onClick={close(onDelete)} type="button" disabled={!resource} title="delete">
                            <span className="topbar__ico">🗑</span>
                            <span className="topbar__label">delete</span>
                        </button>
                        <button className="btn btn--promote" onClick={close(onPromote)} type="button" disabled={!canPromote || promoting}>
                            {promoting ? 'promoting…' : resource?.state === 'promoted' && !canPromote ? 'live' : 'promote'}
                        </button>
                    </div>
                </div>
            </div>
        </header>
    )
}
