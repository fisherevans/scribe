import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './mock'
import type { Post } from './types'
import { Editor } from './editor/Editor'
import { Feed } from './components/Feed'
import { TopBar, type SaveStatus } from './components/TopBar'
import { PublishSheet } from './components/PublishSheet'

export default function App() {
    const [posts, setPosts] = useState<Post[]>([])
    const [activeSlug, setActiveSlug] = useState<string | null>(null)
    const [status, setStatus] = useState<SaveStatus>('idle')
    const [promoting, setPromoting] = useState(false)
    const [drawer, setDrawer] = useState(false)
    const [details, setDetails] = useState(false)
    const saveTimer = useRef<number | null>(null)

    const active = posts.find((p) => p.slug === activeSlug) ?? null

    useEffect(() => {
        api.list().then((ps) => {
            setPosts(ps)
            setActiveSlug(ps[0]?.slug ?? null)
        })
    }, [])

    // Debounced autosave -> staging. Edits mark the buffer dirty immediately,
    // then settle to "staged" once the (mock) commit lands.
    const queueSave = useCallback((slug: string, patch: Partial<Post>) => {
        setStatus('edited')
        if (saveTimer.current) window.clearTimeout(saveTimer.current)
        saveTimer.current = window.setTimeout(async () => {
            setStatus('saving')
            const next = await api.save(slug, { ...patch, state: 'staged' })
            setPosts((cur) => cur.map((p) => (p.slug === slug ? next : p)))
            setStatus('saved')
        }, 650)
    }, [])

    const patch = useCallback(
        (p: Partial<Post>) => {
            if (!active) return
            const slug = active.slug
            setPosts((cur) => cur.map((x) => (x.slug === slug ? { ...x, ...p, dirty: true } : x)))
            queueSave(slug, p)
        },
        [active, queueSave],
    )

    const promote = useCallback(async () => {
        if (!active) return
        setPromoting(true)
        const next = await api.promote(active.slug)
        setPosts((cur) => cur.map((p) => (p.slug === next.slug ? next : p)))
        setPromoting(false)
        setStatus('saved')
    }, [active])

    const create = useCallback(async () => {
        const fresh = await api.create()
        setPosts((cur) => [fresh, ...cur])
        setActiveSlug(fresh.slug)
        setStatus('idle')
        setDrawer(false)
    }, [])

    const select = useCallback((slug: string) => {
        setActiveSlug(slug)
        setStatus('idle')
        setDrawer(false)
    }, [])

    return (
        <div className={'app' + (drawer ? ' app--drawer' : '')}>
            <div className="app__rail">
                <Feed posts={posts} activeSlug={activeSlug} onSelect={select} onNew={create} />
            </div>
            <div className="app__scrim" onClick={() => setDrawer(false)} />

            <main className="app__main">
                <TopBar
                    post={active}
                    status={status}
                    promoting={promoting}
                    onMenu={() => setDrawer((d) => !d)}
                    onDetails={() => setDetails(true)}
                    onPromote={promote}
                />
                <div className="app__canvas">
                    {active ? (
                        <Editor
                            slug={active.slug}
                            title={active.title}
                            body={active.body}
                            onTitle={(title) => patch({ title })}
                            onBody={(body) => patch({ body })}
                        />
                    ) : (
                        <div className="empty">Pick a post, or press “+ write”.</div>
                    )}
                </div>
            </main>

            <PublishSheet post={active} open={details} onClose={() => setDetails(false)} onPatch={patch} />
        </div>
    )
}
