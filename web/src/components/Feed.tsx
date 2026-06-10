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
    // Reference usage when this collection is a reference target (e.g. tags):
    // per-slug counts + slugs referenced by content with no resource yet.
    refUsage?: { counts: Map<string, number>; undefinedSlugs: string[] } | null
    onSelect: (slug: string) => void
    onNew: () => void
    // Click on an undefined (orphaned) referenced slug - opens the resolver.
    onResolveUndefined?: (collection: string, slug: string) => void
}

type Sort = 'newest' | 'oldest' | 'draftsFirst' | 'title'

export function Feed({ view, items, activeSlug, allTags, refUsage, onSelect, onNew, onResolveUndefined }: Props) {
    const isPosts = view.name === 'posts'
    const [sort, setSort] = useState<Sort>(isPosts ? 'newest' : 'title')
    const [tagFilter, setTagFilter] = useState<string>('all')
    const [searchOpen, setSearchOpen] = useState(false)
    const [query, setQuery] = useState('')

    const shown = useMemo(() => {
        let list = items.slice()
        if (isPosts && tagFilter !== 'all') list = list.filter((r) => flist(r, 'tags').includes(tagFilter))
        const q = query.trim().toLowerCase()
        if (q) list = list.filter((r) => view.feedTitle(r).toLowerCase().includes(q) || r.slug.toLowerCase().includes(q))
        const date = (r: Resource) => fstr(r, 'date')
        const title = (r: Resource) => view.feedTitle(r).toLowerCase()
        switch (sort) {
            case 'newest': list.sort((a, b) => date(b).localeCompare(date(a))); break
            case 'oldest': list.sort((a, b) => date(a).localeCompare(date(b))); break
            case 'title': list.sort((a, b) => title(a).localeCompare(title(b))); break
            case 'draftsFirst': list.sort((a, b) => (fbool(a, 'draft') ? 0 : 1) - (fbool(b, 'draft') ? 0 : 1) || date(b).localeCompare(date(a))); break
        }
        return list
    }, [items, sort, tagFilter, query, isPosts, view])

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
                    <option value="title">Title A-Z</option>
                </select>
                {isPosts && (
                    <select className="ctrl" value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}>
                        <option value="all">All tags</option>
                        {allTags.map((t) => <option key={t} value={t}>#{t}</option>)}
                    </select>
                )}
                <button
                    type="button"
                    className={'ctrl ctrl--icon' + (searchOpen || query ? ' is-active' : '')}
                    onClick={() => { setSearchOpen((o) => !o); if (searchOpen) setQuery('') }}
                    title="filter by title"
                    aria-label="filter by title"
                >⌕</button>
                <span className="feed__count">{shown.length}</span>
            </div>

            {searchOpen && (
                <div className="feed__search">
                    <input
                        className="feed__searchinput"
                        autoFocus
                        value={query}
                        placeholder="filter by title…"
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Escape') { setQuery(''); setSearchOpen(false) } }}
                    />
                    {query && <button type="button" className="feed__searchclear" onClick={() => setQuery('')} aria-label="clear">✕</button>}
                </div>
            )}

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
                                <div className="card__titlerow">
                                    <div className="card__title">{view.feedTitle(r)}</div>
                                    {refUsage && (() => {
                                        const n = refUsage.counts.get(r.slug) ?? 0
                                        return <span className={'refpill' + (n === 0 ? ' refpill--zero' : '')} title={n === 0 ? 'unused' : `${n} reference${n === 1 ? '' : 's'}`}>{n}</span>
                                    })()}
                                </div>
                                {sub && <div className="card__desc">{sub}</div>}
                                {tags.length > 0 && (
                                    <div className="card__tags">{tags.map((t) => <span key={t} className="tag">{t}</span>)}</div>
                                )}
                            </button>
                        </motion.li>
                    )
                })}
            </ul>

            {refUsage && refUsage.undefinedSlugs.length > 0 && (
                <div className="undef">
                    <div className="undef__head">
                        undefined <span className="undef__hint">referenced by content, no {view.label.toLowerCase().replace(/s$/, '')} yet</span>
                    </div>
                    <ul className="undef__list">
                        {refUsage.undefinedSlugs.map((slug) => {
                            const n = refUsage.counts.get(slug) ?? 0
                            return (
                                <li key={slug}>
                                    <button
                                        type="button"
                                        className="undef__item"
                                        title={onResolveUndefined ? `resolve "${slug}"` : undefined}
                                        disabled={!onResolveUndefined}
                                        onClick={onResolveUndefined ? () => onResolveUndefined(view.name, slug) : undefined}
                                    >
                                        <span className="undef__slug">{slug}</span>
                                        <span className="undef__count">{n} ref{n === 1 ? '' : 's'}</span>
                                        <span className="undef__add" aria-hidden="true">resolve →</span>
                                    </button>
                                </li>
                            )
                        })}
                    </ul>
                </div>
            )}
        </nav>
    )
}
