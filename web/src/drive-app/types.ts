import type { Folder, FileItem } from '@kubuno/drive'

// Shared types for the Drive application shell (DriveApp and its parts).

export type MenuTarget =
  | { type: 'folder'; item: Folder;   x: number; y: number }
  | { type: 'file';   item: FileItem; x: number; y: number }
  | null

export type RenameTarget = { type: 'folder'; item: Folder } | { type: 'file'; item: FileItem } | null
export type MoveTarget   = { type: 'folder'; item: Folder } | { type: 'file'; item: FileItem } | null

/** Target of the "advanced share" dialog (file or folder). */
export type AdvShareTarget = { kind: 'file' | 'folder'; id: string; name: string }

/** URL query parameter that persists the active search so F5 replays it. */
export const SEARCH_PARAM = 'search-q'

/** Sort field of the file list. */
export type SortField = 'name' | 'size' | 'date' | 'type'
/** Sort direction of the file list. */
export type SortDir = 'asc' | 'desc'
