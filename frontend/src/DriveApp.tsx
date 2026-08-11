import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { CloudUpload } from 'lucide-react'
import { StorageExplorer, localSource, useFilesStore, type FileItem } from '@kubuno/drive'
import { api, useAuthStore, useConfirm, type User } from '@kubuno/sdk'
import { ConfirmDialog } from '@ui'
import { useDriveExtras } from './driveExtras'
import { recentSource, starredSource, sharedSource } from './driveSources'
import DriveContentGrid from './drive-app/DriveContentGrid'
import DriveContextMenu from './drive-app/DriveContextMenu'
import DriveDialogs from './drive-app/DriveDialogs'
import DriveToolbar from './drive-app/DriveToolbar'
import DriveViewersLayer from './drive-app/DriveViewersLayer'
import ImageSearchResultsView from './drive-app/ImageSearchResultsView'
import SearchResultsView from './drive-app/SearchResultsView'
import { isPreviewable } from './drive-app/fileKinds'
import { useDriveBulkActions } from './drive-app/useDriveBulkActions'
import { useDriveDialogs } from './drive-app/useDriveDialogs'
import { useDriveImport } from './drive-app/useDriveImport'
import { useDriveItemMenu } from './drive-app/useDriveItemMenu'
import { useDriveListing } from './drive-app/useDriveListing'
import { useDriveMutations } from './drive-app/useDriveMutations'
import { useDriveSearchUrlSync } from './drive-app/useDriveSearchUrlSync'
import { useDriveSelection } from './drive-app/useDriveSelection'
import { useDriveViewers } from './drive-app/useDriveViewers'
import { useDriveViewOptions } from './drive-app/useDriveViewOptions'

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  starred?: boolean
  shared?:  boolean
  recent?:  boolean
  trashed?: boolean
}

