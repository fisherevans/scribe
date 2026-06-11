import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from './api'
import { Saver } from './lib/saver'
import { clearDraft, listDrafts, recoverableDraft, writeDraft, type Draft } from './lib/drafts'
import type { Resource, Schema } from './types'
import { fstr, flist } from './types'
import { viewFor, type CollectionView, type ResourcePatch, type Referencer } from './collections'
import { resolve, isConfigured, type Mapping } from './mapping'
import { DataContext, type DataApi } from './data'
import { UploadContext } from './editor/uploadContext'
import { CollectionRail } from './components/CollectionRail'
import { Feed } from './components/Feed'
import { TopBar, type SaveStatus } from './components/TopBar'
import { PublishSheet } from './components/PublishSheet'
import { SettingsPanel } from './components/SettingsPanel'
import { SetupWizard } from './components/SetupWizard'
import { CascadeDialog, type Cascade } from './components/CascadeDialog'
import { OrphanDialog, type Orphan } from './components/OrphanDialog'
import { PublishReview, type PublishPhase } from './components/PublishReview'
import { SyncBanner } from './components/SyncBanner'
import { ConflictBanner } from './components/ConflictBanner'
import { SaveErrorBanner, type SaveErrorReason } from './components/SaveErrorBanner'
import { DraftRecovery, type RecoverItem } from './components/DraftRecovery'
import type { Capabilities, PublishChange, SyncStatus } from './api'
import { TitleSlugModal } from './components/TitleSlugModal'
import { applyTheme, DEFAULT_THEME, loadTheme, saveTheme, type Theme } from './theme'
import { loadSettings, saveSettings, liveUrl, type AppSettings } from './settings'
import { slugify, uniqueSlug } from './slug'

