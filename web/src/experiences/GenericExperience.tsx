import type { ExperienceProps } from '../collections'
import { fbool, flist, fstr } from '../types'

// The fallback for any collection without a bespoke experience: an auto-form
// generated straight from the schema's field definitions. This is what makes
// scribe work against an unknown site at a basic level. (M3 replaces these
// inline inputs with the shared field-widget library.)
export function GenericExperience({ resource, def, onPatch, onDelete }: ExperienceProps) {
    const set = (name: string, value: unknown) => onPatch({ fields: { [name]: value } })
    return (
        <div className="formcard">
            <div className="formcard__head">
                <span className="formcard__kicker">{def.name} · generic form</span>
                <span className="formcard__slug">{resource.slug}</span>
            </div>
            {def.fields.map((f) => (
                <label key={f.name} className="ffield">
                    <span className="ffield__label">
                        {f.label} {f.required && <span style={{ color: 'var(--rose)' }}>*</span>}
                    </span>
                    {f.list ? (
                        <input
                            className="ffield__input"
                            value={flist(resource, f.name).join(', ')}
                            placeholder="comma, separated"
                            onChange={(e) => set(f.name, e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
                        />
                    ) : f.type === 'boolean' ? (
                        <label className="toggle">
                            <input type="checkbox" checked={fbool(resource, f.name)} onChange={(e) => set(f.name, e.target.checked)} />
                            <span className="toggle__track" />
                        </label>
                    ) : f.type === 'text' || f.type === 'rich-text' || f.type === 'code' ? (
                        <textarea className="ffield__input" rows={4} value={fstr(resource, f.name)} onChange={(e) => set(f.name, e.target.value)} />
                    ) : (
                        <input
                            className="ffield__input"
                            type={f.type === 'date' ? 'date' : f.type === 'number' ? 'number' : 'text'}
                            value={fstr(resource, f.name)}
                            onChange={(e) => set(f.name, f.type === 'number' ? Number(e.target.value) : e.target.value)}
                        />
                    )}
                </label>
            ))}
            {onDelete && (
                <div className="sheet__danger">
                    <button className="btn btn--danger btn--block" type="button" onClick={onDelete}>
                        🗑 Delete
                    </button>
                </div>
            )}
        </div>
    )
}
