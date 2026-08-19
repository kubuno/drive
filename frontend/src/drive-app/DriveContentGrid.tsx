import React from 'react'
import { useTranslation } from 'react-i18next'
import { Info, Loader2 } from 'lucide-react'
import { ViewMenu, VIEW_SPECS, type FileItem, type Folder } from '@kubuno/drive'
import TrashStatsBanner from '../TrashStatsBanner'
import EmptyState from './EmptyState'
import FileCard from './FileCard'
import FileRow from './FileRow'
import FolderCard from './FolderCard'
import SortFilterBar from './SortFilterBar'
import type { DriveSelection } from './useDriveSelection'
import type { DriveViewOptions } from './useDriveViewOptions'

interface Props {
  folders:       Folder[]
  files:         FileItem[]
  filteredFiles: FileItem[]
  isLoading:  boolean
  hasError:   boolean
  trashed: boolean
  starred: boolean
  shared:  boolean
  recent:  boolean
  view:       DriveViewOptions
  selection:  DriveSelection
  /** Flat display order (folders then files) used to anchor range selections. */
  orderedIds: string[]
  dragOverFolderId:    string | null
  setDragOverFolderId: (id: string | null) => void
  setDraggingItem:     (item: { type: 'folder' | 'file'; id: string } | null) => void
  onDropOnFolder: (e: React.DragEvent, folderId: string) => void
  onNavigate:  (id: string | null) => void
  onOpenMenu:  (e: React.MouseEvent, type: 'folder' | 'file', item: Folder | FileItem) => void
  onOpenFile:  (file: FileItem) => void
  onRestoreFile: (id: string) => void
  onDeleteFile:  (id: string) => void
}

