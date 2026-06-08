import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from './api'
import type { Resource, Schema } from './types'
import { fstr, flist } from './types'
import { viewFor, type CollectionView, type ResourcePatch, type Referencer } from './collections'
import { resolve, isConfigured, type Mapping } from './mapping'
import { DataContext, type DataApi } from './data'
import { CollectionRail } from './components/CollectionRail'
import { Feed } from './components/Feed'
import { TopBar, type SaveStatus } from './components/TopBar'
import { PublishSheet } from './components/PublishSheet'
import { SettingsPanel } from './components/SettingsPanel'
import { SetupWizard } from './components/SetupWizard'
import { CascadeDialog, type Cascade } from './components/CascadeDialog'
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
    const [setupOpen, setSetupOpen] = useState(false)
    const [editMode, setEditMode] = useState(false)
    const [cascade, setCascade] = useState<Cascade | null>(null)
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

    // Read-only data access for the reference picker etc.
    const dataApi = useMemo<DataApi>(() => ({
        list: (c) => lists[c] ?? [],
        labelFor: (c, slug) => {
            const v = views.find((x) => x.name === c)
            const r = (lists[c] ?? []).find((x) => x.slug === slug)
            return r && v ? v.feedTitle(r) : slug
        },
    }), [lists, views])

    useEffect(() => { applyTheme(theme); saveTheme(theme) }, [theme])
    useEffect(() => saveSettings(settings), [settings])

    // First-run: if .scribe.yml doesn't cover the schema yet, offer setup (once).
    useEffect(() => {
        if (schema && mapping && !isConfigured(schema, mapping) && !localStorage.getItem('scribe-setup-seen')) {
            setSetupOpen(true)
        }
    }, [schema, mapping])

    const saveMappingConfig = useCallback(async (m: Mapping) => {
        try {
            const saved = await api.saveMapping(m)
            setMapping(saved)
        } catch (e) {
            alert(`Couldn't save mapping: ${e instanceof Error ? e.message : e}`)
        }
        localStorage.setItem('scribe-setup-seen', '1')
        setSetupOpen(false)
    }, [])
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

    // Who points at (targetCollection, slug) via a reference field?
    const findReferencers = useCallback((targetCollection: string, slug: string): Referencer[] => {
        const out: Referencer[] = []
        for (const v of views) {
            for (const [role, target] of Object.entries(v.references)) {
                if (target !== targetCollection) continue
                const field = v.map[role]
                if (!field) continue
                for (const r of lists[v.name] ?? []) {
                    if (flist(r, field).includes(slug)) out.push({ collection: v.name, slug: r.slug, field })
                }
            }
        }
        return out
    }, [views, lists])

    const doRename = useCallback(async (c: string, from: string, to: string) => {
        await api.rename(c, from, to)
        setLists((cur) => ({ ...cur, [c]: (cur[c] ?? []).map((r) => (r.slug === from ? { ...r, slug: to } : r)) }))
        setSel((cur) => ({ ...cur, [c]: to }))
        writeHash(c, to, true)
    }, [])

    const doDelete = useCallback((c: string, slug: string) => {
        return api.remove(c, slug).then(() => {
            const next = (lists[c] ?? []).filter((r) => r.slug !== slug)[0]?.slug ?? null
            setLists((cur) => ({ ...cur, [c]: (cur[c] ?? []).filter((r) => r.slug !== slug) }))
            setSel((cur) => ({ ...cur, [c]: next }))
            writeHash(c, next, true); setDetails(false); setStatus('idle')
        })
    }, [lists])

    // Edit the referencing resources: replace (rename) or remove (delete) a slug.
    const updateReferencers = useCallback(async (refs: Referencer[], from: string, to: string | null) => {
        for (const ref of refs) {
            const r = (lists[ref.collection] ?? []).find((x) => x.slug === ref.slug)
            if (!r) continue
            const next = flist(r, ref.field)
                .flatMap((s) => (s === from ? (to ? [to] : []) : [s]))
            const merged: Resource = { ...r, fields: { ...r.fields, [ref.field]: next } }
            const saved = await api.save(ref.collection, ref.slug, merged)
            setLists((cur) => ({ ...cur, [ref.collection]: cur[ref.collection].map((x) => (x.slug === ref.slug ? saved : x)) }))
        }
    }, [lists])

    const rename = useCallback(async (from: string, toRaw: string) => {
        const to = slugify(toRaw)
        if (!to || to === from) return
        const refs = findReferencers(collection, from)
        if (refs.length > 0) { setCascade({ kind: 'rename', collection, from, to, title: view?.feedTitle(active!) ?? from, refs }); return }
        try { await doRename(collection, from, to) } catch (e) { alert(`Couldn't rename: ${e instanceof Error ? e.message : e}`) }
    }, [collection, findReferencers, doRename, view, active])

    const deleteActive = useCallback(async () => {
        if (!active || !view) return
        const refs = findReferencers(collection, active.slug)
        if (refs.length > 0) { setCascade({ kind: 'delete', collection, from: active.slug, title: view.feedTitle(active), refs }); return }
        if (!window.confirm(`Delete “${view.feedTitle(active)}”? This removes the file.`)) return
        try { await doDelete(collection, active.slug) } catch (e) { alert(`Couldn't delete: ${e instanceof Error ? e.message : e}`) }
    }, [active, view, collection, findReferencers, doDelete])

    // Resolve a cascade dialog choice.
    const runCascade = useCallback(async (updateRefs: boolean) => {
        if (!cascade) return
        const { kind, collection: c, from, to, refs } = cascade
        try {
            if (kind === 'rename' && to) {
                await doRename(c, from, to)
                if (updateRefs) await updateReferencers(refs, from, to)
            } else {
                await doDelete(c, from)
                if (updateRefs) await updateReferencers(refs, from, null)
            }
        } catch (e) { alert(`Couldn't apply: ${e instanceof Error ? e.message : e}`) }
        setCascade(null)
    }, [cascade, doRename, doDelete, updateReferencers])

    // Open a referenced resource for editing (from the reference picker).
    const openResource = useCallback((c: string, slug: string) => {
        setCollection(c); setSel((cur) => ({ ...cur, [c]: slug })); writeHash(c, slug)
        setEditMode(false); setDetails(false); setStatus('idle')
    }, [])

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
        <DataContext.Provider value={dataApi}>
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
                        <Experience resource={active} def={view.def} map={view.map} onPatch={patch} onEditTitle={() => setModal({ open: true, mode: 'edit' })} onRename={rename} onDelete={deleteActive} editable={editMode} />
                    ) : (
                        <div className="empty">{view ? `Nothing here yet. Press “${view.newLabel}”.` : 'Loading…'}</div>
                    )}
                </div>
            </main>

            {view?.hasDetails && (
                <PublishSheet resource={active} map={view.map} references={view.references} def={view.def} open={details} onClose={() => setDetails(false)} onPatch={patch} onRename={rename} onDelete={deleteActive} onOpenRef={openResource} />
            )}
            <CascadeDialog cascade={cascade} onResolve={runCascade} onCancel={() => setCascade(null)} />
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
                onConfigure={() => { setSettingsOpen(false); setSetupOpen(true) }}
                onClose={() => setSettingsOpen(false)}
            />
            {schema && resolved && (
                <SetupWizard
                    open={setupOpen}
                    firstRun={!mapping || !isConfigured(schema, mapping)}
                    schema={schema}
                    initial={resolved}
                    onSave={saveMappingConfig}
                    onClose={() => { localStorage.setItem('scribe-setup-seen', '1'); setSetupOpen(false) }}
                />
            )}
        </div>
        </DataContext.Provider>
    )
}