// A saved rail width (rem), or null to use the responsive CSS default
// (clamp on --rail-w) - so by default the feed scales with the screen, and a
// drag-to-resize pins an explicit width.
const loadRail = (): number | null => {
    const v = parseFloat(localStorage.getItem('scribe-rail') || '')
    return Number.isFinite(v) ? v : null
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
    // A failed save the user must know about: 'auth' (signed out) or 'offline'
    // (server unreachable, retrying). Drives the prominent banner.
    const [saveError, setSaveError] = useState<SaveErrorReason | null>(null)
    const [publishOpen, setPublishOpen] = useState(false)
    const [publishDiff, setPublishDiff] = useState<PublishChange[] | null>(null)
    const [publishPhase, setPublishPhase] = useState<PublishPhase>('review')
    const [publishResult, setPublishResult] = useState(0)
    const [publishError, setPublishError] = useState<string | null>(null)
    const [sync, setSync] = useState<SyncStatus | null>(null)
    const [syncRetrying, setSyncRetrying] = useState(false)
    const [drawer, setDrawer] = useState(false)
    const [details, setDetails] = useState(false)
    const [settingsOpen, setSettingsOpen] = useState(false)
    const [setupOpen, setSetupOpen] = useState(false)
    const [editMode, setEditMode] = useState(false)
    const [cascade, setCascade] = useState<Cascade | null>(null)
    const [orphan, setOrphan] = useState<Orphan | null>(null)
    // A concurrent-edit conflict on the open resource: the file changed elsewhere
    // since we read it. Autosave pauses until the user reloads or overwrites.
    const [conflict, setConflict] = useState<{ collection: string; slug: string; theirs: Resource } | null>(null)
    // Bumped to force the open editor to remount (e.g. after taking "theirs").
    const [reloadNonce, setReloadNonce] = useState(0)
    const [modal, setModal] = useState<{ open: boolean; mode: 'new' | 'edit' }>({ open: false, mode: 'new' })
    const [theme, setTheme] = useState<Theme>(loadTheme)
    const [settings, setSettings] = useState<AppSettings>(loadSettings)
    const [loadError, setLoadError] = useState<string | null>(null)
    const [caps, setCaps] = useState<Capabilities | null>(null)
    // localStorage edits that never reached the server (auth loss / crash), read
    // once at mount before any save can clear them. Surfaced via DraftRecovery.
    const [drafts] = useState<Draft[]>(() => listDrafts())
    const [recoverResolved, setRecoverResolved] = useState<Set<string>>(() => new Set())
    const [recoverClosed, setRecoverClosed] = useState(false)
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

    // Browser tab title reflects what you're editing, so history/back is legible.
    const kindOf = (v: CollectionView) => (v.experience === 'blog-post' ? 'post' : v.experience === 'tag' ? 'tag' : v.label)
    const docTitle = view && active ? `${view.feedTitle(active)} · ${kindOf(view)} · scribe` : view ? `${view.label} · scribe` : 'scribe'
    useEffect(() => { document.title = docTitle }, [docTitle])

    // Read-only data access for the reference picker, tag experience, etc.
    const dataApi = useMemo<DataApi>(() => ({
        list: (c) => lists[c] ?? [],
        labelFor: (c, slug) => {
            const v = views.find((x) => x.name === c)
            const r = (lists[c] ?? []).find((x) => x.slug === slug)
            return r && v ? v.feedTitle(r) : slug
        },
        referencers: (target, slug) => {
            const out: { collection: string; slug: string; field: string }[] = []
            for (const v of views) {
                for (const [role, t] of Object.entries(v.references)) {
                    if (t !== target) continue
                    const field = v.map[role]
                    if (!field) continue
                    for (const r of lists[v.name] ?? []) {
                        if (flist(r, field).includes(slug)) out.push({ collection: v.name, slug: r.slug, field })
                    }
                }
            }
            return out
        },
    }), [lists, views])

    // For a collection that is a reference target (e.g. tags), how many resources
    // reference each slug, plus slugs referenced by content but with no resource
    // of their own ("undefined" - loose ends to define or clean up). Null when the
    // active collection isn't referenced by anything.
    const refUsage = useMemo(() => {
        const targets = new Set<string>()
        for (const v of views) for (const t of Object.values(v.references)) targets.add(t)
        if (!targets.has(collection)) return null
        const counts = new Map<string, number>()
        for (const v of views) {
            for (const [role, t] of Object.entries(v.references)) {
                if (t !== collection) continue
                const field = v.map[role]
                if (!field) continue
                for (const r of lists[v.name] ?? []) for (const s of flist(r, field)) counts.set(s, (counts.get(s) ?? 0) + 1)
            }
        }
        const defined = new Set((lists[collection] ?? []).map((r) => r.slug))
        const undefinedSlugs = [...counts.keys()].filter((s) => !defined.has(s)).sort((a, b) => (counts.get(b)! - counts.get(a)!) || a.localeCompare(b))
        return { counts, undefinedSlugs }
    }, [views, lists, collection])

    // Drafts worth recovering: local edits that still diverge from the loaded
    // server copy and haven't been restored/discarded this session.
    const recoverItems = useMemo<RecoverItem[]>(() => {
        if (recoverClosed || drafts.length === 0 || !schema) return []
        return drafts
            .filter((d) => !recoverResolved.has(d.collection + '/' + d.slug))
            .map((d) => {
                const server = (lists[d.collection] ?? []).find((r) => r.slug === d.slug)
                const v = views.find((x) => x.name === d.collection)
                const r = server ?? d.resource
                return { draft: d, server, label: v ? v.feedTitle(r) : fstr(r, 'title') || d.slug }
            })
            .filter((it) => recoverableDraft(it.draft, it.server))
    }, [drafts, recoverResolved, recoverClosed, lists, schema, views])

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
    // Read-only (hides block drag handles etc.) applies to the post writing
    // surface in view mode. Form experiences (tag, generic) are always editable.
    const formExp = view ? view.experience !== 'blog-post' : false
    useEffect(() => { document.body.classList.toggle('is-readonly', !editMode && !formExp) }, [editMode, formExp])
    useEffect(() => { if (railW.current != null) document.documentElement.style.setProperty('--rail-w', railW.current + 'rem') }, [])

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
                names.forEach((c, i) => {
                    nextLists[c] = results[i] ?? []
                    firstSel[c] = results[i]?.[0]?.slug ?? null
                    for (const r of nextLists[c]) saver.seed(c, r.slug, r.version)
                })
                const init = parseHash()
                const start = init.collection && names.includes(init.collection) ? init.collection : sch.primary || names[0]
                if (init.slug && nextLists[start]?.some((r) => r.slug === init.slug)) firstSel[start] = init.slug
                setSchema(sch); setMapping(map); setLists(nextLists); setSel(firstSel); setCollection(start)
                writeHash(start, firstSel[start], true)
            })
            .catch((e) => setLoadError(e instanceof Error ? e.message : String(e)))
        api.capabilities().then(setCaps).catch(() => {})
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

    // The single autosave path. The Saver serializes writes, tracks the server
    // version per resource (so a burst of edits during a slow save can't send a
    // stale version and trigger a bogus 409), retries transient failures, and
    // surfaces auth/offline failures instead of swallowing them.
    const saverRef = useRef<Saver | null>(null)
    if (!saverRef.current) {
        saverRef.current = new Saver({
            onState: (s) => {
                switch (s.kind) {
                    case 'idle': setStatus('idle'); setSaveError(null); break
                    case 'dirty': setStatus('edited'); setSaveError(null); break
                    case 'saving': setStatus('saving'); setSaveError(null); break
                    case 'saved': setStatus('saved'); setSaveError(null); break
                    case 'error': setStatus('error'); setSaveError(s.reason); break
                }
            },
            onSaved: (c, saved) => {
                setLists((cur) => ({ ...cur, [c]: (cur[c] ?? []).map((r) => (r.slug === saved.slug ? saved : r)) }))
                clearDraft(c, saved.slug) // persisted; drop the local safety copy
            },
            onConflict: (c, slug, theirs) => setConflict({ collection: c, slug, theirs }),
        })
    }
    const saver = saverRef.current

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
            writeDraft(collection, merged) // local safety net before the network round-trip
            saver.request(collection, merged)
        },
        [active, collection, saver],
    )

    // Take the server's version: replace local state, drop the local draft, and
    // remount the editor. The saver adopts the server's version so the next edit
    // saves cleanly.
    const resolveConflictReload = useCallback(() => {
        if (!conflict) return
        const { collection: c, theirs } = conflict
        setLists((cur) => ({ ...cur, [c]: (cur[c] ?? []).map((r) => (r.slug === theirs.slug ? theirs : r)) }))
        clearDraft(c, theirs.slug)
        setConflict(null)
        setReloadNonce((n) => n + 1)
        saver.acceptTheirs(c, theirs.slug, theirs.version)
    }, [conflict, saver])

    // Keep my version: force-save current edits past the version check.
    const resolveConflictOverwrite = useCallback(() => {
        if (!conflict) return
        const { collection: c, slug } = conflict
        const mine = (lists[c] ?? []).find((r) => r.slug === slug)
        setConflict(null)
        if (!mine) return
        saver.overwrite(c, mine)
    }, [conflict, lists, saver])

    // "Done" must verify the work actually landed before dropping back to the
    // read-only view. flushAndWait forces any pending save and resolves false if
    // it failed or hit a conflict - in which case the error/conflict banner is up
    // and the status reads "not saved", so Done never implies a false success.
    const toggleEdit = useCallback(async () => {
        if (!editMode) { setEditMode(true); return }
        await saver.flushAndWait()
        setEditMode(false)
    }, [editMode, saver])

    // Restore a recovered draft: load it into state, open it for editing, and
    // re-queue the save so it lands. Discard just drops the local copy.
    const restoreDraft = useCallback((it: RecoverItem) => {
        const { collection: c, resource } = it.draft
        const k = c + '/' + resource.slug
        setLists((cur) => {
            const have = (cur[c] ?? []).some((r) => r.slug === resource.slug)
            const nextList = have ? cur[c].map((r) => (r.slug === resource.slug ? resource : r)) : [resource, ...(cur[c] ?? [])]
            return { ...cur, [c]: nextList }
        })
        setCollection(c); setSel((s) => ({ ...s, [c]: resource.slug })); writeHash(c, resource.slug); setEditMode(true)
        setRecoverResolved((s) => new Set(s).add(k))
        saver.request(c, resource)
    }, [saver])

    const discardDraft = useCallback((it: RecoverItem) => {
        clearDraft(it.draft.collection, it.draft.slug)
        setRecoverResolved((s) => new Set(s).add(it.draft.collection + '/' + it.draft.slug))
    }, [])

    // How many resources have unpublished (staged) changes, across collections.
    const stagedCount = useMemo(
        () => Object.values(lists).reduce((n, rs) => n + rs.filter((r) => r.state === 'staged').length, 0),
        [lists],
    )

    // Re-pull every collection (after a publish, states flip back to promoted).
    const refetchAll = useCallback(async () => {
        if (!schema) return
        const names = schema.collections.map((c) => c.name)
        const results = await Promise.all(names.map((c) => api.list(c)))
        setLists((cur) => {
            const next: Record<string, Resource[]> = { ...cur }
            names.forEach((c, i) => {
                next[c] = results[i] ?? []
                for (const r of next[c]) saver.seed(c, r.slug, r.version)
            })
            return next
        })
    }, [schema, saver])

    // Publish = review the whole staged changeset, then commit + push it atomically.
    const openPublish = useCallback(async () => {
        setPublishPhase('review'); setPublishError(null); setPublishDiff(null); setPublishOpen(true)
        try {
            const d = await api.publishDiff()
            setPublishDiff(d.changes)
        } catch (e) {
            setPublishPhase('error'); setPublishError(e instanceof Error ? e.message : String(e))
        }
    }, [])

    const confirmPublish = useCallback(async () => {
        setPublishPhase('publishing'); setPublishError(null)
        try {
            const res = await api.publish()
            await refetchAll()
            setPublishResult(res.published); setPublishPhase('done'); setStatus('saved')
        } catch (e) {
            setPublishPhase('error'); setPublishError(e instanceof Error ? e.message : String(e))
        }
    }, [refetchAll])

    const retrySync = useCallback(async () => {
        setSyncRetrying(true)
        try { setSync(await api.syncNow()) } catch { /* surfaced via next poll */ }
        setSyncRetrying(false)
    }, [])

    // Don't pull-refetch over an in-progress edit (would revert unsaved text).
    const editingRef = useRef(false)
    useEffect(() => { editingRef.current = editMode || status === 'edited' || status === 'saving' || status === 'error' || saver.dirty }, [editMode, status, saver])

    // Poll git sync status: a changed rev means content moved (an external Pages
    // CMS edit was pulled in) -> refetch; a conflict raises the banner.
    const lastRevRef = useRef<string | null>(null)
    useEffect(() => {
        let alive = true
        const poll = async () => {
            try {
                const s = await api.syncStatus()
                if (!alive) return
                setSync(s)
                if (s.state === 'disabled' || !s.rev) return
                if (lastRevRef.current === null) { lastRevRef.current = s.rev; return }
                if (s.rev !== lastRevRef.current) {
                    lastRevRef.current = s.rev
                    if (!editingRef.current) refetchAll()
                }
            } catch { /* transient; next tick retries */ }
        }
        poll()
        const id = window.setInterval(poll, 20000)
        return () => { alive = false; window.clearInterval(id) }
    }, [refetchAll])

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
            const rewritten = flist(r, ref.field)
                .flatMap((s) => (s === from ? (to ? [to] : []) : [s]))
            const next = Array.from(new Set(rewritten)) // dedupe: reassigning into an existing slug
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

    // Materialize a resource for a slug that's referenced by content but has no
    // file yet (an "undefined" tag). Seeds a titleized name, then opens it.
    const defineRef = useCallback(async (c: string, slug: string) => {
        const v = views.find((x) => x.name === c)
        if (!v) return
        const nameField = v.map.title || v.map.name
        const title = slug.replace(/-/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase())
        const fresh: Resource = {
            collection: c, slug, body: '', state: 'staged', dirty: false, notes: '',
            fields: nameField ? { [nameField]: title } : {},
        }
        try {
            const saved = await api.save(c, slug, fresh)
            setLists((cur) => ({ ...cur, [c]: [saved, ...(cur[c] ?? [])] }))
            openResource(c, slug)
        } catch (e) { alert(`Couldn't create: ${e instanceof Error ? e.message : e}`) }
    }, [views, openResource])

    // Resolve an orphaned reference (a slug used by content with no resource):
    // create it, reassign those references to another slug, or strip it.
    const createOrphan = useCallback(async (c: string, slug: string) => {
        setOrphan(null)
        await defineRef(c, slug)
    }, [defineRef])
    const reassignOrphan = useCallback(async (c: string, slug: string, to: string) => {
        setOrphan(null)
        try { await updateReferencers(findReferencers(c, slug), slug, to) }
        catch (e) { alert(`Couldn't reassign: ${e instanceof Error ? e.message : e}`) }
    }, [findReferencers, updateReferencers])
    const removeOrphan = useCallback(async (c: string, slug: string) => {
        setOrphan(null)
        try { await updateReferencers(findReferencers(c, slug), slug, null) }
        catch (e) { alert(`Couldn't remove: ${e instanceof Error ? e.message : e}`) }
    }, [findReferencers, updateReferencers])

    const onModalSubmit = useCallback(
        async (title: string, slug: string) => {
            if (modal.mode === 'new') await createPost(title, slug)
            else await applyTitleEdit(title, slug)
            setModal((m) => ({ ...m, open: false }))
        },
        [modal.mode, createPost, applyTitleEdit],
    )

    const select = useCallback((slug: string) => {
        setSel((cur) => ({ ...cur, [collection]: slug })); writeHash(collection, slug); setEditMode(false); setStatus('idle'); setDrawer(false); setConflict(null)
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
        <UploadContext.Provider value={{ externalEnabled: caps?.upload.external ?? false, collection, slug: activeSlug ?? '' }}>
        <SyncBanner status={sync} retrying={syncRetrying} onRetry={retrySync} />
        {saveError && <SaveErrorBanner reason={saveError} />}
        {conflict && active && (
            <ConflictBanner
                title={view ? view.feedTitle(active) : conflict.slug}
                onReload={resolveConflictReload}
                onOverwrite={resolveConflictOverwrite}
            />
        )}
        <div className={'app' + (drawer ? ' app--drawer' : '')}>
            <div className="app__nav">
                <CollectionRail views={views} active={collection} onSelect={switchCollection} onSettings={() => setSettingsOpen(true)} />
                <div className="app__feed">
                    {view && <Feed view={view} items={items} activeSlug={activeSlug} allTags={allTags} refUsage={refUsage} onSelect={select} onNew={onNew} onResolveUndefined={(c, slug) => setOrphan({ collection: c, slug })} />}
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
                    stagedCount={stagedCount}
                    publishing={publishPhase === 'publishing'}
                    liveUrl={active && view ? liveUrl(settings.hostedDomain, view.livePath(active)) : null}
                    onMenu={() => setDrawer((d) => !d)}
                    onToggleEdit={toggleEdit}
                    onDetails={() => setDetails(true)}
                    onPublish={openPublish}
                />
                <div className={'app__canvas' + (collection === 'posts' ? '' : ' app__canvas--form')}>
                    {active && view && Experience ? (
                        <Experience key={`reload-${reloadNonce}`} resource={active} def={view.def} map={view.map} references={view.references} onPatch={patch} onEditTitle={() => setModal({ open: true, mode: 'edit' })} onRename={rename} onDelete={deleteActive} onOpenRef={openResource} editable={editMode} />
                    ) : (
                        <div className="empty">{view ? `Nothing here yet. Press “${view.newLabel}”.` : 'Loading…'}</div>
                    )}
                </div>
            </main>

            {view?.hasDetails && (
                <PublishSheet resource={active} map={view.map} references={view.references} def={view.def} open={details} onClose={() => setDetails(false)} onPatch={patch} onRename={rename} onDelete={deleteActive} onOpenRef={openResource} />
            )}
            {recoverItems.length > 0 && (
                <DraftRecovery items={recoverItems} onRestore={restoreDraft} onDiscard={discardDraft} onClose={() => setRecoverClosed(true)} />
            )}
            <CascadeDialog cascade={cascade} onResolve={runCascade} onCancel={() => setCascade(null)} />
            <OrphanDialog orphan={orphan} onCreate={createOrphan} onReassign={reassignOrphan} onRemove={removeOrphan} onCancel={() => setOrphan(null)} />
            <PublishReview
                open={publishOpen}
                diff={publishDiff}
                phase={publishPhase}
                result={publishResult}
                error={publishError}
                onConfirm={confirmPublish}
                onClose={() => setPublishOpen(false)}
            />
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
        </UploadContext.Provider>
        </DataContext.Provider>
    )
}
