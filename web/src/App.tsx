import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api'
import type { CollectionName, Post, Resource } from './types'
import { COLLECTIONS, COLLECTION_ORDER } from './collections'
import { CollectionRail } from './components/CollectionRail'
import { Feed } from './components/Feed'
import { TopBar, type SaveStatus } from './components/TopBar'
import { PublishSheet } from './components/PublishSheet'
import { ThemePanel } from './components/ThemePanel'
import { TitleSlugModal } from './components/TitleSlugModal'
import { applyTheme, DEFAULT_THEME, loadTheme, saveTheme, type Theme } from './theme'
import { slugify, uniqueSlug } from './slug'

type ByCollection<T> = Record<CollectionName, T>
const emptyLists: ByCollection<Resource[]> = { posts: [], tags: [], snippets: [] }
const emptySel: ByCollection<string | null> = { posts: null, tags: null, snippets: null }

const loadRail = () => {
    const v = parseFloat(localStorage.getItem('scribe-rail') || '')
    return Number.isFinite(v) ? v : 19
}

// Hash routing: #/<collection>/<slug>. Hash (not path) so it never collides
// with the /posts and /assets proxies, and reloads/bookmarks just work.
function parseHash(): { collection?: CollectionName; slug?: string } {
    const m = location.hash.match(/^#\/([a-z]+)(?:\/([^/]+))?/)
    if (!m) return {}
    return { collection: m[1] as CollectionName, slug: m[2] ? decodeURIComponent(m[2]) : undefined }
}
function writeHash(c: CollectionName, slug: string | null, replace = false) {
    const h = `#/${c}${slug ? '/' + encodeURIComponent(slug) : ''}`
    if (location.hash !== h) history[replace ? 'replaceState' : 'pushState'](null, '', h)
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
    const [editMode, setEditMode] = useState(false) // posts open read-only; edit is explicit
    const [modal, setModal] = useState<{ open: boolean; mode: 'new' | 'edit' }>({ open: false, mode: 'new' })
    const [theme, setTheme] = useState<Theme>(loadTheme)
    const [loadError, setLoadError] = useState<string | null>(null)
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

    // Hide edit-only affordances (drag handle) when not in edit mode.
    useEffect(() => {
        document.body.classList.toggle('is-readonly', !editMode)
    }, [editMode])

    useEffect(() => {
        document.documentElement.style.setProperty('--rail-w', railW.current + 'rem')
    }, [])

    // Size the app to the *visual* viewport so the on-screen keyboard (iOS) just
    // shrinks the editing area instead of leaving a dead buffer below the page.
    useEffect(() => {
        const vv = window.visualViewport
        if (!vv) return
        const update = () => document.documentElement.style.setProperty('--app-vh', `${vv.height}px`)
        update()
        vv.addEventListener('resize', update)
        vv.addEventListener('scroll', update)
        return () => {
            vv.removeEventListener('resize', update)
            vv.removeEventListener('scroll', update)
        }
    }, [])

    useEffect(() => {
        Promise.all(COLLECTION_ORDER.map((c) => api.list(c)))
            .then((results) => {
                const next = { ...emptyLists }
                const firstSel = { ...emptySel }
                COLLECTION_ORDER.forEach((c, i) => {
                    next[c] = results[i]
                    firstSel[c] = results[i][0]?.slug ?? null
                })
                // Honor the URL's collection/slug if present and valid.
                const init = parseHash()
                const startCol = init.collection && COLLECTION_ORDER.includes(init.collection) ? init.collection : 'posts'
                const ci = COLLECTION_ORDER.indexOf(startCol)
                if (init.slug && results[ci]?.some((r) => r.slug === init.slug)) firstSel[startCol] = init.slug
                setLists(next)
                setSel(firstSel)
                setCollection(startCol)
                writeHash(startCol, firstSel[startCol], true)
            })
            .catch((e) => setLoadError(e instanceof Error ? e.message : String(e)))
    }, [])

    // Sync state from the URL on back/forward and manual hash edits.
    useEffect(() => {
        const onNav = () => {
            const { collection: c, slug } = parseHash()
            if (c && (COLLECTION_ORDER as string[]).includes(c)) {
                setCollection(c)
                if (slug) setSel((cur) => ({ ...cur, [c]: slug }))
                setEditMode(false) // navigating opens read-only
            }
        }
        window.addEventListener('popstate', onNav)
        window.addEventListener('hashchange', onNav)
        return () => {
            window.removeEventListener('popstate', onNav)
            window.removeEventListener('hashchange', onNav)
        }
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

    // +write: posts open the title/slug modal; other collections create an
    // untitled resource directly.
    const onNew = useCallback(async () => {
        if (collection === 'posts') {
            setModal({ open: true, mode: 'new' })
            return
        }
        const fresh = await api.create(collection)
        setLists((cur) => ({ ...cur, [collection]: [fresh, ...cur[collection]] }))
        setSel((cur) => ({ ...cur, [collection]: fresh.slug }))
        writeHash(collection, fresh.slug)
        setStatus('idle')
        setDrawer(false)
    }, [collection])

    const createPost = useCallback(
        async (title: string, slug: string) => {
            const uslug = uniqueSlug(slug || slugify(title), lists.posts.map((p) => p.slug))
            const fresh: Post = {
                kind: 'posts',
                slug: uslug,
                title,
                date: new Date().toISOString().slice(0, 10),
                description: '',
                tags: [],
                draft: true,
                hasVideo: false,
                updatedDate: '',
                heroImage: '',
                body: '',
                state: 'staged',
                dirty: false,
                notes: '',
            }
            const saved = (await api.save('posts', uslug, fresh)) as Post
            setLists((cur) => ({ ...cur, posts: [saved, ...cur.posts] }))
            setSel((cur) => ({ ...cur, posts: uslug }))
            writeHash('posts', uslug)
            setEditMode(true) // new post: go straight to editing
            setStatus('saved')
            setDrawer(false)
        },
        [lists.posts],
    )

    // Edit title (and optionally slug) together: rename the file first, then
    // write the new title under the final slug - avoids the debounced autosave
    // racing the rename and leaving a stale file at the old slug.
    const applyTitleEdit = useCallback(
        async (title: string, slug: string) => {
            if (!active) return
            const from = active.slug
            let merged = { ...active, title, dirty: true } as Post
            try {
                if (slug !== from) {
                    await api.rename('posts', from, slug)
                    merged = { ...merged, slug }
                }
            } catch (e) {
                alert(`Couldn't rename: ${e instanceof Error ? e.message : e}`)
                return
            }
            const saved = (await api.save('posts', slug, merged)) as Post
            setLists((cur) => ({ ...cur, posts: cur.posts.map((r) => (r.slug === from ? saved : r)) }))
            setSel((cur) => ({ ...cur, posts: slug }))
            writeHash('posts', slug, true)
            setStatus('saved')
        },
        [active],
    )

    // Slug-only rename from the details pane.
    const rename = useCallback(async (from: string, toRaw: string) => {
        const to = slugify(toRaw)
        if (!to || to === from) return
        try {
            await api.rename('posts', from, to)
            setLists((cur) => ({ ...cur, posts: cur.posts.map((r) => (r.slug === from ? ({ ...r, slug: to } as Resource) : r)) }))
            setSel((cur) => ({ ...cur, posts: to }))
            writeHash('posts', to, true)
        } catch (e) {
            alert(`Couldn't rename: ${e instanceof Error ? e.message : e}`)
        }
    }, [])

    const deleteActive = useCallback(async () => {
        if (!active) return
        if (!window.confirm(`Delete “${def.feedTitle(active)}”? This removes the file.`)) return
        const slug = active.slug
        try {
            await api.remove(collection, slug)
        } catch (e) {
            alert(`Couldn't delete: ${e instanceof Error ? e.message : e}`)
            return
        }
        const rest = lists[collection].filter((r) => r.slug !== slug)
        const next = rest[0]?.slug ?? null
        setLists((cur) => ({ ...cur, [collection]: cur[collection].filter((r) => r.slug !== slug) }))
        setSel((cur) => ({ ...cur, [collection]: next }))
        writeHash(collection, next, true)
        setStatus('idle')
    }, [active, collection, lists, def])

    const onModalSubmit = useCallback(
        async (title: string, slug: string) => {
            if (modal.mode === 'new') await createPost(title, slug)
            else await applyTitleEdit(title, slug)
            setModal((m) => ({ ...m, open: false }))
        },
        [modal.mode, createPost, applyTitleEdit],
    )

    const select = useCallback(
        (slug: string) => {
            setSel((cur) => ({ ...cur, [collection]: slug }))
            writeHash(collection, slug)
            setEditMode(false)
            setStatus('idle')
            setDrawer(false)
        },
        [collection],
    )

    const switchCollection = useCallback(
        (c: CollectionName) => {
            setCollection(c)
            writeHash(c, sel[c])
            setEditMode(false)
            setStatus('idle')
            setDetails(false)
        },
        [sel],
    )

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

    if (loadError) {
        return (
            <div className="crash">
                <div className="crash__box">
                    <h1 className="crash__title">Can’t reach the editor service</h1>
                    <p className="crash__msg">{loadError}. Is the Go service running on :8080?</p>
                    <button className="btn btn--promote" type="button" onClick={() => location.reload()}>
                        retry
                    </button>
                </div>
            </div>
        )
    }

    return (
        <div className={'app' + (drawer ? ' app--drawer' : '')}>
            <div className="app__nav">
                <CollectionRail active={collection} onSelect={switchCollection} />
                <div className="app__feed">
                    <Feed def={def} items={items} activeSlug={activeSlug} allTags={allTags} onSelect={select} onNew={onNew} />
                </div>
                <div className="resizer" onPointerDown={startResize} title="drag to resize" />
            </div>
            <div className="app__scrim" onClick={() => setDrawer(false)} />

            <main className="app__main">
                <TopBar
                    resource={active}
                    showDetails={def.hasDetails}
                    showEdit={def.name === 'posts'}
                    editMode={editMode}
                    status={status}
                    promoting={promoting}
                    onMenu={() => setDrawer((d) => !d)}
                    onTheme={() => setThemeOpen(true)}
                    onToggleEdit={() => setEditMode((m) => !m)}
                    onDetails={() => setDetails(true)}
                    onDelete={deleteActive}
                    onPromote={promote}
                />
                <div className={'app__canvas' + (collection === 'posts' ? '' : ' app__canvas--form')}>
                    {active ? (
                        <Experience
                            resource={active}
                            onPatch={patch}
                            onEditTitle={() => setModal({ open: true, mode: 'edit' })}
                            editable={editMode}
                        />
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
                    onRename={rename}
                />
            )}
            <TitleSlugModal
                open={modal.open}
                mode={modal.mode}
                initialTitle={modal.mode === 'edit' && active ? (active as Post).title : ''}
                initialSlug={modal.mode === 'edit' && active ? active.slug : ''}
                onCancel={() => setModal((m) => ({ ...m, open: false }))}
                onSubmit={onModalSubmit}
            />
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
