import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { AppWindow, CopyPlus, Link2, Lock, Tags, Unlock, Wand2 } from 'lucide-react'
import {
  filesApi, formatSize, useBatchRenameStore, useFilesDialogStore, useFilesPaintStore, useFilesStore,
  type BatchRenameItem, type FileContextAction, type FileItem, type Folder,
} from '@kubuno/drive'
import { FileTypeRegistry, SlotRegistry, useConfirm, useModulesStore } from '@kubuno/sdk'
import type { MenuItem } from '@ui'
import { useDriveExtras } from '../driveExtras'
import { useFilesContextMenuStore } from '../filesContextMenuStore'
import {
  purgeFileVersions, versionBytes, versionCount, VERSIONS_SUMMARY_KEY, type FileVersionStats,
} from '../fileVersions'
import type { ItemMenuHandlers } from './itemMenu'
import type { MenuTarget, MoveTarget } from './types'
import type { DriveDialogs } from './useDriveDialogs'
import type { DriveMutations } from './useDriveMutations'

interface Args {
  folderId:    string | null
  folders:     Folder[]
  files:       FileItem[]
  orderedIds:  string[]
  itemTypeMap: Map<string, 'file' | 'folder'>
  selectedIds: Set<string>
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>
  lastSelectedIdxRef: React.RefObject<number>
  playingFileIds: Set<string>
  dialogs:   DriveDialogs
  mutations: DriveMutations
  confirm:   ReturnType<typeof useConfirm>['confirm']
}

