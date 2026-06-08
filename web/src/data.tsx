import { createContext, useContext } from 'react'
import type { Resource } from './types'

// Read-only data access exposed to any component (e.g. the ReferencePicker):
// list resources in any collection and resolve a resource's display label.
// (M5 will add mutation for cross-resource edits/cascades.)
export interface DataApi {
    list: (collection: string) => Resource[]
    labelFor: (collection: string, slug: string) => string
}

export const DataContext = createContext<DataApi>({ list: () => [], labelFor: (_c, slug) => slug })
export const useData = () => useContext(DataContext)
