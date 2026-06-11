// Three-way-ish merge helpers for the concurrent-edit conflict flow. "mine" is
// the open editor resource, "theirs" is the version the server now has. The UI
// (ConflictResolveModal) lets the writer pick a side per frontmatter field and
// per body hunk; these functions compute the diffs and assemble the chosen
// result. Pure and side-effect free so the logic is unit-tested directly.
import { diffLines } from 'diff'
import type { Resource } from '../types'

export type Side = 'mine' | 'theirs' | 'both'

// A frontmatter field that differs between the two versions. `mine`/`theirs`
// are the raw values (undefined when the key is absent on that side).
export interface FieldDiff {
    key: string
    mine: unknown
    theirs: unknown
}

// One segment of the body. `equal` segments are shared context kept verbatim;
// otherwise it's a conflict hunk holding the two sides' line runs.
export interface BodyItem {
    equal: boolean
    id: number
    text?: string // equal context
    mineText?: string // lines only in mine
    theirsText?: string // lines only in theirs
}

const norm = (v: unknown) => JSON.stringify(v ?? null)

// Frontmatter fields that differ, over the union of keys on both sides.
export function fieldDiffs(mine: Resource, theirs: Resource): FieldDiff[] {
    const keys = new Set([...Object.keys(mine.fields), ...Object.keys(theirs.fields)])
    const out: FieldDiff[] = []
    for (const key of keys) {
        if (norm(mine.fields[key]) !== norm(theirs.fields[key])) {
            out.push({ key, mine: mine.fields[key], theirs: theirs.fields[key] })
        }
    }
    return out
}

// Line-level body breakdown: shared context plus conflict hunks. Each maximal
// run of changed lines collapses into one hunk so the writer chooses once per
// region rather than per line. Empty when the bodies are identical.
export function bodyItems(mineBody: string, theirsBody: string): BodyItem[] {
    if (mineBody === theirsBody) return []
    // base = theirs, compared = mine: `added` is in mine, `removed` is in theirs.
    const parts = diffLines(theirsBody, mineBody)
    const items: BodyItem[] = []
    let id = 0
    let pendMine = '',
        pendTheirs = '',
        inHunk = false
    const flush = () => {
        if (!inHunk) return
        items.push({ equal: false, id: id++, mineText: pendMine, theirsText: pendTheirs })
        pendMine = ''
        pendTheirs = ''
        inHunk = false
    }
    for (const p of parts) {
        if (!p.added && !p.removed) {
            flush()
            items.push({ equal: true, id: id++, text: p.value })
        } else {
            inHunk = true
            if (p.added) pendMine += p.value
            if (p.removed) pendTheirs += p.value
        }
    }
    flush()
    return items
}

// Assemble the merged body from the per-hunk choices (default: mine).
export function pickBody(items: BodyItem[], choices: Record<number, Side>): string {
    let out = ''
    for (const it of items) {
        if (it.equal) {
            out += it.text ?? ''
            continue
        }
        const s = choices[it.id] ?? 'mine'
        if (s === 'theirs') out += it.theirsText ?? ''
        else if (s === 'both') out += (it.theirsText ?? '') + (it.mineText ?? '')
        else out += it.mineText ?? ''
    }
    return out
}

// Build the merged resource from the chosen field/body sides. Non-conflicting
// frontmatter is identical on both sides, so it's carried over as-is; private
// `notes` and identity (slug/state) come from mine. The caller force-saves the
// result, so `version` is irrelevant here.
export function buildMerged(
    mine: Resource,
    diffs: FieldDiff[],
    fieldChoices: Record<string, Side>,
    items: BodyItem[],
    bodyChoices: Record<number, Side>,
): Resource {
    const conflicted = new Set(diffs.map((d) => d.key))
    const fields: Record<string, unknown> = {}
    for (const k of Object.keys(mine.fields)) if (!conflicted.has(k)) fields[k] = mine.fields[k]
    for (const d of diffs) {
        const v = fieldChoices[d.key] === 'theirs' ? d.theirs : d.mine
        if (v !== undefined) fields[d.key] = v
    }
    const body = items.length ? pickBody(items, bodyChoices) : mine.body
    return { ...mine, fields, body, dirty: true }
}
