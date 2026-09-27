import { useState } from 'react'
import { ContentEditor } from '../editor/ContentEditor'
import type { ExperienceProps } from '../collections'
import { fstr, flist } from '../types'
import { ReferencePicker } from '../components/ReferencePicker'
import { NoteGallery, type NoteImage } from '../components/NoteGallery'
import { useData } from '../data'

// A note has NO title - that is the whole point of the format, and the reason
// this is not just a blog post with fields hidden. So there is no title slot to
// leave empty: the date is the header, the photos sit under it, and the body is
// whatever there is to say. Compare PostExperience, which is built around a
// title and a description.
export function NoteExperience({ resource, map, references, onPatch, onOpenRef, editable }: ExperienceProps) {
    const data = useData()
    const [words, setWords] = useState(0)
    const ed = editable ?? false
    const dateF = map.date
    const tagsF = map.tags
    const imagesF = map.images
    const tagTarget = references?.tags
    const date = dateF ? fstr(resource, dateF) : ''
    const tags = tagsF ? flist(resource, tagsF) : []
    const images = (imagesF ? ((resource.fields?.[imagesF] as NoteImage[] | undefined) ?? []) : []) as NoteImage[]

    return (
        <article className="page page--note">
            <header className="notehead">
                {ed ? (
                    <div className="notehead__row">
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
                ) : (
                    (date || tags.length > 0) && (
                        <div className="notehead__row notehead__row--view">
                            {date && <span className="docmeta__byline">{date}</span>}
                            {tagTarget &&
                                tags.map((slug) => (
                                    <button
                                        key={slug}
                                        type="button"
                                        className="doctag"
                                        onClick={onOpenRef ? () => onOpenRef(tagTarget, slug) : undefined}
                                    >
                                        {data.labelFor(tagTarget, slug)}
                                    </button>
                                ))}
                        </div>
                    )
                )}
            </header>

            {imagesF && (
                <NoteGallery
                    images={images}
                    editable={ed}
                    slug={resource.slug}
                    onChange={(next) => onPatch({ fields: { [imagesF]: next } })}
                />
            )}

            <ContentEditor docKey={resource.slug} body={resource.body} editable={ed} onBody={(body) => onPatch({ body })} onWords={setWords} />

            <footer className="page__meta">
                {words} {words === 1 ? 'word' : 'words'}
            </footer>
        </article>
    )
}
