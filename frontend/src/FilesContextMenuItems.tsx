/**
 * Background context menu of the Drive view — DATA for the project's menu
 * component (`MenuDropdown` from @ui), contributed through the shell's
 * 'shell.context-menu-items' extension point (see entry.ts). The function is
 * evaluated on every right-click, so labels and store state are always fresh,
 * without hooks.
 */
import type { MenuItem } from '@ui'
import { FolderPlus, Upload, RefreshCw, Plus, ClipboardPaste, Pencil, Files as FilesIcon, BarChart3 } from 'lucide-react'
import { useFilesStore, filesApi, useBatchRenameStore } from '@kubuno/drive'
import { ExtensionRegistry, i18n, useModulesStore } from '@kubuno/sdk'
import { useDriveExtras } from './driveExtras'
import { DRIVE_NEW_ACTIONS, type DriveNewActionsProvider } from './FilesNewActions'

// Read the stores at click time, not at build time — actions stay fresh.
const files = () => useFilesStore.getState()

/** Paste whatever the Drive clipboard holds into the current folder. */
function paste(): void {
  const { clipboard, currentFolderId, clearClipboard, refresh } = files()
  if (!clipboard) return
  // `refresh()` bumps the key every folders/files/tree-children query is built
  // from, so it refetches the very lists the former invalidateQueries targeted —
  // and needs no React Query client, out of reach from this plain function.
  if (clipboard.action === 'copy' && clipboard.type === 'file') {
    void filesApi.copyFile(clipboard.id, currentFolderId).then(() => refresh())
  } else if (clipboard.action === 'cut' && clipboard.type === 'file') {
    void filesApi.moveFile(clipboard.id, currentFolderId).then(() => { refresh(); clearClipboard() })
  } else if (clipboard.action === 'cut' && clipboard.type === 'folder') {
    void filesApi.moveFolder(clipboard.id, currentFolderId).then(() => { refresh(); clearClipboard() })
  }
}

/** Batch rename over the WHOLE current folder (right-click on empty space). */
async function batchRenameFolder(): Promise<void> {
  const folderId = files().currentFolderId
  const [sf, ff] = await Promise.all([
    filesApi.listFolders(folderId),
    filesApi.listFiles(folderId),
  ])
  useBatchRenameStore.getState().start([
    ...sf.folders.map(f => ({ id: f.id, name: f.name, type: 'folder' as const })),
    ...ff.files.map(f => ({ id: f.id, name: f.name, type: 'file' as const })),
  ])
}

/** Content of the "New" submenu: Drive's own entry, then the contributions of
 *  other ACTIVE modules read from the shared 'drive.new-actions' point (the very
 *  point the sidebar "New" button uses — no dedicated context-menu channel). */
function newSubmenuItems(): MenuItem[] {
  const items: MenuItem[] = [
    {
      type: 'action',
      label: i18n.t('drive:newfolder.title'),
      icon: <FolderPlus size={16} />,
      onClick: () => files().openNewFolder(),
    },
  ]

  const activeIds = new Set(
    useModulesStore.getState().activeModules.map((m) => m.module_id),
  )
  const contributed = ExtensionRegistry.getAll<DriveNewActionsProvider>(DRIVE_NEW_ACTIONS)
    .filter((p) => activeIds.has(p.moduleId))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .flatMap((p) => p.items())
  if (contributed.length > 0) items.push({ type: 'separator' }, ...contributed)

  return items
}

export function filesContextMenuItems(): MenuItem[] {
  if (!window.location.pathname.startsWith('/drive')) return []

  const t = (key: string) => i18n.t(`drive:${key}`)
  const { clipboard } = files()

  const items: MenuItem[] = [
    // Native MenuDropdown submenu — it portals and flips on its own, which the
    // former hand-rolled panel had to do by hand.
    {
      type: 'submenu',
      label: t('actions.new'),
      icon: <Plus size={16} />,
      items: newSubmenuItems(),
    },
    {
      type: 'action',
      label: t('actions.upload_files'),
      icon: <Upload size={16} />,
      onClick: () => files().triggerUpload(),
    },
    {
      type: 'action',
      label: t('common.rename'),
      icon: <Pencil size={16} />,
      onClick: () => { void batchRenameFolder().catch(() => {}) },
    },
  ]

  if (clipboard) {
    items.push(
      { type: 'separator' },
      {
        type: 'action',
        label: i18n.t('drive:actions.paste', { name: clipboard.name }),
        icon: <ClipboardPaste size={16} />,
        onClick: paste,
      },
    )
  }

  items.push(
    { type: 'separator' },
    {
      type: 'action',
      label: 'Fichiers en double',
      icon: <FilesIcon size={16} />,
      onClick: () => useDriveExtras.getState().openTool('duplicates'),
    },
    {
      type: 'action',
      label: "Vue d'ensemble du stockage",
      icon: <BarChart3 size={16} />,
      onClick: () => useDriveExtras.getState().openTool('insights'),
    },
    { type: 'separator' },
    {
      type: 'action',
      label: t('actions.refresh'),
      icon: <RefreshCw size={16} />,
      onClick: () => files().refresh(),
    },
  )

  return items
}
