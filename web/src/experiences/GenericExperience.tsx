import type { ExperienceProps } from '../collections'
import { FieldWidget } from '../components/FieldWidget'

// The fallback for any collection without a bespoke experience: an auto-form
// generated from the schema, rendered through the shared field widgets.
export function GenericExperience({ resource, def, onPatch, onDelete }: ExperienceProps) {
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
                    <FieldWidget field={f} resource={resource} onChange={(v) => onPatch({ fields: { [f.name]: v } })} />
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
