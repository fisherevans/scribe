import { Extension } from '@tiptap/core'
import Suggestion from '@tiptap/suggestion'
import type { SuggestionOptions } from '@tiptap/suggestion'
import { ReactRenderer } from '@tiptap/react'
import {
    forwardRef,
    useEffect,
    useImperativeHandle,
    useLayoutEffect,
    useState,
} from 'react'
import type { Editor, Range } from '@tiptap/core'

interface Item {
    title: string
    hint: string
    glyph: string
    group: string
    run: (editor: Editor, range: Range) => void
}

// Grouped like Pages CMS's /commands - "blocks" are the prose primitives,
// "custom & embeds" are the structured/opaque content types. New custom
// content (a provider embed, a new template) is one more entry here.
const ITEMS: Item[] = [
    { group: 'Blocks', title: 'Heading', hint: 'Section title', glyph: 'H', run: (e, r) => e.chain().focus().deleteRange(r).setNode('heading', { level: 2 }).run() },
    { group: 'Blocks', title: 'Subheading', hint: 'Smaller title', glyph: 'h', run: (e, r) => e.chain().focus().deleteRange(r).setNode('heading', { level: 3 }).run() },
    { group: 'Blocks', title: 'Text', hint: 'Plain paragraph', glyph: '¶', run: (e, r) => e.chain().focus().deleteRange(r).setNode('paragraph').run() },
    { group: 'Blocks', title: 'Bulleted list', hint: 'Unordered', glyph: '•', run: (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run() },
    { group: 'Blocks', title: 'Numbered list', hint: 'Ordered', glyph: '1.', run: (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run() },
    { group: 'Blocks', title: 'Quote', hint: 'Block quote', glyph: '“', run: (e, r) => e.chain().focus().deleteRange(r).toggleBlockquote().run() },
    { group: 'Blocks', title: 'Divider', hint: 'Horizontal rule', glyph: '—', run: (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run() },
    { group: 'Blocks', title: 'Code block', hint: 'Monospaced', glyph: '{}', run: (e, r) => e.chain().focus().deleteRange(r).toggleCodeBlock().run() },
    { group: 'Blocks', title: 'Table', hint: '3×3 with header', glyph: '⊞', run: (e, r) => e.chain().focus().deleteRange(r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
    { group: 'Custom & embeds', title: 'Image', hint: 'A standalone image', glyph: '🖼', run: (e, r) => e.chain().focus().deleteRange(r).insertImage().run() },
    { group: 'Custom & embeds', title: 'Figure', hint: 'Image with caption', glyph: '🏞', run: (e, r) => e.chain().focus().deleteRange(r).insertFigure().run() },
    { group: 'Custom & embeds', title: 'Callout', hint: 'Note · idea · heads-up', glyph: '✷', run: (e, r) => e.chain().focus().deleteRange(r).insertCallout('info').run() },
    { group: 'Custom & embeds', title: 'Raw HTML', hint: 'Opaque, preserved verbatim', glyph: '</>', run: (e, r) => e.chain().focus().deleteRange(r).insertRawHtml('').run() },
]

interface MenuHandle {
    onKeyDown: (e: KeyboardEvent) => boolean
}
interface MenuProps {
    items: Item[]
    command: (item: Item) => void
}

const Menu = forwardRef<MenuHandle, MenuProps>(({ items, command }, ref) => {
    const [active, setActive] = useState(0)
    useEffect(() => setActive(0), [items])

    useImperativeHandle(ref, () => ({
        onKeyDown: (e) => {
            if (e.key === 'ArrowUp') {
                setActive((a) => (a + items.length - 1) % items.length)
                return true
            }
            if (e.key === 'ArrowDown') {
                setActive((a) => (a + 1) % items.length)
                return true
            }
            if (e.key === 'Enter') {
                if (items[active]) command(items[active])
                return true
            }
            return false
        },
    }))

    if (!items.length) return <div className="slash"><div className="slash__empty">no matches</div></div>

    return (
        <div className="slash">
            {items.map((item, i) => {
                const newGroup = i === 0 || items[i - 1].group !== item.group
                return (
                    <div key={item.title}>
                        {newGroup && <div className="slash__caption">{item.group}</div>}
                        <button
                            type="button"
                            className={'slash__item' + (i === active ? ' is-active' : '')}
                            onMouseEnter={() => setActive(i)}
                            onMouseDown={(e) => {
                                e.preventDefault()
                                command(item)
                            }}
                        >
                            <span className="slash__glyph">{item.glyph}</span>
                            <span className="slash__text">
                                <span className="slash__title">{item.title}</span>
                                <span className="slash__hint">{item.hint}</span>
                            </span>
                        </button>
                    </div>
                )
            })}
        </div>
    )
})

// Positions the ReactRenderer element at the caret rect. A small effect keeps
// it flipped above the caret when it would overflow the viewport bottom.
function Positioned({ rect, children }: { rect: () => DOMRect | null; children: React.ReactNode }) {
    const [pos, setPos] = useState<{ top: number; left: number; flip: boolean }>({ top: 0, left: 0, flip: false })
    useLayoutEffect(() => {
        const r = rect()
        if (!r) return
        const flip = r.bottom + 320 > window.innerHeight
        setPos({ top: flip ? r.top : r.bottom, left: r.left, flip })
    }, [rect])
    return (
        <div
            className="slash__anchor"
            style={{ top: pos.top, left: pos.left, transform: pos.flip ? 'translateY(-100%) translateY(-8px)' : 'translateY(8px)' }}
        >
            {children}
        </div>
    )
}

export const SlashCommand = Extension.create({
    name: 'slashCommand',
    addProseMirrorPlugins() {
        const suggestion: Omit<SuggestionOptions, 'editor'> = {
            char: '/',
            startOfLine: false,
            command: ({ editor, range, props }) => (props as Item).run(editor, range),
            items: ({ query }) =>
                ITEMS.filter(
                    (i) =>
                        i.title.toLowerCase().includes(query.toLowerCase()) ||
                        i.group.toLowerCase().includes(query.toLowerCase()),
                ),
            render: () => {
                let renderer: ReactRenderer<MenuHandle, MenuProps> | null = null
                let getRect: () => DOMRect | null = () => null

                return {
                    onStart: (props) => {
                        getRect = () => (props.clientRect ? props.clientRect() : null)
                        renderer = new ReactRenderer(
                            forwardRef<MenuHandle, MenuProps>((p, r) => (
                                <Positioned rect={getRect}>
                                    <Menu {...p} ref={r} />
                                </Positioned>
                            )),
                            {
                                props: { items: props.items, command: (item: Item) => props.command(item) },
                                editor: props.editor,
                            },
                        )
                        document.body.appendChild(renderer.element)
                    },
                    onUpdate: (props) => {
                        getRect = () => (props.clientRect ? props.clientRect() : null)
                        renderer?.updateProps({ items: props.items, command: (item: Item) => props.command(item) })
                    },
                    onKeyDown: (props) => {
                        if (props.event.key === 'Escape') {
                            renderer?.destroy()
                            renderer?.element.remove()
                            return true
                        }
                        return renderer?.ref?.onKeyDown(props.event) ?? false
                    },
                    onExit: () => {
                        renderer?.element.remove()
                        renderer?.destroy()
                    },
                }
            },
        }
        return [Suggestion({ editor: this.editor, ...suggestion })]
    },
})
