import { useMemo, useState } from 'react'
import { api } from '../api'
import { useUploadEnv } from './uploadContext'

// Staging UI for a pending image: preview + an editable filename + a destination
// choice (external CDN vs in-repo page content), uploading only on confirm. The
// chosen name becomes the real stored filename, so renaming here actually
// renames the object - unlike editing the URL after the fact. Shared by the
// image block and the figure node.
export function UploadStager({ file, onDone, onCancel }: { file: File; onDone: (url: string) => void; onCancel: () => void }) {
    const env = useUploadEnv()
    const preview = useMemo(() => URL.createObjectURL(file), [file])
    const ext = useMemo(() => {
        const dot = file.name.lastIndexOf('.')
        return dot > 0 ? file.name.slice(dot).toLowerCase() : ''
    }, [file])
    const [name, setName] = useState(() => (ext ? file.name.slice(0, file.name.length - ext.length) : file.name) || 'image')
    const [dest, setDest] = useState<'external' | 'local'>(env.externalEnabled ? 'external' : 'local')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const upload = async () => {
        setBusy(true)
        setError(null)
        try {
            const { url } = await api.upload(file, { dest, name: name.trim(), slug: env.slug })
            URL.revokeObjectURL(preview)
            onDone(url)
        } catch (err) {
            setError((err as Error)?.message ?? String(err))
            setBusy(false)
        }
    }

    return (
        <div className="stager" contentEditable={false}>
            <img className="stager__preview" src={preview} alt="" />
            <div className="stager__form">
                <label className="stager__namerow">
                    <input
                        className="blockinput stager__name"
                        value={name}
                        spellCheck={false}
                        disabled={busy}
                        placeholder="filename"
                        onChange={(e) => setName(e.target.value)}
                    />
                    {ext && <span className="stager__ext">{ext}</span>}
                </label>

                {env.externalEnabled && (
                    <div className="stager__dest" role="radiogroup" aria-label="upload destination">
                        <button
                            type="button"
                            className={'stager__destbtn' + (dest === 'external' ? ' is-active' : '')}
                            disabled={busy}
                            onClick={() => setDest('external')}>
                            External CDN
                        </button>
                        <button
                            type="button"
                            className={'stager__destbtn' + (dest === 'local' ? ' is-active' : '')}
                            disabled={busy}
                            onClick={() => setDest('local')}>
                            Page content
                        </button>
                    </div>
                )}

                {error && <div className="stager__error">{error}</div>}

                <div className="stager__actions">
                    <button type="button" className="blockupload" disabled={busy || !name.trim()} onClick={upload}>
                        {busy ? 'uploading…' : `upload${env.externalEnabled ? '' : ' to page content'}`}
                    </button>
                    <button type="button" className="stager__cancel" disabled={busy} onClick={onCancel}>
                        cancel
                    </button>
                </div>
            </div>
        </div>
    )
}
