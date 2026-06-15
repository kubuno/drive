import { useState, useRef } from 'react'
import { FolderPlus, Upload, RefreshCw, Plus, ChevronRight, ClipboardPaste, Pencil } from 'lucide-react'
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

  const [open, setOpen] = useState(false)
  const timeoutRef      = useRef<ReturnType<typeof setTimeout> | null>(null)

  const hasContributors = SlotRegistry.getSlot('files-context-new-actions').some(e => activeIds.has(e.moduleId))

  const handleEnter = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    setOpen(true)
  }
  const handleLeave = () => {
    timeoutRef.current = setTimeout(() => setOpen(false), 120)
  }

  return (
    <div className="relative" onMouseEnter={handleEnter} onMouseLeave={handleLeave}>
      {/* Trigger */}
      <button
        className="flex items-center justify-between w-full px-3 py-2 text-sm
                   text-text-primary hover:bg-surface-1 cursor-pointer"
        onMouseEnter={handleEnter}
      >
        <span className="flex items-center gap-3">
          <Plus size={16} className="text-text-secondary" />
          {t('actions.new')}
        </span>
        <ChevronRight size={14} className="text-text-tertiary" />
      </button>

      {/* Submenu panel */}
      {open && (
        <div
          className="absolute left-full top-0 z-[210] bg-white border border-border rounded-[5px]
                     shadow-lg py-1 min-w-[200px]"
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
        </div>
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
        icon={<RefreshCw size={16} />}
        label={t('actions.refresh')}
        onClick={wrap(refresh)}
      />
    </>
  )
}
