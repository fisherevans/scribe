import type { FieldDef } from '../types'
import { fbool, flist, fstr } from '../types'
import type { Resource } from '../types'

interface Props {
    field: FieldDef
    resource: Resource
    onChange: (value: unknown) => void
}

// One editing widget per Pages CMS field type. Shared by the generic experience
// and the "additional fields" raw editor, so every field type is edited the
// same way everywhere. (Upload for image is M7's plugin; for now it's a URL.)
export function FieldWidget({ field, resource, onChange }: Props) {
    if (field.list) {
        return (
            <input
                className="field__input field__input--mono"
                value={flist(resource, field.name).join(', ')}
                placeholder="comma, separated"
                onChange={(e) => onChange(e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
            />
        )
    }
    switch (field.type) {
        case 'boolean':
            return (
                <label className="toggle">
                    <input type="checkbox" checked={fbool(resource, field.name)} onChange={(e) => onChange(e.target.checked)} />
                    <span className="toggle__track" />
                </label>
            )
        case 'select':
            return field.options && field.options.length ? (
                <select className="field__input" value={fstr(resource, field.name)} onChange={(e) => onChange(e.target.value)}>
                    <option value="">—</option>
                    {field.options.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
            ) : (
                <input className="field__input" value={fstr(resource, field.name)} onChange={(e) => onChange(e.target.value)} />
            )
        case 'text':
        case 'rich-text':
        case 'code':
            return <textarea className="field__input" rows={3} value={fstr(resource, field.name)} onChange={(e) => onChange(e.target.value)} />
        case 'image':
            return (
                <>
                    <input className="field__input" value={fstr(resource, field.name)} placeholder="https://… or /…" onChange={(e) => onChange(e.target.value)} />
                    {fstr(resource, field.name) && <img className="field__heropreview" src={fstr(resource, field.name)} alt="" />}
                </>
            )
        case 'number':
            return <input className="field__input" type="number" value={fstr(resource, field.name)} onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} />
        case 'date':
            return <input className="field__input" type="date" value={fstr(resource, field.name)} onChange={(e) => onChange(e.target.value)} />
        default:
            return <input className="field__input" value={fstr(resource, field.name)} onChange={(e) => onChange(e.target.value)} />
    }
}
