import { AnimatePresence, motion } from 'framer-motion'
import { FONT_OPTIONS, type Theme } from '../theme'

interface Props {
    theme: Theme
    open: boolean
    onChange: (t: Theme) => void
    onReset: () => void
    onClose: () => void
}

// Tunes the editor's writing surface (page width, fonts, sizing, colors) to
// approximate the blog. Applies live via CSS variables; styles the editor only.
export function ThemePanel({ theme, open, onChange, onReset, onClose }: Props) {
    const set = (patch: Partial<Theme>) => onChange({ ...theme, ...patch })

    return (
        <AnimatePresence>
            {open && (
                <>
                    <motion.div className="scrim" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
                    <motion.aside
                        className="sheet sheet--left"
                        initial={{ x: '-100%' }}
                        animate={{ x: 0 }}
                        exit={{ x: '-100%' }}
                        transition={{ type: 'spring', stiffness: 320, damping: 34 }}
                    >
                        <div className="sheet__head">
                            <span className="sheet__title">theme</span>
                            <button className="sheet__close" onClick={onClose} type="button">✕</button>
                        </div>

                        <Range label="page width" value={theme.measure} min={28} max={62} step={1} unit="rem" onChange={(v) => set({ measure: v })} />
                        <Range label="body size" value={theme.proseSize} min={0.9} max={1.6} step={0.02} unit="rem" onChange={(v) => set({ proseSize: v })} />
                        <Range label="line height" value={theme.lineHeight} min={1.3} max={2.1} step={0.02} unit="" onChange={(v) => set({ lineHeight: v })} />

                        <label className="field">
                            <span className="field__label">body font</span>
                            <select className="field__input" value={theme.bodyFont} onChange={(e) => set({ bodyFont: e.target.value })}>
                                {FONT_OPTIONS.map((f) => <option key={f.label} value={f.value}>{f.label}</option>)}
                            </select>
                        </label>
                        <label className="field">
                            <span className="field__label">heading font</span>
                            <select className="field__input" value={theme.headingFont} onChange={(e) => set({ headingFont: e.target.value })}>
                                {FONT_OPTIONS.map((f) => <option key={f.label} value={f.value}>{f.label}</option>)}
                            </select>
                        </label>

                        <div className="field field--row">
                            <Color label="paper" value={theme.paper} onChange={(v) => set({ paper: v })} />
                            <Color label="ink" value={theme.ink} onChange={(v) => set({ ink: v })} />
                            <Color label="accent" value={theme.accent} onChange={(v) => set({ accent: v })} />
                        </div>

                        <button className="btn btn--ghost theme__reset" type="button" onClick={onReset}>reset to default</button>
                    </motion.aside>
                </>
            )}
        </AnimatePresence>
    )
}

function Range({ label, value, min, max, step, unit, onChange }: { label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void }) {
    return (
        <label className="field">
            <span className="field__label">{label} <span className="field__val">{value.toFixed(unit === 'rem' ? 2 : 2)}{unit}</span></span>
            <input className="range" type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} />
        </label>
    )
}

function Color({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
    return (
        <label className="field field--grow color">
            <span className="field__label">{label}</span>
            <input className="color__swatch" type="color" value={value} onChange={(e) => onChange(e.target.value)} />
        </label>
    )
}
