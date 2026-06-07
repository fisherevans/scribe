import { AnimatePresence, motion } from 'framer-motion'
import { FONT_OPTIONS, type Theme } from '../theme'
import type { AppSettings } from '../settings'
import type { CollectionView } from '../collections'

interface Props {
    open: boolean
    views: CollectionView[]
    theme: Theme
    settings: AppSettings
    onTheme: (t: Theme) => void
    onThemeReset: () => void
    onSettings: (s: AppSettings) => void
    onConfigure: () => void
    onClose: () => void
}

// Settings live here (opened from the bottom of the left rail): how the editor
// looks, the hosted site, and how each resource type is edited. The Resource
// Types section is the visible face of the experience registry - today it's
// read-only; the design's .scribe.yml sidecar will make it editable per repo.
export function SettingsPanel({ open, views, theme, settings, onTheme, onThemeReset, onSettings, onConfigure, onClose }: Props) {
    const setT = (patch: Partial<Theme>) => onTheme({ ...theme, ...patch })

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
                            <span className="sheet__title">settings</span>
                            <button className="sheet__close" onClick={onClose} type="button">✕</button>
                        </div>

                        <div className="settings__section">hosted site</div>
                        <label className="field">
                            <span className="field__label">
                                domain <span className="field__private" style={{ color: 'var(--ink-faint)' }}>for “view live” links</span>
                            </span>
                            <input
                                className="field__input field__input--mono"
                                value={settings.hostedDomain}
                                placeholder="log.fisher.sh"
                                spellCheck={false}
                                onChange={(e) => onSettings({ ...settings, hostedDomain: e.target.value })}
                            />
                        </label>

                        <div className="settings__section">appearance</div>
                        <Range label="page width" value={theme.measure} min={28} max={62} step={1} unit="rem" onChange={(v) => setT({ measure: v })} />
                        <Range label="body size" value={theme.proseSize} min={0.9} max={1.6} step={0.02} unit="rem" onChange={(v) => setT({ proseSize: v })} />
                        <Range label="line height" value={theme.lineHeight} min={1.3} max={2.1} step={0.02} unit="" onChange={(v) => setT({ lineHeight: v })} />
                        <label className="field">
                            <span className="field__label">body font</span>
                            <select className="field__input" value={theme.bodyFont} onChange={(e) => setT({ bodyFont: e.target.value })}>
                                {FONT_OPTIONS.map((f) => <option key={f.label} value={f.value}>{f.label}</option>)}
                            </select>
                        </label>
                        <label className="field">
                            <span className="field__label">heading font</span>
                            <select className="field__input" value={theme.headingFont} onChange={(e) => setT({ headingFont: e.target.value })}>
                                {FONT_OPTIONS.map((f) => <option key={f.label} value={f.value}>{f.label}</option>)}
                            </select>
                        </label>
                        <div className="field field--row">
                            <Color label="paper" value={theme.paper} onChange={(v) => setT({ paper: v })} />
                            <Color label="ink" value={theme.ink} onChange={(v) => setT({ ink: v })} />
                            <Color label="accent" value={theme.accent} onChange={(v) => setT({ accent: v })} />
                        </div>
                        <button className="btn btn--ghost theme__reset" type="button" onClick={onThemeReset}>reset appearance</button>

                        <div className="settings__section">resource types</div>
                        <p className="settings__note">
                            How each content type is edited. Defined in the experience registry; a
                            <code> .scribe.yml</code> sidecar will make this editable per repo.
                        </p>
                        <ul className="typelist">
                            {views.map((v) => (
                                <li key={v.name} className="typerow">
                                    <span className="typerow__glyph">{v.glyph}</span>
                                    <span className="typerow__name">{v.label}</span>
                                    <span className="typerow__exp">{v.experienceLabel}</span>
                                </li>
                            ))}
                        </ul>
                        <button className="btn btn--ghost theme__reset" type="button" onClick={onConfigure}>configure types &amp; mapping</button>
                    </motion.aside>
                </>
            )}
        </AnimatePresence>
    )
}

function Range({ label, value, min, max, step, unit, onChange }: { label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void }) {
    return (
        <label className="field">
            <span className="field__label">{label} <span className="field__val">{value.toFixed(2)}{unit}</span></span>
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
