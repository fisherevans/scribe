// App-level settings (distinct from the editor Theme). Persisted to
// localStorage. hostedDomain powers the "view live" links.
export interface AppSettings {
    hostedDomain: string
}

export const DEFAULT_SETTINGS: AppSettings = {
    hostedDomain: 'log.fisher.sh',
}

const KEY = 'scribe-settings'

export function loadSettings(): AppSettings {
    try {
        const raw = localStorage.getItem(KEY)
        if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
    } catch {
        /* ignore */
    }
    return { ...DEFAULT_SETTINGS }
}

export function saveSettings(s: AppSettings) {
    try {
        localStorage.setItem(KEY, JSON.stringify(s))
    } catch {
        /* ignore */
    }
}

// Build a full live URL from the configured domain and a site-relative path.
export function liveUrl(domain: string, path: string | null): string | null {
    if (!domain.trim() || !path) return null
    const host = domain.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '')
    return `https://${host}${path}`
}
