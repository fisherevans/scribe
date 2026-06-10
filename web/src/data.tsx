import { createContext, useContext } from 'react'
import type { Resource } from './types'

// One resource that points at a target slug through a reference field.
export interface Referencer {
    collection: string
    slug: string
    field: string
}

// Read-only data access exposed to any component (e.g. the ReferencePicker):
// list resources in any collection, resolve a resource's display label, and walk
// references in reverse (who points at this slug).
export interface DataApi {
    list: (collection: string) => Resource[]
    labelFor: (collection: string, slug: string) => string
    // Resources that reference (target, slug) through a reference field. Empty
    // when nothing points at it.
    referencers: (target: string, slug: string) => Referencer[]
}

export const DataContext = createContext<DataApi>({ list: () => [], labelFor: (_c, slug) => slug, referencers: () => [] })
export const useData = () => useContext(DataContext)
