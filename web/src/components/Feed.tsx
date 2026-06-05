import { motion } from 'framer-motion'
import type { Post } from '../types'

interface Props {
    posts: Post[]
    activeSlug: string | null
    onSelect: (slug: string) => void
    onNew: () => void
}

export function Feed({ posts, activeSlug, onSelect, onNew }: Props) {
    return (
        <nav className="feed">
            <div className="feed__head">
                <span className="feed__brand">scribe</span>
                <button className="feed__new" onClick={onNew} type="button">
                    + write
                </button>
            </div>
            <ul className="feed__list">
                {posts.map((p, i) => (
                    <motion.li
                        key={p.slug}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.03 * i, duration: 0.25 }}
                    >
                        <button
                            type="button"
                            className={'card' + (p.slug === activeSlug ? ' is-active' : '')}
                            onClick={() => onSelect(p.slug)}
                        >
                            <div className="card__meta">
                                <span className={'dot dot--' + p.state} />
                                <span className="card__date">{p.date}</span>
                                {p.draft && <span className="card__flag">draft</span>}
                                {p.dirty && <span className="card__flag card__flag--edit">edited</span>}
                            </div>
                            <div className="card__title">{p.title || 'Untitled'}</div>
                            {p.description && <div className="card__desc">{p.description}</div>}
                            {p.tags.length > 0 && (
                                <div className="card__tags">
                                    {p.tags.map((t) => (
                                        <span key={t} className="tag">
                                            {t}
                                        </span>
                                    ))}
                                </div>
                            )}
                        </button>
                    </motion.li>
                ))}
            </ul>
        </nav>
    )
}
