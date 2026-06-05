import type { Resource } from '../types'

export interface FieldDef {
    key: string
    label: string
    type: 'text' | 'multiline'
    placeholder?: string
}

interface Props {
    resource: Resource
    onPatch: (p: Partial<Resource>) => void
    fields: FieldDef[]
}

// The fallback for any collection without a bespoke experience. It renders
// inputs straight from a field schema (the same role .pages.yml field types
// play). This is what makes scribe generic: an unknown resource type still
// gets a working editor for free.
export function GenericExperience({ resource, onPatch, fields }: Props) {
    const rec = resource as unknown as Record<string, unknown>
    return (
        <div className="formcard">
            <div className="formcard__head">
                <span className="formcard__kicker">{resource.kind} · generic form</span>
                <span className="formcard__slug">{resource.slug}</span>
            </div>
            {fields.map((f) => (
                <label key={f.key} className="ffield">
                    <span className="ffield__label">{f.label}</span>
                    {f.type === 'multiline' ? (
                        <textarea
                            className="ffield__input"
                            rows={5}
                            value={String(rec[f.key] ?? '')}
                            placeholder={f.placeholder}
                            onChange={(e) => onPatch({ [f.key]: e.target.value } as Partial<Resource>)}
                        />
                    ) : (
                        <input
                            className="ffield__input"
                            value={String(rec[f.key] ?? '')}
                            placeholder={f.placeholder}
                            onChange={(e) => onPatch({ [f.key]: e.target.value } as Partial<Resource>)}
                        />
                    )}
                </label>
            ))}
        </div>
    )
}
