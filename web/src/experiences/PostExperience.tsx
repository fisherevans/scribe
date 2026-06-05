import { Editor } from '../editor/Editor'
import type { Post } from '../types'

interface Props {
    resource: Post
    onPatch: (p: Partial<Post>) => void
    onEditTitle?: () => void
    editable?: boolean
}

// Posts get the document-first writing surface. The title is an immutable
// header edited via a modal (onEditTitle); metadata is deferred to the publish
// sheet (rendered by App).
export function PostExperience({ resource, onPatch, onEditTitle, editable }: Props) {
    return (
        <Editor
            slug={resource.slug}
            title={resource.title}
            body={resource.body}
            editable={editable ?? false}
            onEditTitle={onEditTitle ?? (() => {})}
            onBody={(body) => onPatch({ body })}
        />
    )
}
