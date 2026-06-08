import { useEffect, useState } from 'react'
import type { ExperienceProps } from '../collections'
import { fstr } from '../types'
import { slugify } from '../slug'
import { ContentEditor } from '../editor/ContentEditor'

// Tags: name + description edit live (they touch no references). The slug is a
// reference target, so renaming it goes through an explicit edit -> apply step
// that surfaces (via the cascade dialog) which posts get rewritten. When the
// tag collection is markdown-backed it also gets an optional page-content body.
export function TagExperience({ resource, def, map, onPatch, onRename, onDelete }: ExperienceProps) {
    const nameField = map.name || 'name'
    const descField = map.description || 'description'
    const hasBody = def.format === 'yaml-frontmatter'

    const [editingSlug, setEditingSlug] = useState(false)
    const [slugDraft, setSlugDraft] = useState(resource.slug)
    useEffect(() => { setSlugDraft(resource.slug); setEditingSlug(false) }, [resource.slug])

    const applySlug = () => {
        const to = slugify(slugDraft)
        if (onRename && to && to !== resource.slug) onRename(resource.slug, to) // -> cascade preview
        setEditingSlug(false)
    }
    const cancelSlug = () => { setSlugDraft(resource.slug); setEditingSlug(false) }

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
                    value={fstr(resource, nameField)}
                    placeholder="Display name"
                    onChange={(e) => onPatch({ fields: { [nameField]: e.target.value } })}
                />
            </label>

            <div className="ffield">
                <span className="ffield__label">slug <span className="ffield__hint">URL · renaming rewrites referencing posts</span></span>
                {editingSlug ? (
                    <div className="slugedit">
                        <input
                            className="ffield__input ffield__input--mono"
                            autoFocus
                            value={slugDraft}
                            spellCheck={false}
                            onChange={(e) => setSlugDraft(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') applySlug(); else if (e.key === 'Escape') cancelSlug() }}
                        />
                        <button className="btn btn--promote" type="button" onClick={applySlug}>apply</button>
                        <button className="btn" type="button" onClick={cancelSlug}>cancel</button>
                    </div>
                ) : (
                    <div className="slugview">
                        <code className="slugview__val">{resource.slug}</code>
                        <button className="btn btn--ghost" type="button" onClick={() => setEditingSlug(true)}>✎ edit</button>
                    </div>
                )}
            </div>

            <label className="ffield">
                <span className="ffield__label">description <span className="ffield__hint">optional · one-liner for listings</span></span>
                <textarea
                    className="ffield__input ffield__input--area"
                    rows={3}
                    value={fstr(resource, descField)}
                    placeholder="Short summary, shown on the tag's listing page. Optional."
                    onChange={(e) => onPatch({ fields: { [descField]: e.target.value } })}
                />
            </label>

            {hasBody && (
                <div className="ffield">
                    <span className="ffield__label">page content <span className="ffield__hint">optional · markdown shown on the tag page</span></span>
                    <ContentEditor
                        docKey={'tag:' + resource.slug}
                        body={resource.body}
                        editable
                        autoFocus={false}
                        onBody={(md) => onPatch({ body: md })}
                        className="tagbody"
                    />
                </div>
            )}

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
