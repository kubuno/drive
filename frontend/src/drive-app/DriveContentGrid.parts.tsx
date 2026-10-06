/**
 * The parts of `DriveContentGrid.kbview` still written in React (the codemod could not convert them; see the
 * TODO comments in the view). Each is rendered by a `<ReactHost>` with the values it reads as props.
 */
import { VIEW_SPECS } from "@kubuno/drive"
import FolderCard from "./FolderCard"
import type { DriveContentGrid } from './DriveContentGrid'

export function Part1({ view, folders, dragOverFolderId, selectedIds, preSelectedIds, cursorId, trashed, handleItemSelect, onNavigate, onOpenMenu, setSelectedIds, lastSelectedIdxRef, orderedIds, setDraggingItem, setDragOverFolderId, onDropOnFolder }: { view: NonNullable<DriveContentGrid['props']['view']>; folders: NonNullable<DriveContentGrid['props']['folders']>; dragOverFolderId: DriveContentGrid['props']['dragOverFolderId']; selectedIds: NonNullable<DriveContentGrid['selectedIds']>; preSelectedIds: NonNullable<DriveContentGrid['preSelectedIds']>; cursorId: DriveContentGrid['cursorId']; trashed: NonNullable<DriveContentGrid['props']['trashed']>; handleItemSelect: NonNullable<DriveContentGrid['handleItemSelect']>; onNavigate: NonNullable<DriveContentGrid['props']['onNavigate']>; onOpenMenu: NonNullable<DriveContentGrid['props']['onOpenMenu']>; setSelectedIds: NonNullable<DriveContentGrid['setSelectedIds']>; lastSelectedIdxRef: NonNullable<DriveContentGrid['lastSelectedIdxRef']>; orderedIds: NonNullable<DriveContentGrid['props']['orderedIds']>; setDraggingItem: NonNullable<DriveContentGrid['props']['setDraggingItem']>; setDragOverFolderId: NonNullable<DriveContentGrid['props']['setDragOverFolderId']>; onDropOnFolder: NonNullable<DriveContentGrid['props']['onDropOnFolder']> }) {
  return (
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
  )
}
