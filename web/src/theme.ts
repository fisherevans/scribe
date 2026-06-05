// Editor theme: a small set of CSS-variable overrides so the writing surface
// can be tuned to approximate the blog (page width, fonts, sizing, colors).
// Persisted to localStorage and applied to :root. This styles the EDITOR only;
// it does not change what gets written to posts.
export interface Theme {
    measure: number // page width, rem
    proseSize: number // body font size, rem
    lineHeight: number
    bodyFont: string
    headingFont: string
    paper: string
    ink: string
    accent: string
}

export const FONT_OPTIONS: { label: string; value: string }[] = [
    { label: 'Newsreader', value: "'Newsreader', Georgia, serif" },
    { label: 'Fraunces', value: "'Fraunces', Georgia, serif" },
    { label: 'Georgia', value: 'Georgia, serif' },
    { label: 'Spline Sans Mono', value: "'Spline Sans Mono', ui-monospace, monospace" },
    { label: 'System sans', value: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" },
]

export const DEFAULT_THEME: Theme = {
    measure: 40,
    proseSize: 1.2,
    lineHeight: 1.72,
    bodyFont: "'Newsreader', Georgia, serif",
    headingFont: "'Fraunces', Georgia, serif",
    paper: '#f4ede0',
    ink: '#2c2620',
    accent: '#c0883b',
}

const KEY = 'scribe-theme'

export function loadTheme(): Theme {
    try {
        const raw = localStorage.getItem(KEY)
        if (raw) return { ...DEFAULT_THEME, ...JSON.parse(raw) }
    } catch {
        /* ignore */
    }
    return { ...DEFAULT_THEME }
}

export function saveTheme(t: Theme) {
    try {
        localStorage.setItem(KEY, JSON.stringify(t))
    } catch {
        /* ignore */
    }
}

export function applyTheme(t: Theme) {
    const r = document.documentElement.style
    r.setProperty('--measure', `${t.measure}rem`)
    r.setProperty('--prose-size', `${t.proseSize}rem`)
    r.setProperty('--prose-leading', String(t.lineHeight))
    r.setProperty('--serif-body', t.bodyFont)
    r.setProperty('--serif-display', t.headingFont)
    r.setProperty('--paper', t.paper)
    r.setProperty('--paper-2', t.paper)
    r.setProperty('--ink', t.ink)
    r.setProperty('--brass', t.accent)
    r.setProperty('--brass-deep', t.accent)
}
