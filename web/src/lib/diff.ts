// Minimal line-level diff for the recovery and conflict views. Classic LCS over
// lines; good enough for prose-sized bodies and avoids a dependency. Output is a
// flat op list the DiffView renders with +/- coloring.

export type DiffOp =
    | { type: 'same'; text: string }
    | { type: 'add'; text: string }
    | { type: 'del'; text: string }

export function diffLines(a: string, b: string): DiffOp[] {
    const A = a.split('\n')
    const B = b.split('\n')
    const n = A.length
    const m = B.length
    // LCS length table.
    const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            lcs[i][j] = A[i] === B[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
        }
    }
    const ops: DiffOp[] = []
    let i = 0
    let j = 0
    while (i < n && j < m) {
        if (A[i] === B[j]) {
            ops.push({ type: 'same', text: A[i] })
            i++
            j++
        } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
            ops.push({ type: 'del', text: A[i] })
            i++
        } else {
            ops.push({ type: 'add', text: B[j] })
            j++
        }
    }
    while (i < n) ops.push({ type: 'del', text: A[i++] })
    while (j < m) ops.push({ type: 'add', text: B[j++] })
    return ops
}

// ---- intra-line (word-level) diff --------------------------------------
// A changed line usually has only a few words different. Highlighting the whole
// line buries the actual edit, so we diff the two lines at token granularity and
// mark only the changed runs.

// Seg is a run of a line, flagged as changed (the part that differs) or not.
export interface Seg {
    text: string
    changed: boolean
}

// tokenize splits a line into words and the whitespace/punctuation between them,
// each as its own token, so a single-word change diffs to a single changed run.
function tokenize(s: string): string[] {
    return s.match(/\s+|[^\s]+/g) ?? []
}

function pushSeg(arr: Seg[], text: string, changed: boolean) {
    const last = arr[arr.length - 1]
    if (last && last.changed === changed) last.text += text
    else arr.push({ text, changed })
}

// inlineSegs token-diffs an old line against a new line, returning the segments
// for each side with the changed runs flagged. Same LCS as diffLines, over tokens.
export function inlineSegs(oldLine: string, newLine: string): { del: Seg[]; add: Seg[] } {
    const A = tokenize(oldLine)
    const B = tokenize(newLine)
    const n = A.length
    const m = B.length
    const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            lcs[i][j] = A[i] === B[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
        }
    }
    const del: Seg[] = []
    const add: Seg[] = []
    let i = 0
    let j = 0
    while (i < n && j < m) {
        if (A[i] === B[j]) {
            pushSeg(del, A[i], false)
            pushSeg(add, B[j], false)
            i++
            j++
        } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
            pushSeg(del, A[i], true)
            i++
        } else {
            pushSeg(add, B[j], true)
            j++
        }
    }
    while (i < n) pushSeg(del, A[i++], true)
    while (j < m) pushSeg(add, B[j++], true)
    return { del, add }
}

// DiffRow is a render-ready diff line: unchanged text, or a changed line split
// into segments so the differing words can be highlighted.
export type DiffRow =
    | { kind: 'same'; segs: Seg[] }
    | { kind: 'del'; segs: Seg[] }
    | { kind: 'add'; segs: Seg[] }

// diffRows builds the render model: a line diff, then for each replaced block
// (a run of deletions immediately followed by additions) it pairs lines by
// position and token-diffs each pair so the changed words are flagged. Pure
// additions/deletions (no counterpart) are flagged whole.
export function diffRows(before: string, after: string): DiffRow[] {
    const ops = diffLines(before, after)
    const rows: DiffRow[] = []
    let k = 0
    while (k < ops.length) {
        if (ops[k].type === 'same') {
            rows.push({ kind: 'same', segs: [{ text: ops[k].text, changed: false }] })
            k++
            continue
        }
        const dels: string[] = []
        const adds: string[] = []
        while (k < ops.length && ops[k].type === 'del') dels.push(ops[k++].text)
        while (k < ops.length && ops[k].type === 'add') adds.push(ops[k++].text)
        const pairs = Math.min(dels.length, adds.length)
        for (let p = 0; p < pairs; p++) {
            const { del, add } = inlineSegs(dels[p], adds[p])
            rows.push({ kind: 'del', segs: del })
            rows.push({ kind: 'add', segs: add })
        }
        for (let p = pairs; p < dels.length; p++) rows.push({ kind: 'del', segs: [{ text: dels[p], changed: true }] })
        for (let p = pairs; p < adds.length; p++) rows.push({ kind: 'add', segs: [{ text: adds[p], changed: true }] })
    }
    return rows
}

export interface DiffStat {
    added: number
    removed: number
}

export function diffStat(ops: DiffOp[]): DiffStat {
    let added = 0
    let removed = 0
    for (const op of ops) {
        if (op.type === 'add') added++
        else if (op.type === 'del') removed++
    }
    return { added, removed }
}
