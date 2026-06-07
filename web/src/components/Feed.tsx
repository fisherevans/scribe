import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import type { CollectionView } from '../collections'
import type { Resource } from '../types'
import { fbool, flist, fstr } from '../types'

interface Props {
    view: CollectionView
    items: Resource[]
    activeSlug: string | null
    allTags: string[]
    onSelect: (slug: string) => void
    onNew: () => void
}

type Sort = 'newest' | 'oldest' | 'draftsFirst' | 'title'

export function Feed({ view, items, activeSlug, allTags, onSelect, onNew }: Props) {
    const isPosts = view.name === 'posts'
    const [sort, setSort] = useState<Sort>(isPosts ? 'newest' : 'title')
    const [tagFilter, setTagFilter] = useState<string>('all')

    const shown = useMemo(() => {
        let list = items.slice()
        if (isPosts && tagFilter !== 'all') list = list.filter((r) => flist(r, 'tags').includes(tagFilter))
        const date = (r: Resource) => fstr(r, 'date')
        const title = (r: Resource) => view.feedTitle(r).toLowerCase()
        switch (sort) {
            case 'newest': list.sort((a, b) => date(b).localeCompare(date(a))); break
            case 'oldest': list.sort((a, b) => date(a).localeCompare(date(b))); break
            case 'title': list.sort((a, b) => title(a).localeCompare(title(b))); break
            case 'draftsFirst': list.sort((a, b) => (fbool(a, 'draft') ? 0 : 1) - (fbool(b, 'draft') ? 0 : 1) || date(b).localeCompare(date(a))); break
        }
        return list
    }, [items, sort, tagFilter, isPosts, view])

    return (
        <nav className="feed">
            <div className="feed__head">
                <span className="feed__title">{view.label}</span>
                <button className="feed__new" onClick={onNew} type="button">{view.newLabel}</button>
            </div>

            <div className="feed__controls">
                <select className="ctrl" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                    {isPosts && <option value="newest">Newest</option>}
                    {isPosts && <option value="oldest">Oldest</option>}
                    {isPosts && <option value="draftsFirst">Drafts first</option>}
                    <option value="title">Title A–Z</option>
                </select>
                {isPosts && (
                    <select className="ctrl" value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}>
                        <option value="all">All tags</option>
                        {allTags.map((t) => <option key={t} value={t}>#{t}</option>)}
                    </select>
                )}
                <span className="feed__count">{shown.length}</span>
            </div>

            <ul className="feed__list">
                {shown.map((r, i) => {
                    const sub = view.feedSub(r)
                    const tags = isPosts ? flist(r, 'tags') : []
                    return (
                        <motion.li key={r.slug} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 12) * 0.02, duration: 0.2 }}>
                            <button type="button" className={'card' + (r.slug === activeSlug ? ' is-active' : '')} onClick={() => onSelect(r.slug)}>
                                <div className="card__meta">
                                    {isPosts && <span className="card__date">{fstr(r, 'date')}</span>}
                                    {isPosts && fbool(r, 'draft') && <span className="card__flag">draft</span>}
                                    {r.dirty && <span className="card__flag card__flag--edit">edited</span>}
                                </div>
                                <div className="card__title">{view.feedTitle(r)}</div>
                                {sub && <div className="card__desc">{sub}</div>}
                                {tags.length > 0 && (
                                    <div className="card__tags">{tags.map((t) => <span key={t} className="tag">{t}</span>)}</div>
                                )}
                            </button>
                        </motion.li>
                    )
                })}
            </ul>
        </nav>
    )
}
