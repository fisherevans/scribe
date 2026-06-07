import { Editor } from '../editor/Editor'
import type { ExperienceProps } from '../collections'
import { fstr } from '../types'

// The document-first writing surface. The title field is whatever the mapping
// binds to the `title` role; the body is the markdown body.
export function PostExperience({ resource, map, onPatch, onEditTitle, editable }: ExperienceProps) {
    return (
        <Editor
            slug={resource.slug}
            title={map.title ? fstr(resource, map.title) : ''}
            body={resource.body}
            editable={editable ?? false}
            onEditTitle={onEditTitle ?? (() => {})}
            onBody={(body) => onPatch({ body })}
        />
    )
}
