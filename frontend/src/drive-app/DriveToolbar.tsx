import { useTranslation } from 'react-i18next'
import {
  Archive, CheckSquare, FolderInput, FolderPlus, ListChecks, RotateCcw, Trash2, Upload, X,
} from 'lucide-react'
import type { Folder, FolderAncestor } from '@kubuno/drive'
import { Button } from '@ui'
import Breadcrumb from './Breadcrumb'
import type { DriveBulkActions } from './useDriveBulkActions'

interface Props {
  currentFolder: Folder | null
  ancestors:     FolderAncestor[]
  pageTitle:     string
  onNavigate:    (id: string | null) => void
  trashed: boolean
  starred: boolean
  shared:  boolean
  recent:  boolean
  selectedCount:    number
  allItemsSelected: boolean
  onToggleSelectAll: () => void
  /** True when the selection cannot be trashed (protected or playing item). */
  deleteDisabled: boolean
  purgePending:   boolean
  bulk: DriveBulkActions
  onImportFiles:  () => void
  onImportFolder: () => void
  onNewFolder:    () => void
}

/** Inline toolbar of the DriveApp views: breadcrumb + selection/import actions. */
export default function DriveToolbar({
  currentFolder, ancestors, pageTitle, onNavigate,
  trashed, starred, shared, recent,
  selectedCount, allItemsSelected, onToggleSelectAll, deleteDisabled, purgePending,
  bulk, onImportFiles, onImportFolder, onNewFolder,
}: Props) {
  const { t } = useTranslation('drive')
  return (
    <div className="flex items-start gap-3 mb-5">
      <div className="flex-1 min-w-0">
        <Breadcrumb
          folder={!starred && !shared && !recent && !trashed ? currentFolder : null}
          ancestors={ancestors}
          pageTitle={pageTitle}
          onNavigate={onNavigate}
        />
      </div>

      <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
        {/* Selection action bar */}
        {selectedCount > 0 && (
          <>
            <span className="text-sm text-text-secondary mr-1">
              {t('storage.selected', { count: selectedCount })}
            </span>
            <Button
              variant={allItemsSelected ? 'secondary' : 'primary'}
              size="sm"
              icon={allItemsSelected ? <CheckSquare size={14} /> : <ListChecks size={14} />}
              onClick={onToggleSelectAll}
            >
              {allItemsSelected ? t('app.deselect_all') : t('app.select_all')}
            </Button>
            {!trashed ? (
              <>
              <Button
                variant="secondary"
                size="sm"
                icon={<Archive size={14} />}
                onClick={bulk.compressSelection}
              >
                Compresser
              </Button>
              <Button
                variant="danger"
                size="sm"
                icon={<Trash2 size={14} />}
                disabled={deleteDisabled}
                onClick={bulk.trashSelection}
              >
                {t('common.delete')}
              </Button>
              </>
            ) : (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<RotateCcw size={14} />}
                  onClick={bulk.restoreSelection}
                >
                  {t('ctx.restore')}
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  icon={<Trash2 size={14} />}
                  onClick={bulk.deleteSelection}
                >
                  {t('common.delete')}
                </Button>
              </>
            )}
            <button
              onClick={bulk.clearSelection}
              className="p-1.5 rounded-full hover:bg-surface-2 text-text-tertiary transition-colors"
              title={t('app.cancel_selection')}
            >
              <X size={16} />
            </button>
            <div className="w-px h-5 bg-border mx-0.5" />
          </>
        )}
        {trashed && selectedCount === 0 && (
          <Button
            variant="danger"
            size="sm"
            icon={<Trash2 size={14} />}
            disabled={purgePending}
            onClick={bulk.emptyTrash}
          >
            {t('app.empty_trash')}
          </Button>
        )}
        {!trashed && !shared && !recent && !starred && (
          <>
            <Button
              variant="secondary"
              size="sm"
              icon={<FolderInput size={14} />}
              onClick={onImportFolder}
            >
              {t('app.folder_btn')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={<Upload size={14} />}
              onClick={onImportFiles}
            >
              {t('common.import')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={<FolderPlus size={14} />}
              onClick={onNewFolder}
            >
              {t('newfolder.title')}
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
