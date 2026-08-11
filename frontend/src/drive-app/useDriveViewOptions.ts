import { useState } from 'react'
import type { ViewMode } from '@kubuno/drive'
import type { SortDir, SortField } from './types'

/** Display options of the Drive views: layout, density, sorting and filtering. */
export interface DriveViewOptions {
  viewMode: ViewMode
  setViewMode: (v: ViewMode) => void
  compact: boolean
  setCompact: (v: boolean) => void
  showHidden: boolean
  setShowHidden: (v: boolean) => void
  sortField: SortField
  setSortField: (v: SortField) => void
  sortDir: SortDir
  setSortDir: (v: SortDir) => void
  typeFilter: string | null
  setTypeFilter: (v: string | null) => void
}

export function useDriveViewOptions(): DriveViewOptions {
  const [viewMode, setViewMode]     = useState<ViewMode>('lg')
  const [compact, setCompact]       = useState(false)
  const [showHidden, setShowHidden] = useState(false)
  // Sort & filter
  const [sortField, setSortField]   = useState<SortField>('date')
  const [sortDir, setSortDir]       = useState<SortDir>('desc')
  const [typeFilter, setTypeFilter] = useState<string | null>(null)

  return {
    viewMode, setViewMode,
    compact, setCompact,
    showHidden, setShowHidden,
    sortField, setSortField,
    sortDir, setSortDir,
    typeFilter, setTypeFilter,
  }
}
