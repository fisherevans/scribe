import { useMemo } from 'react'
import { diffLines, diffStat, diffRows, type Seg } from '../lib/diff'

// Line diff with +/- coloring and word-level highlighting: within a changed
// line, only the differing runs are emphasized so a one-word edit doesn't read
// as a whole-line rewrite. `before` is the baseline, `after` is the candidate.
export function DiffView({ before, after }: { before: string; after: string }) {
    const rows = useMemo(() => diffRows(before, after), [before, after])
    const stat = useMemo(() => diffStat(diffLines(before, after)), [before, after])

    if (stat.added === 0 && stat.removed === 0) {
        return <div className="diff diff--empty">No changes.</div>
    }

    return (
        <div className="diff">
            <div className="diff__stat">
                <span className="diff__stat-add">+{stat.added}</span>
                <span className="diff__stat-del">-{stat.removed}</span>
            </div>
            <pre className="diff__body">
                {rows.map((row, i) => (
                    <div key={i} className={'diff__line diff__line--' + row.kind}>
                        <span className="diff__sign">{row.kind === 'add' ? '+' : row.kind === 'del' ? '-' : ' '}</span>
                        <span className="diff__text">{renderSegs(row.kind, row.segs)}</span>
                    </div>
                ))}
            </pre>
        </div>
    )
}

function renderSegs(kind: 'same' | 'add' | 'del', segs: Seg[]) {
    if (kind === 'same') return segs.map((s) => s.text).join('') || ' '
    const cls = kind === 'add' ? 'diff__hl diff__hl--add' : 'diff__hl diff__hl--del'
    return segs.map((s, i) => (s.changed ? <span key={i} className={cls}>{s.text}</span> : <span key={i}>{s.text}</span>))
}
