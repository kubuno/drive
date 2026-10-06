/**
 * The parts of `DriveApp.kbview` still written in React (the codemod could not convert them; see the
 * TODO comments in the view). Each is rendered by a `<ReactHost>` with the values it reads as props.
 */
import { type CSSProperties } from "react"
import DriveContentGrid from "./drive-app/DriveContentGrid"
import DriveToolbar from "./drive-app/DriveToolbar"
import ImageSearchResultsView from "./drive-app/ImageSearchResultsView"
import SearchResultsView from "./drive-app/SearchResultsView"
import type { DriveApp } from './DriveApp'

export function Part1({ imports }: { imports: NonNullable<DriveApp['imports']> }) {
  return (
    <input id="files-upload-input" ref={imports.fileInputRef}   type="file" multiple hidden onChange={imports.handleFileInput} />
  )
}

export function Part2({ imports }: { imports: NonNullable<DriveApp['imports']> }) {
  return (
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
  )
}

export function Part3({ selection, imageSearch, clearImageSearch, viewers, isSearchMode, searchQuery, searchFilters, clearSearch, setSearchPreviewFiles, listing, pageTitle, t, navigate, trashed, starred, shared, recent, hasProtectedInSelection, hasPlayingInSelection, mutations, bulk, imports, openNewFolder, view, itemMenu }: { selection: NonNullable<DriveApp['selection']>; imageSearch: DriveApp['imageSearch']; clearImageSearch: NonNullable<DriveApp['clearImageSearch']>; viewers: NonNullable<DriveApp['viewers']>; isSearchMode: NonNullable<DriveApp['isSearchMode']>; searchQuery: NonNullable<DriveApp['searchQuery']>; searchFilters: NonNullable<DriveApp['searchFilters']>; clearSearch: NonNullable<DriveApp['clearSearch']>; setSearchPreviewFiles: NonNullable<DriveApp['setSearchPreviewFiles']>; listing: NonNullable<DriveApp['listing']>; pageTitle: DriveApp['pageTitle']; t: NonNullable<DriveApp['tr']>; navigate: DriveApp['navigate']; trashed: NonNullable<DriveApp['trashed']>; starred: NonNullable<DriveApp['starred']>; shared: NonNullable<DriveApp['shared']>; recent: NonNullable<DriveApp['recent']>; hasProtectedInSelection: NonNullable<DriveApp['hasProtectedInSelection']>; hasPlayingInSelection: NonNullable<DriveApp['hasPlayingInSelection']>; mutations: NonNullable<DriveApp['mutations']>; bulk: NonNullable<DriveApp['bulk']>; imports: NonNullable<DriveApp['imports']>; openNewFolder: NonNullable<DriveApp['openNewFolder']>; view: NonNullable<DriveApp['view']>; itemMenu: NonNullable<DriveApp['itemMenu']> }) {
  return (
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
  )
}

export function Part4({ selection_marqueeStyle }: { selection_marqueeStyle: NonNullable<NonNullable<DriveApp['selection']>['marqueeStyle']> }) {
  return (
    <div
              className="pointer-events-none z-50 rounded border border-primary/50 bg-primary/10"
              style={selection_marqueeStyle as CSSProperties}
            />
  )
}
