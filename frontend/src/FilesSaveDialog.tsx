import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, FolderOpen, Home, Loader2, Save } from 'lucide-react'
import { filesApi, FolderGlyph } from '@kubuno/drive'
import { useFilesDialogStore } from '@kubuno/drive'
import { FloatingWindow } from '@ui'
import { Button, Input } from '@ui'

interface BreadcrumbItem { id: string | null; name: string }

interface Props {
  defaultName:     string
  defaultFolderId: string | null
  onClose: (result: { folderId: string | null; name: string } | null) => void
}

function SaveDialogInner({ defaultName, defaultFolderId, onClose }: Props) {
  const { t } = useTranslation('drive')
  const [folderId,     setFolderId]     = useState<string | null>(defaultFolderId)
  const [breadcrumb,   setBreadcrumb]   = useState<BreadcrumbItem[]>([{ id: null, name: t('nav.my_files') }])
  const [filename,     setFilename]     = useState(defaultName)
  const [ready,        setReady]        = useState(!defaultFolderId)

  // Initialise le fil d'Ariane depuis le dossier courant
  useEffect(() => {
    if (!defaultFolderId) { setReady(true); return }
    filesApi.getFolder(defaultFolderId)
      .then(({ folder, ancestors }) => {
        setBreadcrumb([
          { id: null, name: t('nav.my_files') },
          ...ancestors.map(a => ({ id: a.id, name: a.name })),
          { id: folder.id, name: folder.name },
        ])
      })
      .catch(() => {})
      .finally(() => setReady(true))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const foldersQ = useQuery({
    queryKey: ['save-dialog-folders', folderId],
    queryFn:  () => filesApi.listFolders(folderId),
    staleTime: 10_000,
    enabled:  ready,
  })

  const folders   = foldersQ.data?.folders ?? []
  const isLoading = !ready || foldersQ.isLoading

  const enterFolder = (id: string, name: string) => {
    setFolderId(id)
    setBreadcrumb(prev => [...prev, { id, name }])
  }

  const goToBreadcrumb = (idx: number) => {
    const slice = breadcrumb.slice(0, idx + 1)
    setBreadcrumb(slice)
    setFolderId(slice[slice.length - 1].id)
  }

  const canSave = filename.trim().length > 0

  return (
    <FloatingWindow
      title={t('savedialog.title')}
      icon={<Save size={17} className="text-primary" />}
      onClose={() => onClose(null)}
      defaultWidth={560}
      defaultHeight={480}
      resizable
    >
      <div className="flex flex-col flex-1 min-h-0">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-surface-1 flex-shrink-0">
          <nav className="flex items-center gap-1 flex-1 min-w-0 overflow-x-auto text-xs text-text-secondary">
            {breadcrumb.map((b, idx) => (
              <span key={idx} className="flex items-center gap-1 flex-shrink-0">
                {idx > 0 && <ChevronRight size={12} className="text-text-tertiary" />}
                <button
                  onClick={() => goToBreadcrumb(idx)}
                  className={`hover:text-primary hover:underline rounded px-1 py-0.5 ${
                    idx === breadcrumb.length - 1 ? 'text-text-primary font-medium' : ''
                  }`}
                >
                  {idx === 0 ? <Home size={12} /> : b.name}
                </button>
              </span>
            ))}
          </nav>
        </div>

        {/* Folder list */}
        <div className="flex-1 overflow-y-auto p-3">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 size={20} className="animate-spin text-text-tertiary" />
            </div>
          ) : folders.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-text-tertiary text-sm gap-2">
              <FolderOpen size={32} strokeWidth={1} />
              <p>{t('savedialog.empty')}</p>
            </div>
          ) : (
            <div className="space-y-0.5">
              {folders.map(fo => (
                <button
                  key={fo.id}
                  onClick={() => enterFolder(fo.id, fo.name)}
                  className="flex items-center gap-3 w-full px-3 py-2 rounded-lg hover:bg-surface-1 text-left group"
                >
                  <FolderGlyph folder={fo} size={16} className="flex-shrink-0" />
                  <span className="text-sm text-text-primary flex-1 truncate">{fo.name}</span>
                  <ChevronRight size={14} className="text-text-tertiary opacity-0 group-hover:opacity-100" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 px-5 py-3 border-t border-border bg-surface-1 flex-shrink-0">
          <div className="flex-1 flex items-center gap-2">
            <label className="text-xs text-text-tertiary flex-shrink-0">{t('savedialog.name_label')}</label>
            <div className="flex-1">
              <Input
                type="text"
                value={filename}
                onChange={e => setFilename(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && canSave) onClose({ folderId, name: filename.trim() }) }}
                autoFocus
              />
            </div>
          </div>
          <Button variant="secondary" size="sm" className="flex-shrink-0" onClick={() => onClose(null)}>{t('common.cancel')}</Button>
          <Button
            size="sm"
            className="flex-shrink-0"
            disabled={!canSave}
            onClick={() => canSave && onClose({ folderId, name: filename.trim() })}
          >
            {t('common.save')}
          </Button>
        </div>
      </div>
    </FloatingWindow>
  )
}

export default function FilesSaveDialog() {
  const opts    = useFilesDialogStore(s => s.saveOpts)
  const resolve = useFilesDialogStore(s => s._resolveSave)

  if (!opts) return null

  return (
    <SaveDialogInner
      defaultName={opts.defaultName ?? ''}
      defaultFolderId={opts.defaultFolderId ?? null}
      onClose={resolve}
    />
  )
}
