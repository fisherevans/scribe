import type { Post } from '../types'

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'edited'

interface Props {
    post: Post | null
    status: SaveStatus
    promoting: boolean
    onMenu: () => void
    onDetails: () => void
    onPromote: () => void
}

const STATUS_LABEL: Record<SaveStatus, string> = {
    idle: '',
    saving: 'saving to staging…',
    saved: 'staged',
    edited: 'unsaved edits',
}

export function TopBar({ post, status, promoting, onMenu, onDetails, onPromote }: Props) {
    const canPromote = post && (post.state === 'staged' || post.dirty || status === 'edited')
    return (
        <header className="topbar">
            <button className="topbar__menu" onClick={onMenu} type="button" aria-label="posts">
                ≡
            </button>
            <div className="topbar__status">
                <span className={'status status--' + status}>{STATUS_LABEL[status]}</span>
            </div>
            <div className="topbar__actions">
                <button className="btn btn--ghost" onClick={onDetails} type="button" disabled={!post}>
                    details
                </button>
                <button
                    className="btn btn--promote"
                    onClick={onPromote}
                    type="button"
                    disabled={!canPromote || promoting}
                >
                    {promoting ? 'promoting…' : post?.state === 'promoted' && !canPromote ? 'live' : 'promote'}
                </button>
            </div>
        </header>
    )
}
