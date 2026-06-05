import { Editor } from '../editor/Editor'
import type { Post } from '../types'

interface Props {
    resource: Post
    onPatch: (p: Partial<Post>) => void
}

// Posts get the document-first writing surface. Metadata is deferred to the
// publish sheet (rendered by App), so this experience is just the page.
export function PostExperience({ resource, onPatch }: Props) {
    return (
        <Editor
            slug={resource.slug}
            title={resource.title}
            body={resource.body}
            onTitle={(title) => onPatch({ title })}
            onBody={(body) => onPatch({ body })}
        />
    )
}
