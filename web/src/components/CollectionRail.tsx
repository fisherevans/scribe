import type { CollectionView } from '../collections'

interface Props {
    views: CollectionView[]
    active: string
    onSelect: (c: string) => void
    onSettings: () => void
}

// The far-left type switcher, one entry per collection the schema describes.
export function CollectionRail({ views, active, onSelect, onSettings }: Props) {
    return (
        <div className="crail">
            <div className="crail__mark">s</div>
            {views.map((v) => (
                <button
                    key={v.name}
                    type="button"
                    className={'crail__btn' + (v.name === active ? ' is-active' : '')}
                    onClick={() => onSelect(v.name)}
                    title={v.label}
                >
                    <span className="crail__glyph">{v.glyph}</span>
                    <span className="crail__label">{v.label}</span>
                </button>
            ))}
            <button type="button" className="crail__btn crail__settings" onClick={onSettings} title="settings">
                <span className="crail__glyph">⚙</span>
                <span className="crail__label">settings</span>
            </button>
        </div>
    )
}
