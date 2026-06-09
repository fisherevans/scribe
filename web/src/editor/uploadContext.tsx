import { createContext, useContext } from 'react'

// Context the editor's image/figure node views read to drive uploads: whether an
// external CDN target is configured, and which resource is being edited (so a
// local upload can be grouped per-post). Provided by App around the editor, the
// same way DataContext reaches the reference picker.
export interface UploadEnv {
    externalEnabled: boolean
    collection: string
    slug: string
}

export const UploadContext = createContext<UploadEnv>({ externalEnabled: false, collection: '', slug: '' })
export const useUploadEnv = () => useContext(UploadContext)
