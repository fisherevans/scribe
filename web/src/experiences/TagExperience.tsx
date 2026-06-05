import type { Tag } from '../types'

interface Props {
    resource: Tag
    onPatch: (p: Partial<Tag>) => void
}

// Tags get a bespoke simple form - no document surface, just the two fields the
// schema defines. The slug is derived/fixed (it's the filename), shown read-only.
export function TagExperience({ resource, onPatch }: Props) {
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
                    value={resource.name}
                    placeholder="Display name"
                    onChange={(e) => onPatch({ name: e.target.value })}
                />
            </label>
            <label className="ffield">
                <span className="ffield__label">description</span>
                <textarea
                    className="ffield__input"
                    rows={4}
                    value={resource.description}
                    placeholder="Shown on the tag's listing page. Optional."
                    onChange={(e) => onPatch({ description: e.target.value })}
                />
            </label>
        </div>
    )
}
