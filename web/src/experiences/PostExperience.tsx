import { Editor } from '../editor/Editor'
import type { ExperienceProps } from '../collections'
import { fstr, flist } from '../types'
import { ReferencePicker } from '../components/ReferencePicker'

// The document-first writing surface. The title is the mapped `title` role; the
// body is the markdown body. The mapped date / description / tags live inline
// between the title and the body so the common metadata is edited in the
// document, not buried in the details sheet (which keeps the rest).
export function PostExperience({ resource, map, references, onPatch, onEditTitle, onOpenRef, editable }: ExperienceProps) {
    const ed = editable ?? false
    const dateF = map.date
    const descF = map.description
    const tagsF = map.tags
    const tagTarget = references?.tags
    const date = dateF ? fstr(resource, dateF) : ''
    const desc = descF ? fstr(resource, descF) : ''

    const meta = ed ? (
        <div className="docmeta docmeta--edit">
            {dateF && (
                <label className="docmeta__field">
                    <span className="docmeta__lbl">date</span>
                    <input
                        type="date"
                        className="docmeta__date"
                        value={date}
                        onChange={(e) => onPatch({ fields: { [dateF]: e.target.value } })}
                    />
                </label>
            )}
            {descF && (
                <textarea
                    className="docmeta__desc"
                    rows={2}
                    value={desc}
                    placeholder="Description — shown in listings, RSS, and the feed card"
                    onChange={(e) => onPatch({ fields: { [descF]: e.target.value } })}
                />
            )}
            {tagsF && tagTarget && (
                <div className="docmeta__tags">
                    <ReferencePicker
                        target={tagTarget}
                        value={flist(resource, tagsF)}
                        onChange={(slugs) => onPatch({ fields: { [tagsF]: slugs } })}
                        onOpen={onOpenRef && ((slug) => onOpenRef(tagTarget, slug))}
                    />
                </div>
            )}
        </div>
    ) : date || desc ? (
        <div className="docmeta docmeta--view">
            {date && <div className="docmeta__byline">{date}</div>}
            {desc && <p className="docmeta__lede">{desc}</p>}
        </div>
    ) : null

    return (
        <Editor
            slug={resource.slug}
            title={map.title ? fstr(resource, map.title) : ''}
            body={resource.body}
            editable={ed}
            onEditTitle={onEditTitle}
            onBody={(body) => onPatch({ body })}
            meta={meta}
        />
    )
}
