import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api'
import type { CollectionName, Post, Resource } from './types'
import { COLLECTIONS, COLLECTION_ORDER } from './collections'
import { CollectionRail } from './components/CollectionRail'
import { Feed } from './components/Feed'
import { TopBar, type SaveStatus } from './components/TopBar'
import { PublishSheet } from './components/PublishSheet'
import { ThemePanel } from './components/ThemePanel'
import { applyTheme, DEFAULT_THEME, loadTheme, saveTheme, type Theme } from './theme'

type ByCollection<T> = Record<CollectionName, T>
const emptyLists: ByCollection<Resource[]> = { posts: [], tags: [], snippets: [] }
const emptySel: ByCollection<string | null> = { posts: null, tags: null, snippets: null }

const loadRail = () => {
    const v = parseFloat(localStorage.getItem('scribe-rail') || '')
    return Number.isFinite(v) ? v : 19
}

export default function App() {
    const [collection, setCollection] = useState<CollectionName>('posts')
    const [lists, setLists] = useState<ByCollection<Resource[]>>(emptyLists)
    const [sel, setSel] = useState<ByCollection<string | null>>(emptySel)
    const [status, setStatus] = useState<SaveStatus>('idle')
    const [promoting, setPromoting] = useState(false)
    const [drawer, setDrawer] = useState(false)
    const [details, setDetails] = useState(false)
    const [themeOpen, setThemeOpen] = useState(false)
    const [theme, setTheme] = useState<Theme>(loadTheme)
    const saveTimer = useRef<number | null>(null)
    const railW = useRef(loadRail())

    const def = COLLECTIONS[collection]
    const items = lists[collection]
    const activeSlug = sel[collection]
    const active = items.find((r) => r.slug === activeSlug) ?? null

    useEffect(() => {
        applyTheme(theme)
        saveTheme(theme)
    }, [theme])

    useEffect(() => {
        document.documentElement.style.setProperty('--rail-w', railW.current + 'rem')
    }, [])

    useEffect(() => {
        Promise.all(COLLECTION_ORDER.map((c) => api.list(c))).then((results) => {
            const next = { ...emptyLists }
            const firstSel = { ...emptySel }
            COLLECTION_ORDER.forEach((c, i) => {
                next[c] = results[i]
                firstSel[c] = results[i][0]?.slug ?? null
            })
            setLists(next)
            setSel(firstSel)
        })
    }, [])

    const queueSave = useCallback((c: CollectionName, resource: Resource) => {
        setStatus('edited')
        if (saveTimer.current) window.clearTimeout(saveTimer.current)
        saveTimer.current = window.setTimeout(async () => {
            setStatus('saving')
            try {
                const next = await api.save(c, resource.slug, resource)
                setLists((cur) => ({ ...cur, [c]: cur[c].map((r) => (r.slug === resource.slug ? next : r)) }))
                setStatus('saved')
            } catch {
                setStatus('edited')
            }
        }, 650)
    }, [])

    const patch = useCallback(
        (p: Partial<Resource>) => {
            if (!active) return
            const merged = { ...active, ...p, dirty: true } as Resource
            setLists((cur) => ({ ...cur, [collection]: cur[collection].map((r) => (r.slug === merged.slug ? merged : r)) }))
            queueSave(collection, merged)
        },
        [active, collection, queueSave],
    )

    const promote = useCallback(async () => {
        if (!active) return
        setPromoting(true)
        const next = await api.promote(collection, active.slug)
        setLists((cur) => ({ ...cur, [collection]: cur[collection].map((r) => (r.slug === next.slug ? next : r)) }))
        setPromoting(false)
        setStatus('saved')
    }, [active, collection])

    const create = useCallback(async () => {
        const fresh = await api.create(collection)
        setLists((cur) => ({ ...cur, [collection]: [fresh, ...cur[collection]] }))
        setSel((cur) => ({ ...cur, [collection]: fresh.slug }))
        setStatus('idle')
        setDrawer(false)
    }, [collection])

    const select = useCallback(
        (slug: string) => {
            setSel((cur) => ({ ...cur, [collection]: slug }))
            setStatus('idle')
            setDrawer(false)
        },
        [collection],
    )

    const switchCollection = useCallback((c: CollectionName) => {
        setCollection(c)
        setStatus('idle')
        setDetails(false)
    }, [])

    // Drag-resize the feed rail (updates --rail-w live; persisted).
    const startResize = useCallback((e: React.PointerEvent) => {
        e.preventDefault()
        const railPx = 3.6 * 16 // collection rail width
        const onMove = (ev: PointerEvent) => {
            const rem = Math.min(34, Math.max(13, (ev.clientX - railPx) / 16))
            railW.current = rem
            document.documentElement.style.setProperty('--rail-w', rem + 'rem')
        }
        const onUp = () => {
            window.removeEventListener('pointermove', onMove)
            window.removeEventListener('pointerup', onUp)
            document.body.style.cursor = ''
            localStorage.setItem('scribe-rail', String(railW.current))
        }
        document.body.style.cursor = 'col-resize'
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
    }, [])

    const Experience = def.Experience
    const allTags = lists.tags.map((t) => t.slug)

    return (
        <div className={'app' + (drawer ? ' app--drawer' : '')}>
            <div className="app__nav">
                <CollectionRail active={collection} onSelect={switchCollection} />
                <div className="app__feed">
                    <Feed def={def} items={items} activeSlug={activeSlug} allTags={allTags} onSelect={select} onNew={create} />
                </div>
                <div className="resizer" onPointerDown={startResize} title="drag to resize" />
            </div>
            <div className="app__scrim" onClick={() => setDrawer(false)} />

            <main className="app__main">
                <TopBar
                    resource={active}
                    showDetails={def.hasDetails}
                    status={status}
                    promoting={promoting}
                    onMenu={() => setDrawer((d) => !d)}
                    onTheme={() => setThemeOpen(true)}
                    onDetails={() => setDetails(true)}
                    onPromote={promote}
                />
                <div className={'app__canvas' + (collection === 'posts' ? '' : ' app__canvas--form')}>
                    {active ? (
                        <Experience resource={active} onPatch={patch} />
                    ) : (
                        <div className="empty">Nothing here yet. Press “{def.newLabel}”.</div>
                    )}
                </div>
            </main>

            {def.hasDetails && (
                <PublishSheet
                    post={active && active.kind === 'posts' ? (active as Post) : null}
                    allTags={allTags}
                    open={details}
                    onClose={() => setDetails(false)}
                    onPatch={patch as (p: Partial<Post>) => void}
                />
            )}
            <ThemePanel
                theme={theme}
                open={themeOpen}
                onChange={setTheme}
                onReset={() => setTheme({ ...DEFAULT_THEME })}
                onClose={() => setThemeOpen(false)}
            />
        </div>
    )
}
