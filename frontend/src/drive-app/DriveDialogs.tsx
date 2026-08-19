import React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  BatchRenameModal, FileInfoModal, MoveModal, NewFolderModal, RenameModal, ShareModal,
  UploadPanel, VersionHistoryModal, useBatchRenameStore, useFilesStore,
  type FileItem, type Folder,
} from '@kubuno/drive'
import AdvancedShareDialog from '../AdvancedShareDialog'
import ArchiveBrowser from '../ArchiveBrowser'
import DuplicatesDialog from '../DuplicatesDialog'
import ImageEditDialog from '../ImageEditDialog'
import ImportUrlModal from '../ImportUrlModal'
import StorageInsightsDialog from '../StorageInsightsDialog'
import { useDriveExtras } from '../driveExtras'
import { TagDialog } from '../TagUI'
import type { DriveDialogs as DriveDialogsState } from './useDriveDialogs'

interface Props {
  dialogs:  DriveDialogsState
  folderId: string | null
  folders:  Folder[]
  files:    FileItem[]
  archiveFile:    FileItem | null
  onCloseArchive: () => void
  onOpenFile:     (file: FileItem) => void
  /** Dialog rendered by the import pipeline on a name conflict. */
  conflictDialog: React.ReactNode
}

/** Every modal dialog and panel layered above the DriveApp views. */
export default function DriveDialogs({
  dialogs, folderId, folders, files, archiveFile, onCloseArchive, onOpenFile, conflictDialog,
}: Props) {
  const qc = useQueryClient()
  const { newFolderOpen, closeNewFolder } = useFilesStore()
  const { open: batchOpen, items: batchItems, close: closeBatch } = useBatchRenameStore()
  const tool      = useDriveExtras(s => s.tool)
  const closeTool = useDriveExtras(s => s.closeTool)

  return (
    <>
      {/* Modals */}
      <NewFolderModal open={newFolderOpen} onClose={closeNewFolder} parentId={folderId} />
      <ImportUrlModal />
      <RenameModal   target={dialogs.renameTarget} onClose={() => dialogs.setRenameTarget(null)} siblingNames={[...folders.map(f => f.name), ...files.map(f => f.name)]} />
      {batchOpen && <BatchRenameModal items={batchItems} onClose={closeBatch} />}
      <MoveModal     target={dialogs.moveTarget}   onClose={() => dialogs.setMoveTarget(null)} />
      <ShareModal          target={dialogs.shareTarget}    onClose={() => dialogs.setShareTarget(null)} />
      <FileInfoModal       target={dialogs.infoTarget}     onClose={() => dialogs.setInfoTarget(null)} />
      <VersionHistoryModal file={dialogs.versionTarget}    onClose={() => dialogs.setVersionTarget(null)} />

      {/* Labels, image editing, duplicates, storage overview */}
      {dialogs.tagDialogTarget && <TagDialog target={dialogs.tagDialogTarget} onClose={() => dialogs.setTagDialogTarget(null)} />}
      {dialogs.imageEditFile && (
        <ImageEditDialog
          file={dialogs.imageEditFile}
          onClose={() => dialogs.setImageEditFile(null)}
          onSaved={() => { qc.invalidateQueries({ queryKey: ['files'] }) }}
        />
      )}
      {tool === 'duplicates' && (
        <DuplicatesDialog
          onClose={closeTool}
          onChanged={() => qc.invalidateQueries({ queryKey: ['files'] })}
        />
      )}
      {tool === 'insights' && (
        <StorageInsightsDialog
          onClose={closeTool}
          onOpenFile={(id) => { const f = files.find(x => x.id === id); closeTool(); if (f) onOpenFile(f) }}
        />
      )}
      {dialogs.advShareTarget && <AdvancedShareDialog target={dialogs.advShareTarget} onClose={() => dialogs.setAdvShareTarget(null)} />}

      {/* Archive browser */}
      {archiveFile && (
        <ArchiveBrowser file={archiveFile} onClose={onCloseArchive} />
      )}

      {/* Upload panel */}
      <UploadPanel />

      {/* Upload conflict */}
      {conflictDialog}
    </>
  )
}
