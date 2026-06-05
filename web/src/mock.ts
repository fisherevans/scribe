import type { CollectionName, Post, Resource, Snippet, Tag } from './types'

// Stand-in for the Go service, now collection-aware. Swap each function for a
// fetch('/api/<collection>/…') call against the service and the UI is unchanged.

const posts: Post[] = [
    {
        kind: 'posts',
        slug: 'calsync',
        title: 'calsync: one calendar to rule them all',
        date: '2026-06-04',
        description:
            'Merging five Google calendars into one read-only feed without losing my mind, using a tiny Go service and a lot of ICS quirks.',
        tags: ['tools', 'go'],
        draft: false,
        state: 'promoted',
        dirty: false,
        notes: '- ask Lisa which calendars she actually wants merged\n- TODO: screenshot the before/after',
        body: `<p>I have five calendars. Work, personal, the shared house one, a read-only one my team publishes, and the one that just holds trash pickup days. None of them talk to each other, and I kept double-booking myself.</p><h2>The shape of the problem</h2><p>ICS feeds are deceptively simple until you hit recurrence rules. The spec allows <em>exceptions to exceptions</em>, which is where most libraries quietly fall over.</p><div data-callout="true" data-tone="warn"><p>Do not parse RRULE by hand. You will get DST wrong and lose a Tuesday.</p></div><figure data-figure="true"><img src="https://media.fisher.sh/blog/2026/06/04/calsync/arch.png" alt="architecture"><figcaption>The merge pipeline, start to finish.</figcaption></figure><div data-raw-html="true"><iframe src="https://media.fisher.sh/blog/2026/06/04/calsync/demo.html" width="100%" height="280" frameborder="0"></iframe></div>`,
    },
    {
        kind: 'posts',
        slug: 'the-weather-machine',
        title: 'Building my dream weather dashboard, in real life',
        date: '2026-05-18',
        description: 'An e-ink panel, a Raspberry Pi, and an unreasonable amount of time spent on font rendering.',
        tags: ['hardware', 'home-assistant'],
        draft: false,
        state: 'promoted',
        dirty: false,
        notes: 'idea: follow-up on the 3D printed enclosure',
        body: `<p>The dashboard hangs by the front door. It tells me whether to grab a jacket, and nothing else, because that is the only question I have at 7am.</p>`,
    },
    {
        kind: 'posts',
        slug: 'untitled-draft',
        title: '',
        date: '2026-06-05',
        description: '',
        tags: [],
        draft: true,
        state: 'staged',
        dirty: false,
        notes: 'scratch space - maybe the k3s migration writeup?',
        body: `<p></p>`,
    },
]

const tags: Tag[] = [
    { kind: 'tags', slug: 'tools', name: 'Tools', description: 'Things I build to make other things easier.', state: 'promoted', dirty: false },
    { kind: 'tags', slug: 'go', name: 'Go', description: 'The language most of these services are written in.', state: 'promoted', dirty: false },
    { kind: 'tags', slug: 'hardware', name: 'Hardware', description: 'Soldering irons, e-ink, 3D prints.', state: 'promoted', dirty: false },
    { kind: 'tags', slug: 'home-assistant', name: 'Home Assistant', description: '', state: 'staged', dirty: false },
]

const snippets: Snippet[] = [
    { kind: 'snippets', slug: 'cta-newsletter', title: 'Newsletter CTA', content: 'Want more of this? <a href="/subscribe">Subscribe</a>.', state: 'promoted', dirty: false },
]

let store: Record<CollectionName, Resource[]> = {
    posts: clone(posts),
    tags: clone(tags),
    snippets: clone(snippets),
}

function clone<T>(v: T): T {
    return JSON.parse(JSON.stringify(v))
}
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

function defaults(kind: CollectionName, slug: string): Resource {
    const base = { slug, state: 'staged' as const, dirty: false }
    if (kind === 'posts')
        return { kind, ...base, title: '', date: new Date().toISOString().slice(0, 10), description: '', tags: [], draft: true, body: '<p></p>', notes: '' }
    if (kind === 'tags') return { kind, ...base, name: '', description: '' }
    return { kind, ...base, title: '', content: '' }
}

export const api = {
    async list(c: CollectionName): Promise<Resource[]> {
        await delay(100)
        return clone(store[c])
    },
    async save(c: CollectionName, slug: string, patch: Partial<Resource>): Promise<Resource> {
        await delay(260) // feels like a commit to staging
        store[c] = store[c].map((r) => (r.slug === slug ? ({ ...r, ...patch, dirty: false } as Resource) : r))
        return clone(store[c].find((r) => r.slug === slug)!)
    },
    async promote(c: CollectionName, slug: string): Promise<Resource> {
        await delay(700) // feels like merge staging -> main + push
        store[c] = store[c].map((r) => (r.slug === slug ? ({ ...r, state: 'promoted', dirty: false } as Resource) : r))
        return clone(store[c].find((r) => r.slug === slug)!)
    },
    async create(c: CollectionName): Promise<Resource> {
        await delay(100)
        const slug = `untitled-${Math.random().toString(36).slice(2, 6)}`
        const fresh = defaults(c, slug)
        store[c] = [fresh, ...store[c]]
        return clone(fresh)
    },
}
