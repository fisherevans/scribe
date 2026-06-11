import { useMemo } from 'react'
import { diffLines, diffStat } from '../lib/diff'

// Line diff with +/- coloring. `before` is the baseline (server / last save),
// `after` is the candidate (the local draft). Used by the draft-recovery prompt
// to show exactly what would come back.
export function DiffView({ before, after }: { before: string; after: string }) {
    const ops = useMemo(() => diffLines(before, after), [before, after])
    const stat = useMemo(() => diffStat(ops), [ops])

    if (stat.added === 0 && stat.removed === 0) {
        return <div className="diff diff--empty">No changes to the body.</div>
    }

    return (
        <div className="diff">
            <div className="diff__stat">
                <span className="diff__stat-add">+{stat.added}</span>
                <span className="diff__stat-del">-{stat.removed}</span>
            </div>
            <pre className="diff__body">
                {ops.map((op, i) => (
                    <div key={i} className={'diff__line diff__line--' + op.type}>
                        <span className="diff__sign">{op.type === 'add' ? '+' : op.type === 'del' ? '-' : ' '}</span>
                        <span className="diff__text">{op.text || ' '}</span>
                    </div>
                ))}
            </pre>
        </div>
    )
}
