import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Link from '@tiptap/extension-link'
import Table from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableHeader from '@tiptap/extension-table-header'
import TableCell from '@tiptap/extension-table-cell'
import GlobalDragHandle from 'tiptap-extension-global-drag-handle'
import { ImageBlock } from './ImageBlock'
import { ImageUpload } from './imageUpload'
import { RawHtml } from './RawHtmlNode'
import { Callout } from './CalloutNode'
import { CodeBlock } from './CodeBlock'
import { SlashCommand } from './SlashCommand'
import { LinkShortcut } from './BubbleToolbar'

// The editor's extension set, shared by the live editor and the markdown
// round-trip tests (which build a schema from this list). Keeping it in one
// place means the tests exercise exactly the schema the editor uses.
export function editorExtensions() {
    return [
        StarterKit.configure({ heading: { levels: [1, 2, 3, 4] }, codeBlock: false }),
        CodeBlock,
        Placeholder.configure({
            includeChildren: false,
            placeholder: ({ node }) => {
                if (node.type.name === 'heading') return 'Section title'
                if (node.type.name === 'paragraph') return "Write. Press '/' for blocks."
                return ''
            },
        }),
        ImageBlock,
        ImageUpload,
        Link.configure({ openOnClick: false, autolink: false }),
        RawHtml,
        Callout,
        Table.configure({ resizable: false }),
        TableRow,
        TableHeader,
        TableCell,
        SlashCommand,
        LinkShortcut,
        GlobalDragHandle.configure({ dragHandleWidth: 22, scrollTreshold: 100 }),
    ]
}