/** Folder + file listing of the DriveApp views (all layout modes). */
export default function DriveContentGrid({
  folders, files, filteredFiles, isLoading, hasError,
  trashed, starred, shared, recent,
  view, selection, orderedIds,
  dragOverFolderId, setDragOverFolderId, setDraggingItem, onDropOnFolder,
  onNavigate, onOpenMenu, onOpenFile, onRestoreFile, onDeleteFile,
}: Props) {
  const { t } = useTranslation('drive')
  const {
    selectedIds, setSelectedIds, preSelectedIds, cursorId,
    handleItemSelect, lastSelectedIdxRef,
  } = selection

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-text-secondary text-sm py-16 justify-center">
        <Loader2 size={18} className="animate-spin" />
        {t('common.loading')}
      </div>
    )
  }
  if (hasError) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
        <Info size={36} className="text-danger" />
        <p className="text-danger text-sm font-medium">{t('app.module_down_title')}</p>
        <p className="text-text-tertiary text-xs">{t('app.module_down_hint')}</p>
      </div>
    )
  }
  if (folders.length === 0 && filteredFiles.length === 0) {
    return <EmptyState trashed={trashed} starred={starred} shared={shared} recent={recent} />
  }

  return (
    <div className="space-y-6">
      {/* Trash information banner (counter + auto-purge). */}
      {trashed && <TrashStatsBanner />}
      {/* Sort / filter bar */}
      {files.length > 0 && !trashed && !recent && !starred && !shared && (
        <SortFilterBar
          sortField={view.sortField}
          sortDir={view.sortDir}
          typeFilter={view.typeFilter}
          onSortField={view.setSortField}
          onSortDir={view.setSortDir}
          onTypeFilter={view.setTypeFilter}
          viewMode={view.viewMode}
          onViewMode={view.setViewMode}
          showHidden={view.showHidden}
          onShowHidden={view.setShowHidden}
        />
      )}

      {/* Special views (recent/starred/trash/shared): "Display" menu only. */}
      {files.length > 0 && (trashed || recent || starred || shared) && (
        <div className="flex items-center pb-3 -mx-6 px-6 border-b border-border">
          <div className="ml-auto">
            <ViewMenu
              value={view.viewMode} onChange={view.setViewMode}
              // `compact` is gone from the core component; the published @kubuno/drive
              // types still require the props, so pass neutral values until republish.
              compact={false} onCompact={() => {}}
              showHidden={view.showHidden} onShowHidden={view.setShowHidden}
              t={t}
            />
          </div>
        </div>
      )}

      {folders.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-text-tertiary mb-2">
            {trashed ? t('app.folders_trash') : t('app.folders')}
          </h2>
          {/* Folders always render as cards here; only the icon views widen. */}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))]"
               style={{ gap: VIEW_SPECS[view.viewMode].kind === 'icons' ? 16 : 8 }}>
            {folders.map(folder => (
              <FolderCard
                key={folder.id}
                folder={folder}
                isDragTarget={dragOverFolderId === folder.id}
                selected={selectedIds.has(folder.id)}
                preSelected={preSelectedIds.has(folder.id)}
                focused={cursorId === folder.id}
                trashed={trashed}
                onSelect={handleItemSelect}
                onOpen={() => { if (!trashed) onNavigate(folder.id) }}
                onContextMenu={e => onOpenMenu(e, 'folder', folder)}
                onDragStart={() => {
                  if (!selectedIds.has(folder.id)) { setSelectedIds(new Set([folder.id])); lastSelectedIdxRef.current = orderedIds.indexOf(folder.id) }
                  setDraggingItem({ type: 'folder', id: folder.id })
                }}
                onDragOver={e => { e.preventDefault(); e.stopPropagation(); setDragOverFolderId(folder.id) }}
                onDragLeave={() => setDragOverFolderId(null)}
                onDrop={e => onDropOnFolder(e, folder.id)}
              />
            ))}
          </div>
        </section>
      )}

      {filteredFiles.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-text-tertiary mb-2">
            {trashed ? t('app.files_trash') : t('app.files')}
            {view.typeFilter && filteredFiles.length !== files.length && (
              <span className="ml-2 normal-case font-normal text-text-tertiary">
                — {filteredFiles.length} / {files.length}
              </span>
            )}
          </h2>
          {(() => {
            const spec = VIEW_SPECS[view.viewMode]
            // Shared selection props → same behaviour across every layout.
            const sel = (file: FileItem) => ({
              selected: selectedIds.has(file.id), preSelected: preSelectedIds.has(file.id), focused: cursorId === file.id, canMove: !trashed,
              onSelect: handleItemSelect,
              onDragStart: () => { if (!selectedIds.has(file.id)) { setSelectedIds(new Set([file.id])); lastSelectedIdxRef.current = orderedIds.indexOf(file.id) } setDraggingItem({ type: 'file', id: file.id }) },
            })
            if (spec.kind === 'icons') {
              return (
                <div className="grid" style={{ gridTemplateColumns: `repeat(auto-fill,minmax(${spec.min}px,1fr))`, gap: 24 }}>
                  {filteredFiles.map(file => (
                    <FileCard
                      key={file.id}
                      file={file}
                      trashed={trashed}
                      selected={selectedIds.has(file.id)}
                      preSelected={preSelectedIds.has(file.id)}
                      focused={cursorId === file.id}
                      onSelect={handleItemSelect}
                      onContextMenu={e => onOpenMenu(e, 'file', file)}
                      onDragStart={() => {
                        if (!selectedIds.has(file.id)) { setSelectedIds(new Set([file.id])); lastSelectedIdxRef.current = orderedIds.indexOf(file.id) }
                        setDraggingItem({ type: 'file', id: file.id })
                      }}
                      onRestore={() => onRestoreFile(file.id)}
                      onDelete={() => onDeleteFile(file.id)}
                      onOpen={() => onOpenFile(file)}
                      thumbH={spec.thumbH}
                      iconScale={spec.iconScale}
                      dense={spec.dense}
                    />
                  ))}
                </div>
              )
            }
            if (spec.multicol) {
              return (
                <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))', gap: 2 }}>
                  {filteredFiles.map(file => (
                    <FileRow key={file.id} file={file} trashed={trashed} {...sel(file)} onContextMenu={e => onOpenMenu(e, 'file', file)} onRestore={() => onRestoreFile(file.id)} onDelete={() => onDeleteFile(file.id)} onOpen={() => onOpenFile(file)} density="compact" hideMeta />
                  ))}
                </div>
              )
            }
            return (
              <div className="divide-y divide-border rounded-xl border border-border overflow-hidden">
                {filteredFiles.map(file => (
                  <FileRow key={file.id} file={file} trashed={trashed} {...sel(file)} onContextMenu={e => onOpenMenu(e, 'file', file)} onRestore={() => onRestoreFile(file.id)} onDelete={() => onDeleteFile(file.id)} onOpen={() => onOpenFile(file)} density={spec.density} />
                ))}
              </div>
            )
          })()}
        </section>
      )}
    </div>
  )
}
