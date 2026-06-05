import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'
import { common, createLowlight } from 'lowlight'

// Code blocks with syntax highlighting (lowlight/highlight.js) plus a language
// picker. The node keeps the name `codeBlock` and a `language` attr, so the
// markdown round-trip (fenced ```lang) is unchanged.
const lowlight = createLowlight(common)
const LANGUAGES = lowlight.listLanguages().sort()

function CodeBlockView({ node, updateAttributes, deleteNode, editor }: NodeViewProps) {
    const language: string = node.attrs.language || ''
    return (
        <NodeViewWrapper className="codeblock">
            <div className="codeblock__bar" contentEditable={false}>
                <select
                    className="codeblock__lang"
                    value={language}
                    disabled={!editor.isEditable}
                    onChange={(e) => updateAttributes({ language: e.target.value })}
                >
                    <option value="">plain text</option>
                    {LANGUAGES.map((l) => (
                        <option key={l} value={l}>
                            {l}
                        </option>
                    ))}
                </select>
                {editor.isEditable && (
                    <button className="codeblock__del" type="button" title="delete" onClick={() => deleteNode()}>
                        ✕
                    </button>
                )}
            </div>
            <pre>
                <NodeViewContent as="code" />
            </pre>
        </NodeViewWrapper>
    )
}

export const CodeBlock = CodeBlockLowlight.extend({
    addNodeView() {
        return ReactNodeViewRenderer(CodeBlockView)
    },
}).configure({ lowlight })
