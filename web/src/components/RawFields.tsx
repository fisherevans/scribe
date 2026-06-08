import { useMemo, useState } from 'react'
import type { CollectionDef, Resource } from '../types'
import type { ResourcePatch } from '../collections'
import { FieldWidget } from './FieldWidget'

interface Props {
    resource: Resource
    def: CollectionDef
    covered: Set<string> // field names already handled by the experience
    onPatch: (p: ResourcePatch) => void
}

// The raw bucket: every schema field the experience doesn't cover, edited via
// the shared widgets. Hidden behind an "additional fields" reveal (Q3) so it's
// always available but never in the way.
export function RawFields({ resource, def, covered, onPatch }: Props) {
    const [open, setOpen] = useState(false)
    const fields = useMemo(() => def.fields.filter((f) => !covered.has(f.name)), [def, covered])
    if (fields.length === 0) return null
    return (
        <div className="field">
            <button className="advanced__toggle" type="button" onClick={() => setOpen((o) => !o)}>
                {open ? '▾' : '▸'} additional fields <span className="advanced__count">{fields.length}</span>
            </button>
            {open && (
                <div className="advanced">
                    {fields.map((f) => (
                        <div key={f.name} className="field">
                            <span className="field__label">{f.label}</span>
                            <FieldWidget field={f} resource={resource} onChange={(v) => onPatch({ fields: { [f.name]: v } })} />
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}
