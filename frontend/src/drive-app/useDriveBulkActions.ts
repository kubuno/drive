import React from 'react'
import { useTranslation } from 'react-i18next'
import { filesApi, useFilesDialogStore } from '@kubuno/drive'
import { useConfirm, type PendingItem } from '@kubuno/sdk'
import type { DriveMutations } from './useDriveMutations'

type ConfirmFn = ReturnType<typeof useConfirm>['confirm']

interface Args {
  folderId:    string | null
  selectedIds: Set<string>
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>
  itemTypeMap: Map<string, 'file' | 'folder'>
  mutations:   DriveMutations
  confirm:     ConfirmFn
}

/** Actions of the selection bar: compress, trash, delete, restore, empty trash. */
export function useDriveBulkActions({ folderId, selectedIds, setSelectedIds, itemTypeMap, mutations, confirm }: Args) {
  const { t } = useTranslation('drive')
  const { invalidateAll, scheduleDelete, restoreFileMut, restoreFolderMut, purgeTrashMut } = mutations

  const pendingItems = (): PendingItem[] =>
    [...selectedIds].map(id => ({ id, type: itemTypeMap.get(id) === 'file' ? 'file' : 'folder' }))

  const compressSelection = async () => {
    const result = await useFilesDialogStore.getState().saveFile({
      defaultName:     'archive.zip',
      defaultFolderId: folderId,
    })
    if (!result) return
    const fileIds   = [...selectedIds].filter(id => itemTypeMap.get(id) === 'file')
    const folderIds = [...selectedIds].filter(id => itemTypeMap.get(id) === 'folder')
    filesApi.compressSave(fileIds, folderIds, result.name, result.folderId)
      .then(() => { invalidateAll(); setSelectedIds(new Set()) })
      .catch(() => {})
  }

  const trashSelection = () => {
    scheduleDelete('trash', pendingItems())
    setSelectedIds(new Set())
  }

  const deleteSelection = () => {
    scheduleDelete('permanent', pendingItems())
    setSelectedIds(new Set())
  }

  const restoreSelection = () => {
    const ids = [...selectedIds]
    ids.filter(id => itemTypeMap.get(id) === 'file').forEach(id => restoreFileMut.mutate(id))
    ids.filter(id => itemTypeMap.get(id) === 'folder').forEach(id => restoreFolderMut.mutate(id))
    setSelectedIds(new Set())
  }

  const emptyTrash = async () => {
    const ok = await confirm({
      title:        t('app.empty_trash_q'),
      message:      t('app.empty_trash_msg'),
      confirmLabel: t('app.empty_trash'),
      variant:      'danger',
    })
    if (ok) purgeTrashMut.mutate()
  }

  const clearSelection = () => setSelectedIds(new Set())

  return { compressSelection, trashSelection, deleteSelection, restoreSelection, emptyTrash, clearSelection }
}

export type DriveBulkActions = ReturnType<typeof useDriveBulkActions>
