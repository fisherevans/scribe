import type { Post } from './types'

// Stand-in for the Go service. The editor body uses HTML internally (TipTap),
// but these seeds are authored as the HTML the editor would hold after parsing
// markdown. The /embed block demonstrates opaque raw-HTML preservation: the
// <iframe> is stored verbatim and round-trips untouched.
const seed: Post[] = [
    {
        slug: 'calsync',
        title: 'calsync: one calendar to rule them all',
        date: '2026-06-04',
        description:
            'Merging five Google calendars into one read-only feed without losing my mind, using a tiny Go service and a lot of ICS quirks.',
        tags: ['tools', 'go'],
        draft: false,
        state: 'promoted',
        dirty: false,
        notes:
            '- ask Lisa which calendars she actually wants merged\n- TODO: screenshot the before/after\n- link: RFC 5545 recurrence rules section',
        body: `<p>I have five calendars. Work, personal, the shared house one, a read-only one my team publishes, and the one that just holds trash pickup days. None of them talk to each other, and I kept double-booking myself.</p><h2>The shape of the problem</h2><p>ICS feeds are deceptively simple until you hit recurrence rules. The spec allows <em>exceptions to exceptions</em>, which is where most libraries quietly fall over.</p><div data-raw-html="true"><iframe src="https://media.fisher.sh/blog/2026/06/04/calsync/demo.html" width="100%" height="320" frameborder="0"></iframe></div><p>That embed above is the live merged view. Everything below the fold is the implementation.</p>`,
    },
    {
        slug: 'the-weather-machine',
        title: 'Building my dream weather dashboard, in real life',
        date: '2026-05-18',
        description: 'An e-ink panel, a Raspberry Pi, and an unreasonable amount of time spent on font rendering.',
        tags: ['hardware', 'home-assistant'],
        draft: false,
        state: 'promoted',
        dirty: false,
        notes: 'idea: do a follow-up on the 3D printed enclosure',
        body: `<p>The dashboard hangs by the front door. It tells me whether to grab a jacket, and nothing else, because that is the only question I have at 7am.</p>`,
    },
    {
        slug: 'untitled-draft',
        title: '',
        date: '2026-06-05',
        description: '',
        tags: [],
        draft: true,
        state: 'staged',
        dirty: false,
        notes: 'just a scratch space for the next post - maybe about the k3s migration?',
        body: `<p></p>`,
    },
]

// In-memory store with artificial latency, so the UI exercises real async/save
// states. Swap this module's functions for fetch('/api/...') against the Go
// service and nothing else in the app changes.
let posts: Post[] = JSON.parse(JSON.stringify(seed))
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

export const api = {
    async list(): Promise<Post[]> {
        await delay(120)
        return JSON.parse(JSON.stringify(posts))
    },
    async save(slug: string, patch: Partial<Post>): Promise<Post> {
        await delay(260) // feels like a commit to staging
        posts = posts.map((p) => (p.slug === slug ? { ...p, ...patch, dirty: false } : p))
        return JSON.parse(JSON.stringify(posts.find((p) => p.slug === slug)!))
    },
    async promote(slug: string): Promise<Post> {
        await delay(700) // feels like merge staging -> main + push
        posts = posts.map((p) => (p.slug === slug ? { ...p, state: 'promoted', dirty: false } : p))
        return JSON.parse(JSON.stringify(posts.find((p) => p.slug === slug)!))
    },
    async create(): Promise<Post> {
        await delay(120)
        const slug = `untitled-${Math.random().toString(36).slice(2, 6)}`
        const fresh: Post = {
            slug,
            title: '',
            date: new Date().toISOString().slice(0, 10),
            description: '',
            tags: [],
            draft: true,
            state: 'staged',
            dirty: false,
            notes: '',
            body: '<p></p>',
        }
        posts = [fresh, ...posts]
        return JSON.parse(JSON.stringify(fresh))
    },
}
