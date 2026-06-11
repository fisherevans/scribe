import { motion } from 'framer-motion'
import { useMemo, useState } from 'react'
import type { Resource, FieldDef } from '../types'
import { fieldDiffs, bodyItems, buildMerged, type Side } from '../lib/merge'

interface Props {
    mine: Resource
    theirs: Resource
    fieldDefs: FieldDef[]
    onCancel: () => void
    onResolve: (merged: Resource) => void
}

// ConflictResolveModal is the merge workflow for a concurrent-edit conflict.
// It diffs the open editor version ("yours") against the server's ("theirs")
// per frontmatter field and per body hunk, lets the writer pick a side for each
// (body hunks also support "both"), and force-saves the assembled result. The
// merge math lives in lib/merge.ts; this is purely the picker UI.
//
// The parent mounts this only while a conflict is being reconciled, so it owns
// no open/close state of its own - closing is an unmount (no AnimatePresence:
// presence-on-unmount is brittle for a modal that must reliably dismiss). A
// fresh mount per conflict also means the selection state starts clean.
export function ConflictResolveModal({ mine, theirs, fieldDefs, onCancel, onResolve }: Props) {
    const diffs = useMemo(() => fieldDiffs(mine, theirs), [mine, theirs])
    const items = useMemo(() => bodyItems(mine.body, theirs.body), [mine, theirs])
    const hunks = useMemo(() => items.filter((i) => !i.equal), [items])

    const [fieldChoices, setFieldChoices] = useState<Record<string, Side>>({})
    const [bodyChoices, setBodyChoices] = useState<Record<number, Side>>({})

    const label = (key: string) => fieldDefs.find((f) => f.name === key)?.label || key
    const identical = diffs.length === 0 && hunks.length === 0

    const save = () => {
        onResolve(buildMerged(mine, diffs, fieldChoices, items, bodyChoices))
    }

    return (
        <>
            <motion.div className="scrim scrim--merge" onClick={onCancel} initial={{ opacity: 0 }} animate={{ opacity: 1 }} />
            <motion.div
                className="cmerge"
                role="dialog"
                aria-modal="true"
                tabIndex={-1}
                onKeyDown={(e) => { if (e.key === 'Escape') onCancel() }}
                style={{ x: '-50%', y: '-50%' }}
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ type: 'spring', stiffness: 360, damping: 30 }}
            >
                <div className="cmerge__head">
                    <h2 className="cmerge__title">Merge changes</h2>
                    <p className="cmerge__sub">
                        {identical
                            ? 'The two versions are identical - saving keeps your copy.'
                            : 'This post changed elsewhere after you opened it. Pick a side for each change; your selections merge into one save.'}
                    </p>
                    {!identical && (
                        <div className="cmerge__legend">
                            <span className="cmerge__chip cmerge__chip--mine">yours</span>
                            <span className="cmerge__chip cmerge__chip--theirs">theirs</span>
                        </div>
                    )}
                </div>

                <div className="cmerge__body">
                    {diffs.length > 0 && (
                        <section className="cmerge__section">
                            <div className="cmerge__sectionname">Details</div>
                            {diffs.map((d) => (
                                <div key={d.key} className="cmerge__row">
                                    <div className="cmerge__rowhead">
                                        <span className="cmerge__field">{label(d.key)}</span>
                                        <Picker value={fieldChoices[d.key] ?? 'mine'} onChange={(s) => setFieldChoices((c) => ({ ...c, [d.key]: s }))} both={false} />
                                    </div>
                                    <div className="cmerge__vals">
                                        <Val side="mine" active={(fieldChoices[d.key] ?? 'mine') === 'mine'} value={fmt(d.mine)} />
                                        <Val side="theirs" active={fieldChoices[d.key] === 'theirs'} value={fmt(d.theirs)} />
                                    </div>
                                </div>
                            ))}
                        </section>
                    )}

                    {hunks.length > 0 && (
                        <section className="cmerge__section">
                            <div className="cmerge__sectionname">Body · {hunks.length} {hunks.length === 1 ? 'change' : 'changes'}</div>
                            <div className="cmerge__diff">
                                {items.map((it) =>
                                    it.equal ? (
                                        <Context key={it.id} text={it.text ?? ''} />
                                    ) : (
                                        <div key={it.id} className="cmerge__hunk">
                                            <div className="cmerge__hunkhead">
                                                <span className="cmerge__hunklabel">change</span>
                                                <Picker value={bodyChoices[it.id] ?? 'mine'} onChange={(s) => setBodyChoices((c) => ({ ...c, [it.id]: s }))} both />
                                            </div>
                                            {it.theirsText ? <Lines text={it.theirsText} side="theirs" muted={(bodyChoices[it.id] ?? 'mine') === 'mine'} /> : null}
                                            {it.mineText ? <Lines text={it.mineText} side="mine" muted={bodyChoices[it.id] === 'theirs'} /> : null}
                                        </div>
                                    ),
                                )}
                            </div>
                        </section>
                    )}
                </div>

                <div className="cmerge__actions">
                    <button className="btn" type="button" onClick={onCancel}>Cancel</button>
                    <button className="btn btn--promote" type="button" onClick={save}>Save merged</button>
                </div>
            </motion.div>
        </>
    )
}