export default function DriveApp({ starred = false, shared = false, recent = false, trashed = false }: Props) {
  const { t } = useTranslation('drive')
  const [searchParams, setSearchParams] = useSearchParams()
  const folderId = (starred || shared || recent || trashed) ? null : (searchParams.get('folder') ?? null)
  // Local source for the normal view, delegated to StorageExplorer (unified area).
  const driveSource = useMemo(() => localSource(), [])
  // Virtual sources of the special views: same explorer, overridden source.
  const recentSrc  = useMemo(() => recentSource(), [])
  const starredSrc = useMemo(() => starredSource(), [])
  const sharedSrc  = useMemo(() => sharedSource(), [])

  const { confirm, confirmState, handleConfirm, handleCancel } = useConfirm()

  const {
    refreshKey,
    openNewFolder,
    setCurrentFolderId,
    searchQuery, searchFilters, searchApplied, clearSearch,
    imageSearch, clearImageSearch,
  } = useFilesStore()

  const { updateUser } = useAuthStore()
  const refreshUser = useCallback(() => {
    api.get<{ user: User }>('/me').then(res => updateUser(res.data.user)).catch(() => {})
  }, [updateUser])

  const isSearchMode = searchApplied || searchQuery.trim().length > 0
  // "Plain" normal view (no search, no special view) → delegated to StorageExplorer.
  const isPlainNormal = !imageSearch && !isSearchMode && !starred && !shared && !recent && !trashed
  // Special views delegated to the shared explorer through a virtual source
  // (unless a search is active → dedicated results view).
  const searchActive  = isSearchMode || !!imageSearch
  const specialSource = searchActive ? null
                      : recent ? recentSrc
                      : starred ? starredSrc
                      : shared ? sharedSrc
                      : null
  const specialTitle  = recent ? t('nav.recent', { defaultValue: 'Récents' })
                      : starred ? t('tree.starred', { defaultValue: 'Étoilés' })
                      : shared ? t('nav.shared', { defaultValue: 'Partagés avec moi' })
                      : ''

  const navigate = (id: string | null) => {
    if (id) setSearchParams({ folder: id })
    else setSearchParams({})
  }

  useEffect(() => { setCurrentFolderId(folderId); return () => setCurrentFolderId(null) }, [folderId, setCurrentFolderId])

  // Load cross-cutting extras (tags, locks, saved searches) once on mount.
  useEffect(() => { void useDriveExtras.getState().loadAll().catch(() => {}) }, [])

  // Search persisted in the URL so F5 replays it.
  useDriveSearchUrlSync(searchQuery)

  // ── State composition ─────────────────────────────────────────────────────

  const view      = useDriveViewOptions()
  const listing   = useDriveListing({ folderId, starred, shared, recent, trashed, refreshKey, view })
  const viewers   = useDriveViewers()
  const dialogs   = useDriveDialogs()
  const selection = useDriveSelection({
    orderedIds: listing.orderedIds,
    folders:    listing.folders,
    files:      listing.files,
    trashed,
    openFile:   viewers.openFile,
    navigate,
  })
  const mutations = useDriveMutations({ folderId, navigate, confirm, refreshUser })
  const imports   = useDriveImport({
    folderId,
    selectedIds: selection.selectedIds,
    itemTypeMap: listing.itemTypeMap,
    refreshUser,
  })
  const bulk = useDriveBulkActions({
    folderId,
    selectedIds:    selection.selectedIds,
    setSelectedIds: selection.setSelectedIds,
    itemTypeMap:    listing.itemTypeMap,
    mutations,
    confirm,
  })
  const itemMenu = useDriveItemMenu({
    folderId,
    folders:     listing.folders,
    files:       listing.files,
    orderedIds:  listing.orderedIds,
    itemTypeMap: listing.itemTypeMap,
    selectedIds:        selection.selectedIds,
    setSelectedIds:     selection.setSelectedIds,
    lastSelectedIdxRef: selection.lastSelectedIdxRef,
    playingFileIds:     viewers.playingFileIds,
    dialogs,
    mutations,
    confirm,
  })

  // Previewable files for the previewer's ←/→ navigation: the current search
  // results while searching, otherwise the current folder view (in display order).
  const [searchPreviewFiles, setSearchPreviewFiles] = useState<FileItem[]>([])
  const previewNavFiles = useMemo(
    () => (isSearchMode ? searchPreviewFiles : listing.filteredFiles.filter(isPreviewable)),
    [isSearchMode, searchPreviewFiles, listing.filteredFiles],
  )

  const hasProtectedInSelection = useMemo(
    () => listing.folders.some(f => f.is_protected && selection.selectedIds.has(f.id)),
    [listing.folders, selection.selectedIds],
  )

  const hasPlayingInSelection = useMemo(
    () => [...selection.selectedIds].some(id => viewers.playingFileIds.has(id)),
    [selection.selectedIds, viewers.playingFileIds],
  )

  const pageTitle = trashed ? t('nav.trash')
    : starred ? t('tree.starred')
    : shared  ? t('nav.shared')
    : recent  ? t('nav.recent')
    : null  // handled by Breadcrumb

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      className="relative flex h-full overflow-hidden"
      onDragEnter={imports.handleDragEnter}
      onDragLeave={imports.handleDragLeave}
      onDragOver={imports.handleDragOver}
      onDrop={e => imports.handleDrop(e)}
    >
      {/* Hidden inputs — ids exposed so the toolbar can target them via <label> */}
      <input id="files-upload-input" ref={imports.fileInputRef}   type="file" multiple hidden onChange={imports.handleFileInput} />
      <input
        id="files-folder-input"
        ref={imports.folderInputRef}
        type="file"
        multiple
        hidden
        // @ts-expect-error — non-standard attribute but widely supported
        webkitdirectory="true"
        onChange={imports.handleFolderInput}
      />

      {/* Drag & drop overlay — only for DriveApp's own views; the normal view
          delegates to StorageExplorer, which renders its own drop overlay (avoids
          a doubled "Drop here to import"). */}
      {imports.isDragOver && !isPlainNormal && (
        <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center
                        justify-center gap-3 rounded-2xl border-2 border-dashed border-primary
                        bg-primary/5 transition-all">
          <CloudUpload size={52} className="text-primary opacity-80" />
          <p className="text-primary font-medium text-sm">{t('mfb.drop_here')}</p>
          <p className="text-primary/60 text-xs">{t('app.accepted')}</p>
        </div>
      )}

      {/* Unified normal view: shared exploration area (StorageExplorer). */}
      {isPlainNormal && (
        <StorageExplorer
          source={driveSource}
          pathParam="folder"
          title={t('nav.my_drive', { defaultValue: 'Mon Drive' })}
          onOpenFile={f => { viewers.openFile(f); return true }}
          fileContextActions={itemMenu.driveContextActions}
        />
      )}

      {/* Special views (Recent/Starred…): shared explorer + virtual source. */}
      {specialSource && (
        <StorageExplorer
          source={specialSource}
          title={specialTitle}
          onOpenFile={f => { viewers.openFile(f); return true }}
          /* Shared = read-only (not the owner) → no Drive actions. */
          fileContextActions={shared ? [] : itemMenu.driveContextActions}
        />
      )}

      {/* Search + other special views (Trash/Shared) — rendered by DriveApp. */}
      {!isPlainNormal && !specialSource && (
      <div
        ref={selection.marqueeContainerRef}
        className="flex-1 min-w-0 overflow-y-auto p-6"
        onPointerDown={selection.onMarqueeDown}
        onPointerMove={selection.onMarqueeMove}
        onPointerUp={selection.onMarqueeUp}
        onPointerCancel={selection.onMarqueeCancel}
      >
        {/* Similar-image search (camera) — takes precedence */}
        {imageSearch && (
          <ImageSearchResultsView state={imageSearch} onClear={clearImageSearch} onOpen={viewers.openFile} />
        )}

        {/* Text search mode */}
        {!imageSearch && isSearchMode && (
          <SearchResultsView
            searchQuery={searchQuery}
            searchFilters={searchFilters}
            onClear={clearSearch}
            onOpen={viewers.openFile}
            onResults={setSearchPreviewFiles}
          />
        )}

        {/* Normal view */}
        {!imageSearch && !isSearchMode && (
          <>
            {/* Inline toolbar: breadcrumb + controls */}
            <DriveToolbar
              currentFolder={listing.currentFolder}
              ancestors={listing.ancestors}
              pageTitle={pageTitle ?? t('nav.my_files')}
              onNavigate={navigate}
              trashed={trashed}
              starred={starred}
              shared={shared}
              recent={recent}
              selectedCount={selection.selectedIds.size}
              allItemsSelected={selection.allItemsSelected}
              onToggleSelectAll={selection.toggleSelectAll}
              deleteDisabled={hasProtectedInSelection || hasPlayingInSelection || selection.selectedIds.size === 0}
              purgePending={mutations.purgeTrashMut.isPending}
              bulk={bulk}
              onImportFiles={() => imports.fileInputRef.current?.click()}
              onImportFolder={() => imports.folderInputRef.current?.click()}
              onNewFolder={openNewFolder}
            />

            <DriveContentGrid
              folders={listing.folders}
              files={listing.files}
              filteredFiles={listing.filteredFiles}
              isLoading={listing.isLoading}
              hasError={listing.filesError}
              trashed={trashed}
              starred={starred}
              shared={shared}
              recent={recent}
              view={view}
              selection={selection}
              orderedIds={listing.orderedIds}
              dragOverFolderId={imports.dragOverFolderId}
              setDragOverFolderId={imports.setDragOverFolderId}
              setDraggingItem={imports.setDraggingItem}
              onDropOnFolder={(e, id) => imports.handleDrop(e, id)}
              onNavigate={navigate}
              onOpenMenu={itemMenu.openMenu}
              onOpenFile={viewers.openFile}
              onRestoreFile={(id) => mutations.restoreFileMut.mutate(id)}
              onDeleteFile={(id) => mutations.scheduleDelete('permanent', [{ id, type: 'file' }])}
            />
          </>
        )}
      </div>
      )}

      {/* Context menu */}
      {itemMenu.menu && itemMenu.menuHandlers && (
        <DriveContextMenu
          menu={itemMenu.menu}
          handlers={itemMenu.menuHandlers}
          onClose={itemMenu.closeMenu}
        />
      )}

      {/* Marquee selection overlay */}
      {selection.marqueeStyle && selection.marqueeStyle.width > 2 && selection.marqueeStyle.height > 2 && (
        <div
          className="pointer-events-none z-50 rounded border border-primary/50 bg-primary/10"
          style={selection.marqueeStyle as CSSProperties}
        />
      )}

      <DriveDialogs
        dialogs={dialogs}
        folderId={folderId}
        folders={listing.folders}
        files={listing.files}
        archiveFile={viewers.archiveFile}
        onCloseArchive={() => viewers.setArchiveFile(null)}
        onOpenFile={viewers.openFile}
        conflictDialog={imports.conflictDialog}
      />

      <DriveViewersLayer
        viewers={viewers}
        dialogs={dialogs}
        previewNavFiles={previewNavFiles}
        openWithItemsFor={itemMenu.openWithItemsFor}
      />

      {confirmState && (
        <ConfirmDialog {...confirmState} onConfirm={handleConfirm} onCancel={handleCancel} />
      )}
    </div>
  )
}
