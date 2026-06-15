import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, FolderOpen, Home, Loader2, Search } from 'lucide-react'
import { filesApi, FolderGlyph } from '@kubuno/drive'
import { useFilesDialogStore, type FolderPickerOptions, type FolderSelection } from '@kubuno/drive'
import { FloatingWindow } from '@ui'
import { Button } from '@ui'

interface BreadcrumbItem { id: string | null; name: string }

interface Props {
  opts:    FolderPickerOptions
  onClose: (folder: FolderSelection | null) => void
}

function FolderPickerInner({ opts, onClose }: Props) {
  const { t } = useTranslation('drive')
  const [breadcrumb, setBreadcrumb] = useState<BreadcrumbItem[]>([{ id: null, name: t('nav.my_files') }])
  const [search,     setSearch]     = useState('')

  const current   = breadcrumb[breadcrumb.length - 1]
  const folderId  = current.id

  const foldersQ = useQuery({
    queryKey: ['folder-picker', folderId],
    queryFn:  () => filesApi.listFolders(folderId),
    staleTime: 10_000,
  })

  const folders         = foldersQ.data?.folders ?? []
  const filteredFolders = folders.filter(fo =>
    search === '' || fo.name.toLowerCase().includes(search.toLowerCase())
  )

  const enterFolder = (id: string, name: string) => {
    setBreadcrumb(prev => [...prev, { id, name }])
    setSearch('')
  }

  const goToBreadcrumb = (idx: number) => {
    setBreadcrumb(prev => prev.slice(0, idx + 1))
    setSearch('')
  }

  const handleSelect = () => {
    onClose({ id: folderId, name: current.name })
  }

  return (
    <FloatingWindow
      title={opts.title ?? t('folderpicker.title')}
      icon={<FolderOpen size={17} className="text-primary" />}
      onClose={() => onClose(null)}
      defaultWidth={560}
      defaultHeight={460}
      resizable
    >
      <div className="flex flex-col flex-1 min-h-0">
        {/* Breadcrumb + Search */}
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
          <div className="relative flex-shrink-0">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t('common.search_ph')}
              className="pl-6 pr-2 py-1 text-xs border border-border rounded-lg bg-white outline-none focus:ring-1 focus:ring-primary w-36"
            />
          </div>
        </div>

        {/* Liste des sous-dossiers */}
        <div className="flex-1 overflow-y-auto p-3">
          {foldersQ.isLoading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 size={20} className="animate-spin text-text-tertiary" />
            </div>
          ) : filteredFolders.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-text-tertiary text-sm gap-2">
              <FolderOpen size={32} strokeWidth={1} />
              <p className="text-xs">{search ? t('common.no_results') : t('folderpicker.empty')}</p>
            </div>
          ) : (
            <div className="space-y-0.5">
              {filteredFolders.map(fo => (
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
          <span className="flex-1 text-xs text-text-secondary truncate">
            {t('folderpicker.create_in')} <strong>{current.name}</strong>
          </span>
          <Button variant="secondary" size="sm" onClick={() => onClose(null)}>{t('common.cancel')}</Button>
          <Button size="sm" onClick={handleSelect}>{t('folderpicker.select_here')}</Button>
        </div>
      </div>
    </FloatingWindow>
  )
}

export default function FilesFolderPickerDialog() {
  const opts    = useFilesDialogStore(s => s.folderPickerOpts)
  const resolve = useFilesDialogStore(s => s._resolveFolderPicker)

  if (!opts) return null

  return <FolderPickerInner opts={opts} onClose={resolve} />
}
