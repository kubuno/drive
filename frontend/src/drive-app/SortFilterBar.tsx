import { useTranslation } from 'react-i18next'
import { Files as FilesIcon, BarChart3 } from 'lucide-react'
import { ViewMenu, type ViewMode } from '@kubuno/drive'
import { Dropdown } from '@ui'
import { useDriveExtras } from '../driveExtras'
import type { SortDir, SortField } from './types'

// ── SortFilterBar ─────────────────────────────────────────────────────────────

export default function SortFilterBar({
  sortField, sortDir, typeFilter, onSortField, onSortDir, onTypeFilter, viewMode, onViewMode, compact, onCompact, showHidden, onShowHidden,
}: {
  sortField: SortField
  sortDir: SortDir
  typeFilter: string | null
  onSortField: (v: SortField) => void
  onSortDir: (v: SortDir) => void
  onTypeFilter: (v: string | null) => void
  viewMode: ViewMode
  onViewMode: (v: ViewMode) => void
  compact: boolean
  onCompact: (v: boolean) => void
  showHidden: boolean
  onShowHidden: (v: boolean) => void
}) {
  const { t } = useTranslation('drive')
  const SORT_OPTIONS = [
    { value: 'date',  label: t('app.sort_date') },
    { value: 'name',  label: t('common.name') },
    { value: 'size',  label: t('common.size') },
    { value: 'type',  label: t('filter.type') },
  ]
  const TYPE_OPTIONS = [
    { value: '',         label: t('app.ft_all') },
    { value: 'image',    label: t('app.ft_images') },
    { value: 'video',    label: t('filter.t_video') },
    { value: 'audio',    label: t('filter.t_audio') },
    { value: 'document', label: t('filter.t_document') },
    { value: 'archive',  label: t('filter.t_archive') },
  ]
  return (
    <div className="flex flex-wrap items-center gap-2 pb-3 -mx-6 px-6 border-b border-border">
      {/* Sort selector */}
      <div className="flex items-center gap-1">
        <span className="text-sm text-text-tertiary select-none font-medium">{t('app.sort_label')}</span>
        <Dropdown
          variant="ghost"
          value={sortField}
          onChange={v => onSortField(v as SortField)}
          options={SORT_OPTIONS}
        />
        <button
          onClick={() => onSortDir(sortDir === 'asc' ? 'desc' : 'asc')}
          className="ml-0.5 text-sm text-text-secondary hover:text-primary transition-colors select-none"
          title={sortDir === 'asc' ? t('app.sort_asc') : t('app.sort_desc')}
        >
          {sortDir === 'asc' ? '↑' : '↓'}
        </button>
      </div>

      {/* Separator */}
      <div className="h-5 w-px bg-border" />

      {/* Type filter dropdown */}
      <div className="flex items-center gap-1">
        <span className="text-sm text-text-tertiary select-none font-medium">{t('app.type_label')}</span>
        <Dropdown
          variant="ghost"
          value={typeFilter ?? ''}
          onChange={v => onTypeFilter(v === '' ? null : v)}
          options={TYPE_OPTIONS}
        />
      </div>

      {/* "Display" menu + tools (duplicates, storage overview). */}
      <div className="ml-auto flex items-center gap-1">
        <button
          onClick={() => useDriveExtras.getState().openTool('duplicates')}
          title="Fichiers en double"
          className="p-2 rounded-lg hover:bg-surface-2 text-text-secondary transition-colors"
        >
          <FilesIcon size={16} />
        </button>
        <button
          onClick={() => useDriveExtras.getState().openTool('insights')}
          title="Vue d'ensemble du stockage"
          className="p-2 rounded-lg hover:bg-surface-2 text-text-secondary transition-colors"
        >
          <BarChart3 size={16} />
        </button>
        <ViewMenu
          value={viewMode} onChange={onViewMode}
          compact={compact} onCompact={onCompact}
          showHidden={showHidden} onShowHidden={onShowHidden}
          t={t}
        />
      </div>
    </div>
  )
}
