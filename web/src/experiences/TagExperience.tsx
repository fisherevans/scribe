import { useEffect, useState } from 'react'
import type { ExperienceProps } from '../collections'
import { fstr } from '../types'
import { slugify } from '../slug'
import { ContentEditor } from '../editor/ContentEditor'
import { Editor } from '../editor/Editor'
import { AutoTextarea } from '../components/AutoTextarea'
import { useData } from '../data'

// Tags: name + description edit live (they touch no references). The slug is a
// reference target, so renaming it goes through an explicit edit -> apply step
// that surfaces (via the cascade dialog) which posts get rewritten. When the
// tag collection is markdown-backed it also gets an optional page-content body.
export function TagExperience({ resource, def, map, onPatch, onRename, onDelete, onOpenRef }: ExperienceProps) {
    const data = useData()
    const refs = data.referencers(resource.collection, resource.slug)
    const nameField = map.name || 'name'
    const descField = map.description || 'description'
    const hasBody = def.format === 'yaml-frontmatter'

    const [editingSlug, setEditingSlug] = useState(false)
    const [slugDraft, setSlugDraft] = useState(resource.slug)
    const [fullscreen, setFullscreen] = useState(false)
    useEffect(() => { setSlugDraft(resource.slug); setEditingSlug(false); setFullscreen(false) }, [resource.slug])

    const name = fstr(resource, nameField) || resource.slug

    // Full-screen page-content editing: the same document surface as a post. The
    // back/context bar lives on the parchment (Editor's `lead`) so it reads as
    // part of what you're editing, and it spells out that this is a tag's page.
    if (fullscreen && hasBody) {
        return (
            <Editor
                slug={'tag:' + resource.slug}
                title={name}
                body={resource.body}
                editable
                onBody={(md) => onPatch({ body: md })}
                lead={
                    <div className="tagfull__bar">
                        <button className="btn" type="button" onClick={() => setFullscreen(false)}>← back to tag</button>
                        <span className="tagfull__title">page content · <strong>{name}</strong> tag</span>
                    </div>
                }
                meta={
                    <div className="docmeta docmeta--edit">
                        <AutoTextarea
                            className="docmeta__desc"
                            value={fstr(resource, descField)}
                            placeholder="Description - one-liner for listings"
                            onChange={(v) => onPatch({ fields: { [descField]: v } })}
                        />
                    </div>
                }
            />
        )
    }

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
                        <button className="slugview__edit" type="button" onClick={() => setEditingSlug(true)} title="rename slug">
                            <span className="slugview__pencil" aria-hidden="true">✎</span> edit
                        </button>
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
                    <div className="ffield__labelrow">
                        <span className="ffield__label">page content <span className="ffield__hint">optional · markdown shown on the tag page</span></span>
                        <button className="ffield__expand" type="button" onClick={() => setFullscreen(true)} title="open the full editor">⤢ full screen</button>
                    </div>
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

            {/* Reverse references live below the editable fields - context about the
                tag, not something you set. Each row links to the referencing post. */}
            <div className="ffield">
                <span className="ffield__label">
                    referenced by <span className="ffield__hint">{refs.length === 0 ? 'nothing uses this tag yet' : `${refs.length} post${refs.length === 1 ? '' : 's'} tagged with this`}</span>
                </span>
                {refs.length === 0 ? (
                    <p className="reflist__empty">No posts are tagged with this. Safe to delete, or attach it to some.</p>
                ) : (
                    <ul className="reflist">
                        {refs.map((r) => (
                            <li key={r.collection + '/' + r.slug}>
                                <button
                                    type="button"
                                    className="reflink"
                                    disabled={!onOpenRef}
                                    onClick={onOpenRef ? () => onOpenRef(r.collection, r.slug) : undefined}
                                >
                                    <span className="reflink__main">
                                        <span className="reflink__title">{data.labelFor(r.collection, r.slug)}</span>
                                        <span className="reflink__sub">{r.collection.replace(/s$/, '')} · {r.slug}</span>
                                    </span>
                                    <span className="reflink__go" aria-hidden="true">↗</span>
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

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
