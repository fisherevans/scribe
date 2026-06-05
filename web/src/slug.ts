// Slug = the post's filename (and a chunk of its URL). Derived from the title
// at creation, then decoupled: editing the title does not move the file, so we
// surface a mismatch warning instead (renaming an existing post changes its
// URL, which the blog does not redirect - see src/lib/posts.ts).
export function slugify(s: string): string {
    return s
        .toLowerCase()
        .trim()
        .replace(/['"`]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
}

// Append -2, -3, … until the slug is unique within `taken`.
export function uniqueSlug(base: string, taken: Iterable<string>): string {
    const set = new Set(taken)
    const root = base || 'untitled'
    if (!set.has(root)) return root
    let i = 2
    while (set.has(`${root}-${i}`)) i++
    return `${root}-${i}`
}
