import { AnimatePresence, motion } from 'framer-motion'
import { createPortal } from 'react-dom'
import { useEffect, useRef, useState } from 'react'
import type { MediaItem } from '../api'
import { api } from '../api'
import { UploadStager } from './UploadStager'
import { useUploadEnv } from './uploadContext'

export interface ImageDraft {
    src: string
    alt: string
    caption: string
}

// Structured editor for an image block, opened as a modal instead of inline
// forms (which lingered after leaving edit mode and had no room for replace /
// browse). Shows the live preview, the source, alt text, and an optional
// caption - supplying a caption is the only thing that makes it a "figure".
// Replace pulls in the upload flow; Browse lists images already in the repo.
export function ImageEditModal({
    initial,
    stagedFile,
    onApply,
    onCancel,
}: {
    initial: ImageDraft
    stagedFile?: File
    onApply: (draft: ImageDraft) => void
    onCancel: () => void
}) {
    const env = useUploadEnv()
    const [src, setSrc] = useState(initial.src)
    const [alt, setAlt] = useState(initial.alt)
    const [caption, setCaption] = useState(initial.caption)
    const [pendingFile, setPendingFile] = useState<File | undefined>(stagedFile)
    const [panel, setPanel] = useState<'none' | 'upload' | 'browse'>(stagedFile ? 'upload' : 'none')
    const [media, setMedia] = useState<MediaItem[] | null>(null)
    const fileRef = useRef<HTMLInputElement>(null)

    const pickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        e.target.value = ''
        if (!file) return
        setPendingFile(file)
        setPanel('upload')
    }

    useEffect(() => {
        if (panel !== 'browse' || media) return
        api.media(env.slug).then((r) => setMedia(r.items)).catch(() => setMedia([]))
    }, [panel, media, env.slug])

    const done = () => {
        if (!src.trim()) return
        onApply({ src: src.trim(), alt: alt.trim(), caption: caption.trim() })
    }

    return createPortal(
        <AnimatePresence>
            <motion.div className="scrim" onClick={onCancel} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
            <motion.div
                className="modal modal--image"
                initial={{ opacity: 0, scale: 0.96, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 8 }}
                transition={{ duration: 0.16 }}
                onKeyDown={(e) => {
                    if (e.key === 'Escape') onCancel()
                }}>
                <div className="modal__title">{initial.src ? 'Edit image' : 'Add image'}</div>

                {panel === 'upload' && pendingFile ? (
                    <UploadStager
                        file={pendingFile}
                        onDone={(url) => {
                            setSrc(url)
                            setPendingFile(undefined)
                            setPanel('none')
                        }}
                        onCancel={() => {
                            setPendingFile(undefined)
                            setPanel('none')
                        }}
                    />
                ) : panel === 'browse' ? (
                    <div className="imgbrowse">
                        {media === null ? (
                            <div className="imgbrowse__empty">Loading…</div>
                        ) : media.length === 0 ? (
                            <div className="imgbrowse__empty">No images in the repo yet.</div>
                        ) : (
                            <div className="imgbrowse__grid">
                                {media.map((m) => (
                                    <button
                                        key={m.url}
                                        type="button"
                                        className={'imgbrowse__item' + (m.url === src ? ' is-active' : '')}
                                        title={m.name}
                                        onClick={() => {
                                            setSrc(m.url)
                                            setPanel('none')
                                        }}>
                                        <img src={m.url} alt="" loading="lazy" />
                                        <span className="imgbrowse__name">{m.name}</span>
                                    </button>
                                ))}
                            </div>
                        )}
                        <div className="modal__actions">
                            <button type="button" className="btn" onClick={() => setPanel('none')}>back</button>
                        </div>
                    </div>
                ) : (
                    <>
                        <div className="imgedit__preview" data-empty={src ? undefined : 'true'}>
                            {src ? <img src={src} alt={alt} /> : <span>No image yet - upload, browse, or paste a URL.</span>}
                        </div>

                        <div className="imgedit__sourcebar">
                            <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
                                {src ? 'Replace…' : 'Upload…'}
                            </button>
                            <button type="button" className="btn" onClick={() => setPanel('browse')}>Browse repo…</button>
                            <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickFile} />
                        </div>

                        <label className="modal__field">
                            <span className="modal__label">source <span className="modal__hint">URL or /assets/uploads/…</span></span>
                            <input className="modal__input modal__input--mono" value={src} spellCheck={false} placeholder="https://… or /assets/uploads/…" onChange={(e) => setSrc(e.target.value)} />
                        </label>

                        <label className="modal__field">
                            <span className="modal__label">alt text <span className="modal__hint">describes the image for screen readers / when it fails to load</span></span>
                            <input className="modal__input" value={alt} placeholder="A short description" onChange={(e) => setAlt(e.target.value)} />
                        </label>

                        <label className="modal__field">
                            <span className="modal__label">caption <span className="modal__hint">optional subtitle shown under the image; adding one makes it a figure</span></span>
                            <input className="modal__input" value={caption} placeholder="Leave blank for a plain image" onChange={(e) => setCaption(e.target.value)} />
                        </label>

                        <div className="modal__actions">
                            <button type="button" className="btn" onClick={onCancel}>cancel</button>
                            <button type="button" className="btn btn--promote" onClick={done} disabled={!src.trim()}>done</button>
                        </div>
                    </>
                )}
            </motion.div>
        </AnimatePresence>,
        document.body,
    )
}
