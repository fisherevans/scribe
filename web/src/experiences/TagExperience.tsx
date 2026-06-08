import { useEffect, useState } from 'react'
import type { ExperienceProps } from '../collections'
import { fstr } from '../types'
import { slugify } from '../slug'

// Tags get a bespoke simple form over the mapped name + description fields.
export function TagExperience({ resource, map, onPatch, onRename, onDelete }: ExperienceProps) {
    const nameField = map.name || 'name'
    const descField = map.description || 'description'
    const [slugDraft, setSlugDraft] = useState(resource.slug)
    useEffect(() => setSlugDraft(resource.slug), [resource.slug])
    const commitSlug = () => {
        if (onRename && slugDraft && slugify(slugDraft) !== resource.slug) onRename(resource.slug, slugDraft)
        else setSlugDraft(resource.slug)
    }
    return (
        <div className="formcard">
            <div className="formcard__head">
                <span className="formcard__kicker">tag</span>
                <span className="formcard__slug">/tags/{resource.slug}/</span>
            </div>
            <label className="ffield">
                <span className="ffield__label">slug <span className="ffield__hint">filename · URL · renaming cascades to referencing posts</span></span>
                <input
                    className="ffield__input ffield__input--mono"
                    value={slugDraft}
                    spellCheck={false}
                    onChange={(e) => setSlugDraft(e.target.value)}
                    onBlur={commitSlug}
                    onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
                />
            </label>
            <label className="ffield">
                <span className="ffield__label">name</span>
                <input
                    className="ffield__input ffield__input--lg"
                    value={fstr(resource, nameField)}
                    placeholder="Display name"
                    onChange={(e) => onPatch({ fields: { [nameField]: e.target.value } })}
                />
            </label>
            <label className="ffield">
                <span className="ffield__label">description</span>
                <textarea
                    className="ffield__input"
                    rows={4}
                    value={fstr(resource, descField)}
                    placeholder="Shown on the tag's listing page. Optional."
                    onChange={(e) => onPatch({ fields: { [descField]: e.target.value } })}
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
