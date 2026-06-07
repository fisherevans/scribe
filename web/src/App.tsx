import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from './api'
import type { Resource, Schema } from './types'
import { fstr } from './types'
import { viewFor, type CollectionView, type ResourcePatch } from './collections'
import { resolve, type Mapping } from './mapping'
import { CollectionRail } from './components/CollectionRail'
import { Feed } from './components/Feed'
import { TopBar, type SaveStatus } from './components/TopBar'
import { PublishSheet } from './components/PublishSheet'
import { SettingsPanel } from './components/SettingsPanel'
import { TitleSlugModal } from './components/TitleSlugModal'
import { applyTheme, DEFAULT_THEME, loadTheme, saveTheme, type Theme } from './theme'
import { loadSettings, saveSettings, liveUrl, type AppSettings } from './settings'
import { slugify, uniqueSlug } from './slug'

const loadRail = () => {
    const v = parseFloat(localStorage.getItem('scribe-rail') || '')
    return Number.isFinite(v) ? v : 19
}
const today = () => new Date().toISOString().slice(0, 10)

// #/<collection>/<slug>
function parseHash(): { collection?: string; slug?: string } {
    const m = location.hash.match(/^#\/([a-z0-9-]+)(?:\/([^/]+))?/i)
    if (!m) return {}
    return { collection: m[1], slug: m[2] ? decodeURIComponent(m[2]) : undefined }
}
function writeHash(c: string, slug: string | null, replace = false) {
    const h = `#/${c}${slug ? '/' + encodeURIComponent(slug) : ''}`
    if (location.hash !== h) history[replace ? 'replaceState' : 'pushState'](null, '', h)
}

export default function App() {
    const [schema, setSchema] = useState<Schema | null>(null)
    const [mapping, setMapping] = useState<Mapping | null>(null)
    const [collection, setCollection] = useState<string>('')
    const [lists, setLists] = useState<Record<string, Resource[]>>({})
    const [sel, setSel] = useState<Record<string, string | null>>({})
    const [status, setStatus] = useState<SaveStatus>('idle')
    const [promoting, setPromoting] = useState(false)
    const [drawer, setDrawer] = useState(false)
    const [details, setDetails] = useState(false)
    const [settingsOpen, setSettingsOpen] = useState(false)
    const [editMode, setEditMode] = useState(false)
    const [modal, setModal] = useState<{ open: boolean; mode: 'new' | 'edit' }>({ open: false, mode: 'new' })
    const [theme, setTheme] = useState<Theme>(loadTheme)
    const [settings, setSettings] = useState<AppSettings>(loadSettings)
    const [loadError, setLoadError] = useState<string | null>(null)
    const saveTimer = useRef<number | null>(null)
    const railW = useRef(loadRail())

    const resolved = useMemo(() => (schema ? resolve(schema, mapping) : null), [schema, mapping])
    const views = useMemo<CollectionView[]>(() => {
        if (!schema || !resolved) return []
        const vs = schema.collections.map((def) => viewFor(def, resolved.collections[def.name]))
        const pi = vs.findIndex((v) => v.name === schema.primary) // primary collection first
        if (pi > 0) vs.unshift(vs.splice(pi, 1)[0])
        return vs
    }, [schema, resolved])
    const view = views.find((v) => v.name === collection) ?? null
    const items = lists[collection] ?? []
    const activeSlug = sel[collection] ?? null
    const active = items.find((r) => r.slug === activeSlug) ?? null
    const tagItems = lists['tags'] ?? []
    const allTags = tagItems.map((t) => t.slug)

    useEffect(() => { applyTheme(theme); saveTheme(theme) }, [theme])
    useEffect(() => saveSettings(settings), [settings])
    useEffect(() => { document.body.classList.toggle('is-readonly', !editMode) }, [editMode])
    useEffect(() => { document.documentElement.style.setProperty('--rail-w', railW.current + 'rem') }, [])

    // Visual-viewport height (iOS keyboard).
    useEffect(() => {
        const vv = window.visualViewport
        if (!vv) return
        const update = () => document.documentElement.style.setProperty('--app-vh', `${vv.height}px`)
        update()
        vv.addEventListener('resize', update); vv.addEventListener('scroll', update)
        return () => { vv.removeEventListener('resize', update); vv.removeEventListener('scroll', update) }
    }, [])

    // Load schema, then every collection's resources.
    useEffect(() => {
        Promise.all([api.schema(), api.mapping()])
            .then(async ([sch, map]) => {
                const names = sch.collections.map((c) => c.name)
                const results = await Promise.all(names.map((c) => api.list(c)))
                const nextLists: Record<string, Resource[]> = {}
                const firstSel: Record<string, string | null> = {}
                names.forEach((c, i) => { nextLists[c] = results[i] ?? []; firstSel[c] = results[i]?.[0]?.slug ?? null })
                const init = parseHash()
                const start = init.collection && names.includes(init.collection) ? init.collection : sch.primary || names[0]
                if (init.slug && nextLists[start]?.some((r) => r.slug === init.slug)) firstSel[start] = init.slug
                setSchema(sch); setMapping(map); setLists(nextLists); setSel(firstSel); setCollection(start)
                writeHash(start, firstSel[start], true)
            })
            .catch((e) => setLoadError(e instanceof Error ? e.message : String(e)))
    }, [])

    // Back/forward + manual hash edits.
    useEffect(() => {
        const onNav = () => {
            const { collection: c, slug } = parseHash()
            if (c) { setCollection(c); if (slug) setSel((cur) => ({ ...cur, [c]: slug })); setEditMode(false) }
        }
        window.addEventListener('popstate', onNav); window.addEventListener('hashchange', onNav)
        return () => { window.removeEventListener('popstate', onNav); window.removeEventListener('hashchange', onNav) }
    }, [])

    const queueSave = useCallback((c: string, resource: Resource) => {
        setStatus('edited')
        if (saveTimer.current) window.clearTimeout(saveTimer.current)
        saveTimer.current = window.setTimeout(async () => {
            setStatus('saving')
            try {
                const next = await api.save(c, resource.slug, resource)
                setLists((cur) => ({ ...cur, [c]: cur[c].map((r) => (r.slug === resource.slug ? next : r)) }))
                setStatus('saved')
            } catch { setStatus('edited') }
        }, 650)
    }, [])

    const patch = useCallback(
        (p: ResourcePatch) => {
            if (!active) return
            const merged: Resource = {
                ...active,
                body: p.body !== undefined ? p.body : active.body,
                notes: p.notes !== undefined ? p.notes : active.notes,
                fields: p.fields ? { ...active.fields, ...p.fields } : active.fields,
                dirty: true,
            }
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
        setPromoting(false); setStatus('saved')
    }, [active, collection])

    const onNew = useCallback(async () => {
        if (collection === 'posts') { setModal({ open: true, mode: 'new' }); return }
        const fresh = await api.create(collection)
        setLists((cur) => ({ ...cur, [collection]: [fresh, ...(cur[collection] ?? [])] }))
        setSel((cur) => ({ ...cur, [collection]: fresh.slug }))
        writeHash(collection, fresh.slug); setEditMode(true); setStatus('idle'); setDrawer(false)
    }, [collection])

    const createPost = useCallback(
        async (title: string, slug: string) => {
            const uslug = uniqueSlug(slug || slugify(title), (lists['posts'] ?? []).map((p) => p.slug))
            const fresh: Resource = {
                collection: 'posts', slug: uslug, body: '', state: 'staged', dirty: false, notes: '',
                fields: { title, date: today(), draft: true },
            }
            const saved = await api.save('posts', uslug, fresh)
            setLists((cur) => ({ ...cur, posts: [saved, ...(cur['posts'] ?? [])] }))
            setSel((cur) => ({ ...cur, posts: uslug }))
            writeHash('posts', uslug); setEditMode(true); setStatus('saved'); setDrawer(false)
        },
        [lists],
    )

    const applyTitleEdit = useCallback(
        async (title: string, slug: string) => {
            if (!active) return
            const from = active.slug
            let merged: Resource = { ...active, fields: { ...active.fields, title }, dirty: true }
            try {
                if (slug !== from) { await api.rename(collection, from, slug); merged = { ...merged, slug } }
            } catch (e) { alert(`Couldn't rename: ${e instanceof Error ? e.message : e}`); return }
            const saved = await api.save(collection, slug, merged)
            setLists((cur) => ({ ...cur, [collection]: cur[collection].map((r) => (r.slug === from ? saved : r)) }))
            setSel((cur) => ({ ...cur, [collection]: slug }))
            writeHash(collection, slug, true); setStatus('saved')
        },
        [active, collection],
    )

    const rename = useCallback(async (from: string, toRaw: string) => {
        const to = slugify(toRaw)
        if (!to || to === from) return
        try {
            await api.rename(collection, from, to)
            setLists((cur) => ({ ...cur, [collection]: cur[collection].map((r) => (r.slug === from ? { ...r, slug: to } : r)) }))
            setSel((cur) => ({ ...cur, [collection]: to }))
            writeHash(collection, to, true)
        } catch (e) { alert(`Couldn't rename: ${e instanceof Error ? e.message : e}`) }
    }, [collection])

    const deleteActive = useCallback(async () => {
        if (!active || !view) return
        if (!window.confirm(`Delete “${view.feedTitle(active)}”? This removes the file.`)) return
        const slug = active.slug
        try { await api.remove(collection, slug) } catch (e) { alert(`Couldn't delete: ${e instanceof Error ? e.message : e}`); return }
        const rest = items.filter((r) => r.slug !== slug)
        const next = rest[0]?.slug ?? null
        setLists((cur) => ({ ...cur, [collection]: cur[collection].filter((r) => r.slug !== slug) }))
        setSel((cur) => ({ ...cur, [collection]: next }))
        writeHash(collection, next, true); setDetails(false); setStatus('idle')
    }, [active, view, collection, items])

    const onModalSubmit = useCallback(
        async (title: string, slug: string) => {
            if (modal.mode === 'new') await createPost(title, slug)
            else await applyTitleEdit(title, slug)
            setModal((m) => ({ ...m, open: false }))
        },
        [modal.mode, createPost, applyTitleEdit],
    )

    const select = useCallback((slug: string) => {
        setSel((cur) => ({ ...cur, [collection]: slug })); writeHash(collection, slug); setEditMode(false); setStatus('idle'); setDrawer(false)
    }, [collection])

    const switchCollection = useCallback((c: string) => {
        setCollection(c); writeHash(c, sel[c] ?? null); setEditMode(false); setStatus('idle'); setDetails(false)
    }, [sel])

    const startResize = useCallback((e: React.PointerEvent) => {
        e.preventDefault()
        const railPx = 3.6 * 16
        const onMove = (ev: PointerEvent) => {
            const rem = Math.min(34, Math.max(13, (ev.clientX - railPx) / 16))
            railW.current = rem; document.documentElement.style.setProperty('--rail-w', rem + 'rem')
        }
        const onUp = () => {
            window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp)
            document.body.style.cursor = ''; localStorage.setItem('scribe-rail', String(railW.current))
        }
        document.body.style.cursor = 'col-resize'
        window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp)
    }, [])

    if (loadError) {
        return (
            <div className="crash"><div className="crash__box">
                <h1 className="crash__title">Can’t reach the editor service</h1>
                <p className="crash__msg">{loadError}. Is the Go service running on :8080?</p>
                <button className="btn btn--promote" type="button" onClick={() => location.reload()}>retry</button>
            </div></div>
        )
    }

    const Experience = view?.Experience
    return (
        <div className={'app' + (drawer ? ' app--drawer' : '')}>
            <div className="app__nav">
                <CollectionRail views={views} active={collection} onSelect={switchCollection} onSettings={() => setSettingsOpen(true)} />
                <div className="app__feed">
                    {view && <Feed view={view} items={items} activeSlug={activeSlug} allTags={allTags} onSelect={select} onNew={onNew} />}
                </div>
                <div className="resizer" onPointerDown={startResize} title="drag to resize" />
            </div>
            <div className="app__scrim" onClick={() => setDrawer(false)} />

            <main className="app__main">
                <TopBar
                    resource={active}
                    showDetails={view?.hasDetails ?? false}
                    showEdit={collection === 'posts'}
                    editMode={editMode}
                    status={status}
                    promoting={promoting}
                    liveUrl={active && view ? liveUrl(settings.hostedDomain, view.livePath(active)) : null}
                    onMenu={() => setDrawer((d) => !d)}
                    onToggleEdit={() => setEditMode((m) => !m)}
                    onDetails={() => setDetails(true)}
                    onPromote={promote}
                />
                <div className={'app__canvas' + (collection === 'posts' ? '' : ' app__canvas--form')}>
                    {active && view && Experience ? (
                        <Experience resource={active} def={view.def} map={view.map} onPatch={patch} onEditTitle={() => setModal({ open: true, mode: 'edit' })} onDelete={deleteActive} editable={editMode} />
                    ) : (
                        <div className="empty">{view ? `Nothing here yet. Press “${view.newLabel}”.` : 'Loading…'}</div>
                    )}
                </div>
            </main>

            {view?.hasDetails && (
                <PublishSheet resource={active} map={view.map} def={view.def} allTags={allTags} open={details} onClose={() => setDetails(false)} onPatch={patch} onRename={rename} onDelete={deleteActive} />
            )}
            <TitleSlugModal
                open={modal.open}
                mode={modal.mode}
                initialTitle={modal.mode === 'edit' && active ? fstr(active, 'title') : ''}
                initialSlug={modal.mode === 'edit' && active ? active.slug : ''}
                onCancel={() => setModal((m) => ({ ...m, open: false }))}
                onSubmit={onModalSubmit}
            />
            <SettingsPanel
                open={settingsOpen}
                views={views}
                theme={theme}
                settings={settings}
                onTheme={setTheme}
                onThemeReset={() => setTheme({ ...DEFAULT_THEME })}
                onSettings={setSettings}
                onClose={() => setSettingsOpen(false)}
            />
        </div>
    )
}