/** Item context menu: target state, "open with" entries and every action. */
export function useDriveItemMenu({
  folderId, folders, files, orderedIds, itemTypeMap, selectedIds, setSelectedIds,
  lastSelectedIdxRef, playingFileIds, dialogs, mutations, confirm,
}: Args) {
  const { t } = useTranslation('drive')
  const qc = useQueryClient()
  const routerNavigate = useNavigate()
  const { clipboard, setClipboard, clearClipboard } = useFilesStore()
  const lockedMap = useDriveExtras(s => s.locks)
  const activeModules = useModulesStore(s => s.activeModules)
  const activeIds     = useMemo(() => new Set(activeModules.map(m => m.module_id)), [activeModules])
  const {
    invalidateAll, scheduleDelete,
    starFolderMut, restoreFolderMut, starFileMut, restoreFileMut,
  } = mutations

  const [menu, setMenu] = useState<MenuTarget>(null)

  const { register: registerContextMenu, unregister: unregisterContextMenu, setContextMenuFolderId } = useFilesContextMenuStore()
  useEffect(() => {
    registerContextMenu((folder, x, y) => {
      setMenu({ type: 'folder', item: folder, x, y })
    })
    return () => unregisterContextMenu()
  }, [registerContextMenu, unregisterContextMenu])

  const closeMenu = useCallback(() => { setMenu(null); setContextMenuFolderId(null) }, [setContextMenuFolderId])

  // Items of the "Open with" submenu for a given file (apps + contributors).
  const openWithItemsFor = useCallback((file: FileItem): MenuItem[] => {
    const out: MenuItem[] = FileTypeRegistry.openersFor(file).map((decl) => ({
      type: 'action' as const,
      label: decl.label,
      icon: <AppWindow size={14} />,
      onClick: () => { decl.open?.(file, routerNavigate); filesApi.setOpenWith(file.id, decl.moduleId).catch(() => {}) },
    }))
    const contributors = SlotRegistry.getSlot('files-open-with') as Array<{ moduleId: string; Component: React.ComponentType; match?: (f: FileItem) => boolean }>
    contributors
      .filter((e) => activeIds.has(e.moduleId))
      .filter((e) => !e.match || e.match(file))
      .forEach((e) => { const C = e.Component; out.push({ type: 'custom', render: () => <C key={e.moduleId} /> }) })
    return out
  }, [activeIds, routerNavigate])

  const openWithItems = useMemo<MenuItem[]>(
    () => (menu && menu.type === 'file' ? openWithItemsFor(menu.item as FileItem) : []),
    [menu, openWithItemsFor],
  )

  // Drive actions injected into StorageExplorer (My Drive) → parity with the
  // custom views. visible() reads the lock state when the menu opens.
  const driveContextActions = useMemo<FileContextAction[]>(() => [
    { id: 'tags',      label: 'Étiquettes…',       icon: Tags,    onClick: (f) => dialogs.setTagDialogTarget({ kind: 'file', id: f.id, name: f.name }) },
    { id: 'editimg',   label: 'Ajuster l’image',   icon: Wand2,   visible: (f) => f.mime_type.startsWith('image/'), onClick: (f) => dialogs.setImageEditFile(f) },
    { id: 'lock',      label: 'Verrouiller',       icon: Lock,    visible: (f) => !useDriveExtras.getState().locks[f.id], onClick: (f) => { void useDriveExtras.getState().lockFile(f.id).catch(() => {}) } },
    { id: 'unlock',    label: 'Déverrouiller',     icon: Unlock,  visible: (f) => !!useDriveExtras.getState().locks[f.id], onClick: (f) => { void useDriveExtras.getState().unlockFile(f.id).catch(() => {}) } },
    { id: 'advshare',  label: 'Partage avancé…',   icon: Link2,   onClick: (f) => dialogs.setAdvShareTarget({ kind: 'file', id: f.id, name: f.name }) },
    { id: 'duplicate', label: 'Dupliquer',         icon: CopyPlus, onClick: (f) => { void filesApi.copyFile(f.id, folderId).then(() => qc.invalidateQueries({ queryKey: ['files'] })) } },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [folderId, qc])

  // ── Menu handlers ───────────────────────────────────────────────────────────

  const openMenu = (e: React.MouseEvent, type: 'folder' | 'file', item: Folder | FileItem) => {
    e.preventDefault()
    e.stopPropagation()
    // Right-clicking an item outside the current selection makes it the sole
    // selection; right-clicking within a multi-selection keeps it.
    if (!selectedIds.has(item.id)) {
      setSelectedIds(new Set([item.id]))
      lastSelectedIdxRef.current = orderedIds.indexOf(item.id)
    }
    const vw = window.innerWidth
    const vh = window.innerHeight
    const x  = Math.min(e.clientX, vw - 200)
    const y  = Math.min(e.clientY, vh - 280)
    setMenu({ type, item, x, y } as MenuTarget)
  }

  const handleMenuStar = () => {
    if (!menu) return
    if (menu.type === 'folder') starFolderMut.mutate(menu.item.id)
    else                        starFileMut.mutate(menu.item.id)
  }
  const handleMenuTrash = (permanent = false) => {
    if (!menu) return
    scheduleDelete(permanent ? 'permanent' : 'trash', [{ id: menu.item.id, type: menu.type }])
  }
  const handleMenuDelete = () => {
    if (!menu) return
    scheduleDelete('permanent', [{ id: menu.item.id, type: menu.type }])
  }
  const handleMenuRestore = () => {
    if (!menu) return
    if (menu.type === 'folder') restoreFolderMut.mutate(menu.item.id)
    else                        restoreFileMut.mutate(menu.item.id)
  }

  const handleMenuCut = () => {
    if (!menu) return
    setClipboard({ action: 'cut', type: menu.type, id: menu.item.id, name: menu.item.name })
  }

  const handleMenuCopy = () => {
    if (!menu) return
    setClipboard({ action: 'copy', type: menu.type, id: menu.item.id, name: menu.item.name })
  }

  const handleMenuPaste = (targetFolderId: string | null) => {
    if (!clipboard) return
    if (clipboard.action === 'copy' && clipboard.type === 'file') {
      filesApi.copyFile(clipboard.id, targetFolderId)
        .then(() => qc.invalidateQueries({ queryKey: ['files'] }))
    } else if (clipboard.action === 'cut' && clipboard.type === 'file') {
      filesApi.moveFile(clipboard.id, targetFolderId)
        .then(() => { qc.invalidateQueries({ queryKey: ['files'] }); clearClipboard() })
    } else if (clipboard.action === 'cut' && clipboard.type === 'folder') {
      filesApi.moveFolder(clipboard.id, targetFolderId)
        .then(() => { (qc.invalidateQueries({ queryKey: ['folders'] }), qc.invalidateQueries({ queryKey: ['tree-children'] })); clearClipboard() })
    }
  }

  const handleMenuCompress = () => {
    if (!menu) return
    const name = menu.item.name
    if (menu.type === 'file') {
      filesApi.compressDownload([menu.item.id], [], name + '.zip')
    } else if (menu.type === 'folder') {
      filesApi.compressDownload([], [menu.item.id], name + '.zip')
    }
  }

  const handleCompressSave = async () => {
    if (!menu) return
    const useSelection = selectedIds.size > 1 && selectedIds.has(menu.item.id)
    const baseName = useSelection
      ? 'archive.zip'
      : menu.item.name.replace(/\.zip$/i, '') + '.zip'
    const result = await useFilesDialogStore.getState().saveFile({
      defaultName:     baseName,
      defaultFolderId: folderId,
    })
    if (!result) return
    const fileIds   = useSelection
      ? [...selectedIds].filter(id => itemTypeMap.get(id) === 'file')
      : menu.type === 'file' ? [menu.item.id] : []
    const folderIds = useSelection
      ? [...selectedIds].filter(id => itemTypeMap.get(id) === 'folder')
      : menu.type === 'folder' ? [menu.item.id] : []
    filesApi.compressSave(fileIds, folderIds, result.name, result.folderId)
      .then(() => invalidateAll())
      .catch(() => {})
  }

  const handleDecompress = () => {
    if (!menu || menu.type !== 'file') return
    filesApi.decompress(menu.item.id, folderId, true)
      .then(() => invalidateAll())
      .catch(() => {})
  }

  const handleSetFolderColor = (color: string | null) => {
    if (!menu || menu.type !== 'folder') return
    filesApi.setFolderColor(menu.item.id, color)
      .then(() => (qc.invalidateQueries({ queryKey: ['folders'] }), qc.invalidateQueries({ queryKey: ['tree-children'] })))
  }

  const handleGetLink = async () => {
    if (!menu) return
    try {
      const opts = menu.type === 'file'
        ? { file_id: menu.item.id, can_download: true }
        : { folder_id: menu.item.id, can_download: true }
      const { share } = await filesApi.createShare(opts)
      if (share.token) {
        const url = `${window.location.origin}/api/v1/drive/share/${share.token}`
        await navigator.clipboard.writeText(url)
      }
    } catch (_) { /* silently ignore */ }
  }

  // Purging a history is destructive and irreversible, so the dialog spells out
  // exactly what it costs and what it gives back — how many revisions disappear
  // and how many bytes return to the quota. That sentence IS the feature: without
  // it there is nothing to decide on. The file is captured synchronously because
  // clicking the entry closes the menu and clears `menu`.
  const handlePurgeVersions = async () => {
    if (!menu || menu.type !== 'file') return
    const file = menu.item as FileItem & FileVersionStats
    const ok = await confirm({
      title:        t('version.purge_title'),
      message:      t('version.purge_msg', {
        count: versionCount(file),
        name:  file.name,
        size:  formatSize(versionBytes(file)),
      }),
      variant:      'danger',
      confirmLabel: t('version.purge_confirm'),
    })
    if (!ok) return
    try {
      await purgeFileVersions(file.id)
    } catch {
      await confirm({
        title:        t('version.purge_failed_title'),
        message:      t('version.purge_failed'),
        variant:      'warning',
        hideCancel:   true,
        confirmLabel: t('common.ok', { defaultValue: 'OK' }),
      })
      return
    }
    // Same refresh path as the other destructive actions: the listing carries the
    // version counters, and invalidateAll() also re-reads /me so the header quota
    // gauge drops by the freed amount.
    qc.invalidateQueries({ queryKey: VERSIONS_SUMMARY_KEY })
    invalidateAll()
  }

  const isMenuItemPlaying = useMemo(
    () => menu?.type === 'file' && playingFileIds.has((menu.item as FileItem).id),
    [menu, playingFileIds],
  )

  const menuHandlers: ItemMenuHandlers | null = menu ? {
    isTrashed: menu.item.is_trashed,
    isPlaying: isMenuItemPlaying,
    isLocked: menu.type === 'file' && !!lockedMap[menu.item.id],
    isMultiSelection: selectedIds.size > 1 && selectedIds.has(menu.item.id),
    selectionCount: selectedIds.size,
    clipboard,
    onClose: closeMenu,
    onRename: () => {
      // Batch rename (PowerRename) for EVERY rename: on the selection when
      // several items are selected, otherwise on the single clicked item.
      const multi = selectedIds.size > 1 && selectedIds.has(menu.item.id)
      const ids = multi ? [...selectedIds] : [menu.item.id]
      const out: BatchRenameItem[] = []
      for (const id of ids) {
        const fo = folders.find(x => x.id === id)
        if (fo) { out.push({ id: fo.id, name: fo.name, type: 'folder' }); continue }
        const fi = files.find(x => x.id === id)
        if (fi) out.push({ id: fi.id, name: fi.name, type: 'file' })
      }
      useBatchRenameStore.getState().start(out)
    },
    onMove: () => { dialogs.setMoveTarget({ type: menu.type, item: menu.item } as MoveTarget) },
    onStar: handleMenuStar,
    onTrash: handleMenuTrash,
    onDelete: handleMenuDelete,
    onRestore: handleMenuRestore,
    onShare: () => {
      if (menu.type === 'file')   dialogs.setShareTarget({ type: 'file',   item: menu.item as FileItem })
      if (menu.type === 'folder') dialogs.setShareTarget({ type: 'folder', item: menu.item as Folder })
    },
    onGetLink: handleGetLink,
    onAdvancedShare: () => dialogs.setAdvShareTarget({ kind: menu.type, id: menu.item.id, name: menu.item.name }),
    onInfo: () => {
      if (menu.type === 'file')   dialogs.setInfoTarget({ type: 'file',   item: menu.item as FileItem })
      if (menu.type === 'folder') dialogs.setInfoTarget({ type: 'folder', item: menu.item as Folder })
    },
    onEditPaint: () => {
      if (menu.type === 'file') useFilesPaintStore.getState().openEditor(menu.item as FileItem)
    },
    onVersionHistory: () => {
      if (menu.type === 'file') dialogs.setVersionTarget(menu.item as FileItem)
    },
    onPurgeVersions: () => { void handlePurgeVersions() },
    onCut: handleMenuCut,
    onCopy: handleMenuCopy,
    onPaste: () => {
      const targetId = menu.type === 'folder' ? menu.item.id : folderId
      handleMenuPaste(targetId)
    },
    onCompress: handleMenuCompress,
    onCompressSave: handleCompressSave,
    onDecompress: handleDecompress,
    onSetColor: handleSetFolderColor,
    onTags: () => dialogs.setTagDialogTarget({ kind: menu.type, id: menu.item.id, name: menu.item.name }),
    onLock: () => { void useDriveExtras.getState().lockFile(menu.item.id).catch(() => {}) },
    onUnlock: () => { void useDriveExtras.getState().unlockFile(menu.item.id).catch(() => {}) },
    onEditImage: () => { if (menu.type === 'file') dialogs.setImageEditFile(menu.item as FileItem) },
    openWithItems,
    onDuplicate: () => {
      if (menu.type === 'file') {
        void filesApi.copyFile(menu.item.id, folderId).then(() => qc.invalidateQueries({ queryKey: ['files'] }))
      }
    },
  } : null

  return { menu, menuHandlers, openMenu, closeMenu, openWithItemsFor, driveContextActions }
}
