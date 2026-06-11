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
