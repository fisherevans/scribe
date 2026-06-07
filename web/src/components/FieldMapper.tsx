import type { CollectionDef } from '../types'
import type { CollectionMapping } from '../mapping'
import { mapFieldsFor } from '../mapping'
import { EXPERIENCE_IDS, MODELS, type RoleDef } from '../experiences/models'

interface Props {
    def: CollectionDef
    value: CollectionMapping
    onChange: (m: CollectionMapping) => void
}

// The field mapper: bind an experience's roles to a collection's real fields.
// Three buckets - required (must bind), optional (bound where present), and raw
// (everything left over, carried as-is). The visible face of .scribe.yml.
export function FieldMapper({ def, value, onChange }: Props) {
    const model = MODELS[value.experience] ?? MODELS.generic
    const required = model.roles.filter((r) => r.required)
    const optional = model.roles.filter((r) => !r.required)
    const mapped = new Set(Object.values(value.fields))
    const raw = def.fields.filter((f) => !mapped.has(f.name))

    const setExperience = (exp: string) => onChange({ experience: exp, fields: mapFieldsFor(exp, def) })
    const setRole = (role: string, field: string) => {
        const fields = { ...value.fields }
        if (field) fields[role] = field
        else delete fields[role]
        onChange({ ...value, fields })
    }

    const row = (role: RoleDef) => {
        const bound = value.fields[role.role]
        const status = bound ? 'ok' : role.required ? 'miss' : 'none'
        return (
            <div className="maprow" key={role.role}>
                <span className="maprow__role">
                    {role.label} <span className="maprow__ty">{role.type}{role.list ? '[]' : ''}</span>
                </span>
                <span className="maprow__arrow">←</span>
                <select className={'maprow__src maprow__src--' + status} value={bound ?? ''} onChange={(e) => setRole(role.role, e.target.value)}>
                    <option value="">— not mapped —</option>
                    {def.fields.map((f) => (
                        <option key={f.name} value={f.name}>{f.name} ({f.type}{f.list ? '[]' : ''})</option>
                    ))}
                </select>
            </div>
        )
    }

    return (
        <div className="mapper">
            <div className="mapper__head">
                <span className="mapper__col">{def.label || def.name}</span>
                <span className="mapper__to">edited as</span>
                <select className="mapper__exp" value={value.experience} onChange={(e) => setExperience(e.target.value)}>
                    {EXPERIENCE_IDS.map((id) => <option key={id} value={id}>{MODELS[id].label}</option>)}
                </select>
            </div>

            {required.length > 0 && (
                <div className="mbucket mbucket--req">
                    <div className="mbucket__h">● required — must bind</div>
                    {required.map(row)}
                </div>
            )}
            {optional.length > 0 && (
                <div className="mbucket mbucket--opt">
                    <div className="mbucket__h">○ optional — bound where present</div>
                    {optional.map(row)}
                </div>
            )}
            <div className="mbucket mbucket--raw">
                <div className="mbucket__h">▢ raw — carried as-is ({raw.length})</div>
                {raw.length > 0 ? (
                    <div className="mraw">{raw.map((f) => <span key={f.name} className="mraw__chip">{f.name} · {f.type}{f.list ? '[]' : ''}</span>)}</div>
                ) : (
                    <div className="mbucket__none">nothing left over</div>
                )}
            </div>
        </div>
    )
}
