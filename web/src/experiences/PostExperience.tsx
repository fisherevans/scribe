import { Editor } from '../editor/Editor'
import type { ExperienceProps } from '../collections'
import { fstr, flist } from '../types'
import { ReferencePicker } from '../components/ReferencePicker'
import { AutoTextarea } from '../components/AutoTextarea'
import { useData } from '../data'

// The document-first writing surface. The title is the mapped `title` role; the
// body is the markdown body. The mapped date / description / tags live inline
// between the title and the body so the common metadata is edited in the
// document, not buried in the details sheet (which keeps the rest).
export function PostExperience({ resource, map, references, onPatch, onEditTitle, onOpenRef, editable }: ExperienceProps) {
    const data = useData()
    const ed = editable ?? false
    const dateF = map.date
    const descF = map.description
    const tagsF = map.tags
    const tagTarget = references?.tags
    const date = dateF ? fstr(resource, dateF) : ''
    const desc = descF ? fstr(resource, descF) : ''
    const tags = tagsF ? flist(resource, tagsF) : []

    const meta = ed ? (
        // Edit: every piece is a labeled field on the same baseline so date and
        // tags line up and the description reads as a description.
        <div className="docmeta docmeta--edit">
            <div className="docmeta__row">
                {dateF && (
                    <label className="docmeta__field docmeta__field--date">
                        <span className="docmeta__lbl">date</span>
                        <input
                            type="date"
                            className="docmeta__date"
                            value={date}
                            onChange={(e) => onPatch({ fields: { [dateF]: e.target.value } })}
                        />
                    </label>
                )}
                {tagsF && tagTarget && (
                    <div className="docmeta__field docmeta__field--tags">
                        <span className="docmeta__lbl">tags</span>
                        <ReferencePicker
                            target={tagTarget}
                            value={tags}
                            onChange={(slugs) => onPatch({ fields: { [tagsF]: slugs } })}
                            onOpen={onOpenRef && ((slug) => onOpenRef(tagTarget, slug))}
                        />
                    </div>
                )}
            </div>
            {descF && (
                <label className="docmeta__field">
                    <span className="docmeta__lbl">description</span>
                    <AutoTextarea
                        className="docmeta__desc"
                        value={desc}
                        placeholder="Shown in listings, RSS, and the feed card"
                        onChange={(v) => onPatch({ fields: { [descF]: v } })}
                    />
                </label>
            )}
        </div>
    ) : date || desc || tags.length ? (
        // View: byline, then a visually distinct description, then navigable tags.
        <div className="docmeta docmeta--view">
            {date && <div className="docmeta__byline">{date}</div>}
            {desc && <p className="docmeta__lede">{desc}</p>}
            {tagTarget && tags.length > 0 && (
                <div className="docmeta__tagrow">
                    {tags.map((slug) => (
                        <button
                            key={slug}
                            type="button"
                            className="doctag"
                            title={onOpenRef ? `open ${slug}` : undefined}
                            onClick={onOpenRef ? () => onOpenRef(tagTarget, slug) : undefined}
                        >
                            {data.labelFor(tagTarget, slug)}
                        </button>
                    ))}
                </div>
            )}
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
