import { COLLECTIONS, COLLECTION_ORDER } from '../collections'
import type { CollectionName } from '../types'

interface Props {
    active: CollectionName
    onSelect: (c: CollectionName) => void
    onSettings: () => void
}

// The far-left type switcher. One entry per registered collection; this is the
// visible face of "managing resource types". Settings sits at the bottom.
export function CollectionRail({ active, onSelect, onSettings }: Props) {
    return (
        <div className="crail">
            <div className="crail__mark">s</div>
            {COLLECTION_ORDER.map((name) => {
                const c = COLLECTIONS[name]
                return (
                    <button
                        key={name}
                        type="button"
                        className={'crail__btn' + (name === active ? ' is-active' : '')}
                        onClick={() => onSelect(name)}
                        title={c.label}
                    >
                        <span className="crail__glyph">{c.glyph}</span>
                        <span className="crail__label">{c.label}</span>
                    </button>
                )
            })}
            <button type="button" className="crail__btn crail__settings" onClick={onSettings} title="settings">
                <span className="crail__glyph">⚙</span>
                <span className="crail__label">settings</span>
            </button>
        </div>
    )
}
