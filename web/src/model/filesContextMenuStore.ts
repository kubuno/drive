import { create } from 'zustand'
import type { Folder } from '@kubuno/drive'
// FilesApp registers openFolderMenu on mount; FilesTreeSidebar calls it.
interface FilesContextMenuStore {
  openFolderMenu:        ((folder: Folder, x: number, y: number) => void) | null
  /** ID du dossier sur lequel le menu contextuel est actuellement ouvert. */
  contextMenuFolderId:   string | null
  register:              (fn: (folder: Folder, x: number, y: number) => void) => void
  unregister:            () => void
  setContextMenuFolderId: (id: string | null) => void
}

export const useFilesContextMenuStore = create<FilesContextMenuStore>((set) => ({
  openFolderMenu:        null,
  contextMenuFolderId:   null,
  register:   fn  => set({ openFolderMenu: fn }),
  unregister: ()  => set({ openFolderMenu: null }),
  setContextMenuFolderId: (id) => set({ contextMenuFolderId: id }),
}))
