import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { filesApi, useFilesStore, useImportConflicts } from '@kubuno/drive'

interface Args {
  folderId:    string | null
  selectedIds: Set<string>
  itemTypeMap: Map<string, 'file' | 'folder'>
  refreshUser: () => void
}

export interface DriveImport {
  fileInputRef:   React.RefObject<HTMLInputElement | null>
  folderInputRef: React.RefObject<HTMLInputElement | null>
  handleFileInput:   (e: React.ChangeEvent<HTMLInputElement>) => void
  handleFolderInput: (e: React.ChangeEvent<HTMLInputElement>) => void
  /** Dialog rendered by the import pipeline when a name conflict occurs. */
  conflictDialog: React.ReactNode
  isDragOver: boolean
  dragOverFolderId: string | null
  setDragOverFolderId: (id: string | null) => void
  setDraggingItem: (item: { type: 'folder' | 'file'; id: string } | null) => void
  handleDragEnter: (e: React.DragEvent) => void
  handleDragLeave: (e: React.DragEvent) => void
  handleDragOver:  (e: React.DragEvent) => void
  handleDrop: (e: React.DragEvent, targetFolderId?: string | null) => void
}

/** Uploads (with progress), conflict-aware imports and OS drag & drop. */
export function useDriveImport({ folderId, selectedIds, itemTypeMap, refreshUser }: Args): DriveImport {
  const { t } = useTranslation('drive')
  const qc = useQueryClient()
  const addUpload    = useFilesStore(s => s.addUpload)
  const updateUpload = useFilesStore(s => s.updateUpload)
  const registerFileInput   = useFilesStore(s => s.registerFileInput)
  const registerFolderInput = useFilesStore(s => s.registerFolderInput)

  // File input refs
  const fileInputRef   = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)

  // Register direct callbacks so the sidebar "Nouveau" menu can trigger clicks
  // synchronously within the browser user gesture context (useEffect is fine here
  // because we're registering, not clicking — the actual click happens later in the
  // same gesture as the user's dropdown selection via onSelect → triggerUpload())
  useEffect(() => {
    registerFileInput(() => fileInputRef.current?.click())
    registerFolderInput(() => folderInputRef.current?.click())
  }, [registerFileInput, registerFolderInput])

  // Drag state
  const [isDragOver,       setIsDragOver]       = useState(false)
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null)
  const [draggingItem,     setDraggingItem]     = useState<{ type: 'folder' | 'file'; id: string } | null>(null)
  const dragCounter = useRef(0)

  // ── Upload with progress tracking ───────────────────────────────────────────

  const uploadFileTracked = useCallback((file: File, targetFolderId: string | null, overwrite = false) => {
    const id = crypto.randomUUID()
    addUpload({ id, name: file.name, progress: 0, status: 'uploading' })
    filesApi.uploadFile(file, targetFolderId, pct => updateUpload(id, { progress: pct }), overwrite)
      .then((result) => {
        if (!result?.file?.id) {
          updateUpload(id, { status: 'error', error: t('app.module_unavailable') })
          return
        }
        updateUpload(id, { progress: 100, status: 'done' })
        qc.invalidateQueries({ queryKey: ['files'] })
        refreshUser()
      })
      .catch(err => updateUpload(id, { status: 'error', error: (err as Error).message ?? t('common.error') }))
  }, [addUpload, updateUpload, qc, refreshUser, t])

  // Shared import-with-conflict pipeline: any imported file OR folder whose name
  // already exists prompts the user (overwrite / keep both / cancel), at any depth.
  const { importFiles, importEntries, importWebkitFolder, conflictDialog } = useImportConflicts({
    list: async (fid: string | null) => {
      const [{ folders: fl }, { files: fi }] = await Promise.all([filesApi.listFolders(fid), filesApi.listFiles(fid)])
      return { folders: fl, files: fi }
    },
    createFolder: async (name: string, parentId: string | null) => { const { folder } = await filesApi.createFolder(name, parentId); qc.invalidateQueries({ queryKey: ['folders'] }); qc.invalidateQueries({ queryKey: ['tree-children'] }); return { id: folder.id } },
    uploadFile: uploadFileTracked,
    canMkdir: true,
  })

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => { const files = Array.from(e.target.files ?? []); e.target.value = ''; void importFiles(files, folderId) }
  const handleFolderInput = (e: React.ChangeEvent<HTMLInputElement>) => { const files = Array.from(e.target.files ?? []); e.target.value = ''; void importWebkitFolder(files, folderId) }

  // ── Drag & drop from the OS ─────────────────────────────────────────────────

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    dragCounter.current++
    if (dragCounter.current === 1 && e.dataTransfer.types.includes('Files')) setIsDragOver(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    dragCounter.current--
    if (dragCounter.current === 0) setIsDragOver(false)
  }

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault() }

  const handleDrop = useCallback((e: React.DragEvent, targetFolderId: string | null = folderId) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current = 0
    setIsDragOver(false)
    setDragOverFolderId(null)

    // Internal move (folder → folder)
    if (draggingItem && targetFolderId !== null) {
      const idsToMove = selectedIds.has(draggingItem.id) ? [...selectedIds] : [draggingItem.id]
      const moves: Promise<unknown>[] = []
      for (const id of idsToMove) {
        const kind = itemTypeMap.get(id) ?? draggingItem.type
        if (kind === 'folder' && id !== targetFolderId) {
          moves.push(filesApi.moveFolder(id, targetFolderId))
        } else if (kind === 'file') {
          moves.push(filesApi.moveFile(id, targetFolderId))
        }
      }
      Promise.all(moves).then(() => {
        (qc.invalidateQueries({ queryKey: ['folders'] }), qc.invalidateQueries({ queryKey: ['tree-children'] }))
        qc.invalidateQueries({ queryKey: ['files'] })
      })
      setDraggingItem(null)
      return
    }

    // Import from the OS
    const items = Array.from(e.dataTransfer.items)
    const entries = items
      .map(item => item.webkitGetAsEntry?.() ?? null)
      .filter((en): en is FileSystemEntry => en !== null)

    if (entries.length > 0) {
      void importEntries(entries, targetFolderId)
    } else {
      void importFiles(Array.from(e.dataTransfer.files), targetFolderId)
    }
  }, [folderId, draggingItem, selectedIds, itemTypeMap, importEntries, importFiles, qc])

  return {
    fileInputRef, folderInputRef,
    handleFileInput, handleFolderInput,
    conflictDialog,
    isDragOver, dragOverFolderId, setDragOverFolderId, setDraggingItem,
    handleDragEnter, handleDragLeave, handleDragOver, handleDrop,
  }
}
