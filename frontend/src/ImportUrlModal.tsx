import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link2, X } from 'lucide-react'
import { api } from '@kubuno/sdk'
import { useFilesStore } from '@kubuno/drive'
import { Button, Input } from '@ui'

interface ImportUrlDto {
  url:       string
  folder_id: string | null
  name:      string
}

async function importFromUrl(dto: ImportUrlDto) {
  const res = await api.post('/drive/import-url', dto)
  return res.data
}

export default function ImportUrlModal() {
  const { t } = useTranslation('drive')
  const { importUrlOpen, closeImportUrl, currentFolderId, refresh } = useFilesStore()
  const queryClient = useQueryClient()

  const [url,  setUrl]  = useState('')
  const [name, setName] = useState('')

  const mutation = useMutation({
    mutationFn: importFromUrl,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['files'] })
      refresh()
      handleClose()
    },
  })

  const handleClose = () => {
    setUrl('')
    setName('')
    mutation.reset()
    closeImportUrl()
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = url.trim()
    if (!trimmed) return
    mutation.mutate({ url: trimmed, folder_id: currentFolderId, name: name.trim() || '' })
  }

  if (!importUrlOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={handleClose} />

      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Link2 size={20} className="text-primary" />
            <h2 className="text-lg font-semibold text-text-primary">{t('importurl.title')}</h2>
          </div>
          <button
            onClick={handleClose}
            className="p-1 rounded-lg hover:bg-surface-2 text-text-secondary transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* URL field */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">
              {t('importurl.url_label')} <span className="text-danger">*</span>
            </label>
            <Input
              type="url"
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder={t('importurl.url_ph')}
              autoFocus
              required
            />
          </div>

          {/* Optional name field */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">
              {t('importurl.name_label')} <span className="text-text-tertiary font-normal">{t('common.optional')}</span>
            </label>
            <Input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={t('importurl.name_ph')}
            />
          </div>

          {/* Error */}
          {mutation.isError && (
            <p className="text-sm text-danger bg-danger/5 border border-danger/20 rounded-lg px-3 py-2">
              {(mutation.error as { response?: { data?: { message?: string } } })
                ?.response?.data?.message ?? t('importurl.error_generic')}
            </p>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={handleClose} disabled={mutation.isPending}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={!url.trim()} loading={mutation.isPending}>
              {t('common.import')}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
