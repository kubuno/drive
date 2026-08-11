import { useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { FolderPlus, Upload, RefreshCw, Plus, ChevronRight, ClipboardPaste, Pencil, Files as FilesIcon, BarChart3 } from 'lucide-react'
import { useDriveExtras } from './driveExtras'
import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useFilesStore } from '@kubuno/drive'
import { filesApi } from '@kubuno/drive'
import { useBatchRenameStore } from '@kubuno/drive'
import { Slot, SlotRegistry } from '@kubuno/sdk'
import { useModulesStore } from '@kubuno/sdk'
import { ContextMenuItem, ContextMenuSeparator, useContextMenu } from '@kubuno/sdk'
import { useQueryClient } from '@tanstack/react-query'

function NewSubmenu() {
  const { t } = useTranslation('drive')
  const { openNewFolder } = useFilesStore()
  const { close } = useContextMenu()
  const activeModules = useModulesStore(s => s.activeModules)
  const activeIds     = new Set(activeModules.map(m => m.module_id))

  /* The panel is PORTALLED to <body> and positioned from the trigger's rect, rather
   * than being `absolute` inside the parent menu. A frosted ancestor establishes a
   * backdrop root, so a nested `backdrop-filter` has nothing left to sample wherever
   * the submenu extends past its parent — it rendered translucent but perfectly sharp.
   * Same reason `MenuDropdown` portals its own cascading submenus. */
  const [pos, setPos]   = useState<{ top: number; left: number } | null>(null)
  const open            = pos !== null
  const timeoutRef      = useRef<ReturnType<typeof setTimeout> | null>(null)
  const triggerRef      = useRef<HTMLButtonElement>(null)

  const hasContributors = SlotRegistry.getSlot('files-context-new-actions').some(e => activeIds.has(e.moduleId))

  const SUB_W = 200
  const handleEnter = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    const r = triggerRef.current?.getBoundingClientRect()
    if (!r) return
    // Cascade right, flipping left when the viewport would clip it.
    const flip = r.right + SUB_W > window.innerWidth - 8 && r.left - SUB_W > 8
    setPos({ top: r.top - 5, left: flip ? r.left - SUB_W : r.right })
  }
  const handleLeave = () => {
    timeoutRef.current = setTimeout(() => setPos(null), 120)
  }

  return (
    <div className="relative" onMouseEnter={handleEnter} onMouseLeave={handleLeave}>
      {/* Trigger */}
      <button
        ref={triggerRef}
        className="group flex items-center justify-between w-full px-2.5 py-1.5 text-sm rounded-md
                   text-text-primary hover:bg-primary hover:text-white cursor-pointer"
        onMouseEnter={handleEnter}
      >
        <span className="flex items-center gap-3">
          <Plus size={16} className="text-primary group-hover:text-white" />
          {t('actions.new')}
        </span>
        <ChevronRight size={14} className="text-text-tertiary group-hover:text-white" />
      </button>

      {/* Submenu panel — portalled out of the frosted parent, see handleEnter. */}
      {open && createPortal(
        <div
          className="kb-frosted fixed z-[210] p-[5px]"
          style={{ top: pos.top, left: pos.left, minWidth: SUB_W }}
          onMouseEnter={handleEnter}
          onMouseLeave={handleLeave}
        >
          <ContextMenuItem
            icon={<FolderPlus size={16} />}
            label={t('newfolder.title')}
            onClick={() => { openNewFolder(); close() }}
          />
          {hasContributors && (
            <>
              <ContextMenuSeparator />
              <Slot name="files-context-new-actions" />
            </>
          )}
        </div>,
        document.body,
      )}
    </div>
  )
}

export default function FilesContextMenuItems() {
  const { t } = useTranslation('drive')
  const { triggerUpload, refresh, clipboard, clearClipboard, currentFolderId } = useFilesStore()
  const location = useLocation()
  const { close } = useContextMenu()
  const qc = useQueryClient()

  if (!location.pathname.startsWith('/drive')) return null

  const wrap = (fn: () => void) => () => { fn(); close() }

  const handlePaste = () => {
    if (!clipboard) return
    const targetId = currentFolderId
    if (clipboard.action === 'copy' && clipboard.type === 'file') {
      filesApi.copyFile(clipboard.id, targetId)
        .then(() => qc.invalidateQueries({ queryKey: ['files'] }))
    } else if (clipboard.action === 'cut' && clipboard.type === 'file') {
      filesApi.moveFile(clipboard.id, targetId)
        .then(() => { qc.invalidateQueries({ queryKey: ['files'] }); clearClipboard() })
    } else if (clipboard.action === 'cut' && clipboard.type === 'folder') {
      filesApi.moveFolder(clipboard.id, targetId)
        .then(() => { qc.invalidateQueries({ queryKey: ['folders'] }); qc.invalidateQueries({ queryKey: ['tree-children'] }); clearClipboard() })
    }
    close()
  }

  // Renommage en lot sur TOUT le dossier courant (clic droit dans le vide).
  const handleBatchRename = async () => {
    close()
    try {
      const [sf, ff] = await Promise.all([
        filesApi.listFolders(currentFolderId),
        filesApi.listFiles(currentFolderId),
      ])
      const items = [
        ...sf.folders.map(f => ({ id: f.id, name: f.name, type: 'folder' as const })),
        ...ff.files.map(f => ({ id: f.id, name: f.name, type: 'file' as const })),
      ]
      useBatchRenameStore.getState().start(items)
    } catch { /* ignore */ }
  }

  return (
    <>
      <NewSubmenu />
      <ContextMenuItem
        icon={<Upload size={16} />}
        label={t('actions.upload_files')}
        onClick={wrap(triggerUpload)}
      />
      <ContextMenuItem
        icon={<Pencil size={16} />}
        label={t('common.rename')}
        onClick={handleBatchRename}
      />
      {clipboard && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem
            icon={<ClipboardPaste size={16} />}
            label={t('actions.paste', { name: clipboard.name })}
            onClick={handlePaste}
          />
        </>
      )}
      <ContextMenuSeparator />
      <ContextMenuItem
        icon={<FilesIcon size={16} />}
        label="Fichiers en double"
        onClick={wrap(() => useDriveExtras.getState().openTool('duplicates'))}
      />
      <ContextMenuItem
        icon={<BarChart3 size={16} />}
        label="Vue d'ensemble du stockage"
        onClick={wrap(() => useDriveExtras.getState().openTool('insights'))}
      />
      <ContextMenuSeparator />
      <ContextMenuItem
        icon={<RefreshCw size={16} />}
        label={t('actions.refresh')}
        onClick={wrap(refresh)}
      />
    </>
  )
}
