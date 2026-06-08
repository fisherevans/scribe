import { useMemo, useState } from 'react'
import { useData } from '../data'
import { slugify } from '../slug'

interface Props {
    target: string // collection this field references
    value: string[] // selected slugs
    onChange: (slugs: string[]) => void
    onOpen?: (slug: string) => void // navigate to the referenced resource
}

// Generalized tag chips: a reference picker that autocompletes against another
// collection. Stores slugs, displays each referenced resource's label. Typing a
// new value adds it as a slug (a forward reference, like a not-yet-created tag).
export function ReferencePicker({ target, value, onChange, onOpen }: Props) {
    const data = useData()
    const [draft, setDraft] = useState('')
    const [focus, setFocus] = useState(false)

    const suggestions = useMemo(() => {
        const q = draft.trim().toLowerCase()
        return data
            .list(target)
            .filter((r) => !value.includes(r.slug) && (q === '' || data.labelFor(target, r.slug).toLowerCase().includes(q) || r.slug.includes(q)))
            .slice(0, 8)
    }, [data, target, value, draft])

    const add = (slug: string) => {
        const s = slug.trim()
        if (s && !value.includes(s)) onChange([...value, s])
        setDraft('')
    }

    return (
        <div className="field refpicker">
            <div className="chips">
                {value.map((slug) => (
                    <span key={slug} className="chip">
                        {onOpen ? (
                            <button className="chip__label" type="button" title="open" onClick={() => onOpen(slug)}>{data.labelFor(target, slug)}</button>
                        ) : (
                            <span className="chip__label">{data.labelFor(target, slug)}</span>
                        )}
                        <button className="chip__x" type="button" title="remove" onClick={() => onChange(value.filter((x) => x !== slug))}>✕</button>
                    </span>
                ))}
                <input
                    className="chips__input"
                    value={draft}
                    placeholder={value.length ? 'add…' : `add a ${target.replace(/s$/, '')}…`}
                    onChange={(e) => setDraft(e.target.value)}
                    onFocus={() => setFocus(true)}
                    onBlur={() => setTimeout(() => setFocus(false), 120)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(suggestions[0]?.slug ?? slugify(draft)) }
                        else if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1))
                    }}
                />
            </div>
            {focus && suggestions.length > 0 && (
                <div className="suggest">
                    {suggestions.map((r) => (
                        <button key={r.slug} type="button" className="suggest__item" onMouseDown={(e) => { e.preventDefault(); add(r.slug) }}>
                            {data.labelFor(target, r.slug)}
                        </button>
                    ))}
                </div>
            )}
        </div>
    )
}
