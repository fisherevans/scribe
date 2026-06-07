import { Editor } from '../editor/Editor'
import type { ExperienceProps } from '../collections'
import { fstr } from '../types'

// Posts get the document-first writing surface. Title/metadata come from the
// resource's fields; the body is the markdown. (Which field is "title"/"body"
// is still assumed here for the posts collection; M2 makes that a mapping.)
export function PostExperience({ resource, onPatch, onEditTitle, editable }: ExperienceProps) {
    return (
        <Editor
            slug={resource.slug}
            title={fstr(resource, 'title')}
            body={resource.body}
            editable={editable ?? false}
            onEditTitle={onEditTitle ?? (() => {})}
            onBody={(body) => onPatch({ body })}
        />
    )
}
