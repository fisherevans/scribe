import type { ExperienceProps } from '../collections'
import { fstr } from '../types'

// Tags get a bespoke simple form over the name + description fields.
export function TagExperience({ resource, onPatch, onDelete }: ExperienceProps) {
    return (
        <div className="formcard">
            <div className="formcard__head">
                <span className="formcard__kicker">tag</span>
                <span className="formcard__slug">/tags/{resource.slug}/</span>
            </div>
            <label className="ffield">
                <span className="ffield__label">name</span>
                <input
                    className="ffield__input ffield__input--lg"
                    value={fstr(resource, 'name')}
                    placeholder="Display name"
                    onChange={(e) => onPatch({ fields: { name: e.target.value } })}
                />
            </label>
            <label className="ffield">
                <span className="ffield__label">description</span>
                <textarea
                    className="ffield__input"
                    rows={4}
                    value={fstr(resource, 'description')}
                    placeholder="Shown on the tag's listing page. Optional."
                    onChange={(e) => onPatch({ fields: { description: e.target.value } })}
                />
            </label>
            {onDelete && (
                <div className="sheet__danger">
                    <button className="btn btn--danger btn--block" type="button" onClick={onDelete}>
                        🗑 Delete tag
                    </button>
                </div>
            )}
        </div>
    )
}
