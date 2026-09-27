import { useRef, useState } from 'react'
import { api } from '../api'

// A note's photos: a list of { src, alt } objects, stored in frontmatter and
// uploaded to the site's external CDN. Kept separate from the markdown body
// because a note is photo-first - the pictures are the entry, not illustrations
// inside prose - and the site renders them as a gallery above or below the
// caption depending on how long the caption is.
export interface NoteImage {
    src: string
    alt?: string
}

interface Props {
    images: NoteImage[]
    editable: boolean
    slug: string
    onChange: (images: NoteImage[]) => void
}

export function NoteGallery({ images, editable, slug, onChange }: Props) {
    const fileRef = useRef<HTMLInputElement>(null)
    const [busy, setBusy] = useState(0)
    const [error, setError] = useState<string | null>(null)

    async function add(files: FileList | null) {
        if (!files || !files.length) return
        setError(null)
        setBusy((n) => n + files.length)
        const added: NoteImage[] = []
        for (const file of Array.from(files)) {
            try {
                const { url } = await api.upload(file, { dest: 'external', slug })
                added.push({ src: url })
            } catch (e) {
                setError(e instanceof Error ? e.message : 'upload failed')
            } finally {
                setBusy((n) => n - 1)
            }
        }
        if (added.length) onChange([...images, ...added])
    }

    const move = (i: number, by: number) => {
        const next = [...images]
        const j = i + by
        if (j < 0 || j >= next.length) return
        ;[next[i], next[j]] = [next[j], next[i]]
        onChange(next)
    }

    if (!editable && images.length === 0) return null

    return (
        <div className="gallery">
            {images.length > 0 && (
                <div className="gallery__grid">
                    {images.map((img, i) => (
                        <figure className="gallery__item" key={img.src + i}>
                            <img className="gallery__img" src={img.src} alt={img.alt ?? ''} loading="lazy" />
                            {editable ? (
                                <>
                                    <input
                                        className="gallery__alt"
                                        value={img.alt ?? ''}
                                        placeholder="alt text"
                                        onChange={(e) => {
                                            const next = [...images]
                                            next[i] = { ...next[i], alt: e.target.value }
                                            onChange(next)
                                        }}
                                    />
                                    <div className="gallery__tools">
                                        <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move earlier">←</button>
                                        <button type="button" onClick={() => move(i, 1)} disabled={i === images.length - 1} aria-label="Move later">→</button>
                                        <button type="button" onClick={() => onChange(images.filter((_, k) => k !== i))} aria-label="Remove">×</button>
                                    </div>
                                </>
                            ) : (
                                img.alt && <figcaption className="gallery__cap">{img.alt}</figcaption>
                            )}
                        </figure>
                    ))}
                </div>
            )}
            {editable && (
                <div className="gallery__add">
                    <button type="button" className="gallery__addbtn" onClick={() => fileRef.current?.click()} disabled={busy > 0}>
                        {busy > 0 ? `uploading ${busy}…` : '+ add photos'}
                    </button>
                    {error && <span className="gallery__err">{error}</span>}
                    <input
                        ref={fileRef}
                        type="file"
                        accept="image/*"
                        multiple
                        hidden
                        onChange={(e) => {
                            void add(e.target.files)
                            e.target.value = ''
                        }}
                    />
                </div>
            )}
        </div>
    )
}
