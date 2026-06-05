import type { Resource } from '../types'

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'edited'

interface Props {
    resource: Resource | null
    showDetails: boolean
    status: SaveStatus
    promoting: boolean
    onMenu: () => void
    onTheme: () => void
    onDetails: () => void
    onDelete: () => void
    onPromote: () => void
}

const STATUS_LABEL: Record<SaveStatus, string> = {
    idle: '',
    saving: 'saving to staging…',
    saved: 'staged',
    edited: 'unsaved edits',
}

export function TopBar({ resource, showDetails, status, promoting, onMenu, onTheme, onDetails, onDelete, onPromote }: Props) {
    const canPromote = resource && (resource.state === 'staged' || resource.dirty || status === 'edited')
    return (
        <header className="topbar">
            <button className="topbar__menu" onClick={onMenu} type="button" aria-label="browse">
                ≡
            </button>
            <div className="topbar__status">
                <span className={'status status--' + status}>{STATUS_LABEL[status]}</span>
            </div>
            <div className="topbar__actions">
                <button className="btn btn--ghost" onClick={onTheme} type="button" title="theme">
                    aA
                </button>
                <button className="btn btn--ghost btn--danger" onClick={onDelete} type="button" disabled={!resource} title="delete">
                    🗑
                </button>
                {showDetails && (
                    <button className="btn btn--ghost" onClick={onDetails} type="button" disabled={!resource}>
                        details
                    </button>
                )}
                <button
                    className="btn btn--promote"
                    onClick={onPromote}
                    type="button"
                    disabled={!canPromote || promoting}
                >
                    {promoting ? 'promoting…' : resource?.state === 'promoted' && !canPromote ? 'live' : 'promote'}
                </button>
            </div>
        </header>
    )
}
