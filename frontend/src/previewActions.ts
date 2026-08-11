// Bridge between the EXTERNAL preview host (previewService) and the generic
// preview chrome (FilePreviewShell). A mail attachment has no Drive identity,
// so the only meaningful extra action is « Enregistrer dans Drive »: it imports
// the bytes, after which the preview switches to the real Drive file and every
// Drive affordance comes back on its own.
//
// A context rather than props: the shell is reached through FilePreviewOverlay
// and ImagePreviewOverlay, and neither viewer has any business knowing about
// external sources. Inside Drive itself the context is absent (null) and the
// chrome is byte-for-byte what it was.
import { createContext, useContext } from 'react'

export type SaveToDriveState = 'idle' | 'saving' | 'saved' | 'error'

export interface ExternalPreviewActions {
  /** Imports the previewed external source into Drive (asks for a folder). */
  saveToDrive: () => void
  /** Progress of that import, for the button and the status pill. */
  saveState: SaveToDriveState
}

export const ExternalPreviewContext = createContext<ExternalPreviewActions | null>(null)

/** Actions of the enclosing external-preview host, or null inside Drive. */
export function useExternalPreviewActions(): ExternalPreviewActions | null {
  return useContext(ExternalPreviewContext)
}