// Segmented side picker. `both` adds the third option for body hunks.
function Picker({ value, onChange, both }: { value: Side; onChange: (s: Side) => void; both: boolean }) {
    const opts: Side[] = both ? ['mine', 'theirs', 'both'] : ['mine', 'theirs']
    const text: Record<Side, string> = { mine: 'Yours', theirs: 'Theirs', both: 'Both' }
    return (
        <div className="cmerge__picker">
            {opts.map((o) => (
                <button key={o} type="button" className={'cmerge__pick' + (value === o ? ' cmerge__pick--on cmerge__pick--' + o : '')} onClick={() => onChange(o)}>
                    {text[o]}
                </button>
            ))}
        </div>
    )
}

function Val({ side, active, value }: { side: 'mine' | 'theirs'; active: boolean; value: string }) {
    return (
        <div className={'cmerge__val cmerge__val--' + side + (active ? ' cmerge__val--on' : '')}>
            <span className="cmerge__valtag">{side === 'mine' ? 'yours' : 'theirs'}</span>
            <span className="cmerge__valtext">{value || <em className="cmerge__empty">(empty)</em>}</span>
        </div>
    )
}

function Lines({ text, side, muted }: { text: string; side: 'mine' | 'theirs'; muted: boolean }) {
    const lines = stripTrailingNewline(text).split('\n')
    return (
        <div className={'cmerge__lines cmerge__lines--' + side + (muted ? ' cmerge__lines--muted' : '')}>
            {lines.map((l, i) => (
                <div key={i} className="cmerge__line">
                    <span className="cmerge__sign">{side === 'mine' ? '+' : '-'}</span>
                    <span className="cmerge__linetext">{l || ' '}</span>
                </div>
            ))}
        </div>
    )
}

// Shared context: collapse long unchanged runs so the diff stays scannable.
function Context({ text }: { text: string }) {
    const lines = stripTrailingNewline(text).split('\n')
    const show = lines.length <= 6 ? lines : [...lines.slice(0, 2), `… ${lines.length - 4} unchanged lines …`, ...lines.slice(-2)]
    return (
        <div className="cmerge__context">
            {show.map((l, i) => (
                <div key={i} className="cmerge__line">
                    <span className="cmerge__sign"> </span>
                    <span className="cmerge__linetext">{l || ' '}</span>
                </div>
            ))}
        </div>
    )
}

function stripTrailingNewline(s: string): string {
    return s.endsWith('\n') ? s.slice(0, -1) : s
}

function fmt(v: unknown): string {
    if (v === undefined || v === null) return ''
    if (Array.isArray(v)) return v.join(', ')
    if (typeof v === 'boolean') return v ? 'true' : 'false'
    return String(v)
}
