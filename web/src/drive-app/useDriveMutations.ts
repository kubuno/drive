import { useTranslation } from 'react-i18next'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { filesApi } from '@kubuno/drive'
import { useConfirm, usePendingDeletionStore, type DeletionKind, type PendingItem } from '@kubuno/sdk'

type ConfirmFn = ReturnType<typeof useConfirm>['confirm']

interface Args {
  folderId:    string | null
  navigate:    (id: string | null) => void
  confirm:     ConfirmFn
  refreshUser: () => void
}

/** Queries invalidation, deferred deletion and the star/restore/purge mutations. */
export function useDriveMutations({ folderId, navigate, confirm, refreshUser }: Args) {
  const { t } = useTranslation('drive')
  const qc = useQueryClient()

  const invalidateAll = () => {
    (qc.invalidateQueries({ queryKey: ['folders'] }), qc.invalidateQueries({ queryKey: ['tree-children'] }))
    qc.invalidateQueries({ queryKey: ['files'] })
    qc.invalidateQueries({ queryKey: ['tree-children'] })
    refreshUser()
  }

  // Cancellable deferred deletion (5 s): schedules the real operation, the UI
  // shows the affected boxes as "being deleted" through the store.
  const scheduleDelete = (kind: DeletionKind, items: PendingItem[]) => {
    if (items.length === 0) return
    usePendingDeletionStore.getState().schedule({
      kind, items,
      label:     t(kind === 'permanent' ? 'app.del_pending_perm' : 'app.del_pending_trash', { count: items.length }),
      undoLabel: t('common.cancel'),
      commit: (its) => {
        const ops = its.map(it =>
          kind === 'permanent'
            ? (it.type === 'file' ? filesApi.deleteFile(it.id) : filesApi.deleteFolder(it.id))
            : (it.type === 'file' ? filesApi.trashFile(it.id)  : filesApi.trashFolder(it.id)),
        )
        if (its.some(it => it.type === 'folder' && it.id === folderId)) navigate(null)
        // Promise resolved after the refetch (invalidateQueries resolve once the
        // queries have been refreshed) → the store keeps the styling until then.
        return Promise.allSettled(ops)
          .then((results) => {
            // Collect the precise failure reasons (e.g. protected item) returned
            // by the backend, to show them in a dialog.
            const msgs = Array.from(new Set(
              results
                .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
                .map(r => {
                  const e = r.reason as { response?: { data?: { message?: string } } }
                  return e?.response?.data?.message ?? null
                })
                .filter((m): m is string => !!m),
            ))
            return Promise.all([
              qc.invalidateQueries({ queryKey: ['folders'] }),
              qc.invalidateQueries({ queryKey: ['files'] }),
              qc.invalidateQueries({ queryKey: ['tree-children'] }),
            ]).then(() => { refreshUser(); return msgs })
          })
          .then((msgs) => {
            if (msgs.length > 0) {
              void confirm({
                title:        t('app.delete_blocked_title', { defaultValue: 'Suppression impossible' }),
                message:      msgs.join('\n\n'),
                confirmLabel: t('common.ok', { defaultValue: 'OK' }),
                hideCancel:   true,
                variant:      'warning',
              })
            }
          })
      },
    })
  }

  const starFolderMut = useMutation({
    mutationFn: (id: string) => filesApi.starFolder(id),
    onSuccess: invalidateAll,
  })
  const restoreFolderMut = useMutation({
    mutationFn: (id: string) => filesApi.restoreFolder(id),
    onSuccess: invalidateAll,
  })

  const starFileMut = useMutation({
    mutationFn: (id: string) => filesApi.starFile(id),
    onSuccess: invalidateAll,
  })
  const restoreFileMut = useMutation({
    mutationFn: (id: string) => filesApi.restoreFile(id),
    onSuccess: invalidateAll,
  })
  const purgeTrashMut = useMutation({
    mutationFn: () => filesApi.purgeTrash(),
    onSuccess: invalidateAll,
  })

  return { invalidateAll, scheduleDelete, starFolderMut, restoreFolderMut, starFileMut, restoreFileMut, purgeTrashMut }
}

export type DriveMutations = ReturnType<typeof useDriveMutations>

