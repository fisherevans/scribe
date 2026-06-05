import { motion } from 'framer-motion'
import type { CollectionDef } from '../collections'
import type { Post, Resource } from '../types'

interface Props {
    def: CollectionDef
    items: Resource[]
    activeSlug: string | null
    onSelect: (slug: string) => void
    onNew: () => void
}

// One feed for every collection. The per-type bits (title, subtitle) come from
// the registry; the common chrome (state dot, dirty/draft flags) is shared.
export function Feed({ def, items, activeSlug, onSelect, onNew }: Props) {
    return (
        <nav className="feed">
            <div className="feed__head">
                <span className="feed__title">{def.label}</span>
                <button className="feed__new" onClick={onNew} type="button">
                    {def.newLabel}
                </button>
            </div>
            <ul className="feed__list">
                {items.map((r, i) => {
                    const sub = def.feedSub(r)
                    return (
                        <motion.li
                            key={r.slug}
                            initial={{ opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.025 * i, duration: 0.22 }}
                        >
                            <button
                                type="button"
                                className={'card' + (r.slug === activeSlug ? ' is-active' : '')}
                                onClick={() => onSelect(r.slug)}
                            >
                                <div className="card__meta">
                                    <span className={'dot dot--' + r.state} />
                                    {def.name === 'posts' && <span className="card__date">{(r as Post).date}</span>}
                                    {def.name === 'posts' && (r as Post).draft && <span className="card__flag">draft</span>}
                                    {r.dirty && <span className="card__flag card__flag--edit">edited</span>}
                                </div>
                                <div className="card__title">{def.feedTitle(r)}</div>
                                {sub && <div className="card__desc">{sub}</div>}
                                {def.name === 'posts' && (r as Post).tags.length > 0 && (
                                    <div className="card__tags">
                                        {(r as Post).tags.map((t) => (
                                            <span key={t} className="tag">
                                                {t}
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </button>
                        </motion.li>
                    )
                })}
            </ul>
        </nav>
    )
}
