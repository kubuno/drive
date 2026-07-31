import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Folder, Image as ImageIcon, LayoutGrid, List, Loader2 } from 'lucide-react'
import { filesApi, type FileItem, type FilesSearchFilters } from '@kubuno/drive'
import type { ImageSourceProps } from '@kubuno/sdk'

/**
 * The "Drive" tab of the core image picker. Registered by this module, so the
 * core never has to reimplement a Drive browser — and the tab only exists when
 * drive is installed.
 */

type Scope = 'mine' | 'recent' | 'starred'

const SCOPES: Array<{ id: Scope; label: string }> = [
  { id: 'mine',    label: 'Mon Drive' },
  { id: 'recent',  label: 'Récents' },
  { id: 'starred', label: 'Favoris' },
]

const isImage = (f: FileItem) => f.mime_type.startsWith('image/')

/** Search the whole Drive, images only — every other facet left wide open. */
const SEARCH_FILTERS: FilesSearchFilters = {
  type: 'image', owner: 'anyone', containsWords: '', itemName: '',
  location: 'everywhere', inTrash: false, isStarred: false,
  modifiedDate: 'anytime', sharedWith: '',
}

export default function DriveImageSource({ onPick, query }: ImageSourceProps) {
  const [scope,  setScope]  = useState<Scope>('mine')
  const [folder, setFolder] = useState<string | null>(null)
  const [crumbs, setCrumbs] = useState<Array<{ id: string | null; name: string }>>([{ id: null, name: 'Mon Drive' }])
  const [grid,   setGrid]   = useState(true)

  const searching = query.trim().length > 0
  // Folders only make sense while browsing "Mon Drive" without a search.
  const browsing  = scope === 'mine' && !searching

  const foldersQ = useQuery({
    queryKey: ['picker-folders', folder],
    queryFn:  () => filesApi.listFolders(folder),
    enabled:  browsing,
    staleTime: 10_000,
  })

  const filesQ = useQuery({
    queryKey: ['picker-files', scope, folder, query.trim()],
    queryFn:  () => searching
      ? filesApi.searchFiles(query.trim(), SEARCH_FILTERS).then(r => ({ files: r.results as FileItem[] }))
      : filesApi.listFiles(
          scope === 'mine' ? folder : null,
          scope === 'starred' || undefined,
          false,
          scope === 'recent' || undefined,
        ),
    staleTime: 10_000,
  })

  const folders = browsing ? (foldersQ.data?.folders ?? []) : []
  const files   = (filesQ.data?.files ?? []).filter(isImage)
  const loading = filesQ.isLoading || (browsing && foldersQ.isLoading)

  const enter = (id: string, name: string) => {
    setFolder(id)
    setCrumbs(c => [...c, { id, name }])
  }
  const goTo = (i: number) => {
    setFolder(crumbs[i].id)
    setCrumbs(c => c.slice(0, i + 1))
  }
  const switchScope = (s: Scope) => {
    setScope(s); setFolder(null); setCrumbs([{ id: null, name: 'Mon Drive' }])
  }

  return (
    <div className="flex flex-col h-full gap-2">
      {/* Scope tabs */}
      <div className="flex items-center gap-1 shrink-0 border-b border-border">
        {SCOPES.map(s => {
          const on = s.id === scope
          return (
            <button key={s.id} onClick={() => switchScope(s.id)}
              className="px-3 pb-2 pt-1 text-sm transition-colors"
              style={{
                color: on ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                fontWeight: on ? 500 : 400,
                boxShadow: on ? 'inset 0 -2px 0 0 var(--color-primary)' : 'none',
              }}>
              {s.label}
            </button>
          )
        })}
        <div className="flex-1" />
        <button onClick={() => setGrid(false)} title="Affichage en liste"
          className="p-1.5 rounded" style={{ color: grid ? 'var(--color-text-tertiary)' : 'var(--color-primary)' }}>
          <List size={16} />
        </button>
        <button onClick={() => setGrid(true)} title="Affichage en grille"
          className="p-1.5 rounded" style={{ color: grid ? 'var(--color-primary)' : 'var(--color-text-tertiary)' }}>
          <LayoutGrid size={16} />
        </button>
      </div>

      {/* Breadcrumb */}
      {browsing && crumbs.length > 1 && (
        <div className="flex items-center gap-0.5 shrink-0 text-sm text-text-secondary">
          {crumbs.map((c, i) => (
            <span key={i} className="flex items-center gap-0.5">
              {i > 0 && <ChevronRight size={14} className="text-text-tertiary" />}
              <button onClick={() => goTo(i)} className="px-1 rounded hover:bg-surface-2 truncate max-w-[10rem]">
                {c.name}
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto">
        {loading && (
          <div className="flex items-center gap-2 text-sm text-text-tertiary py-6">
            <Loader2 size={16} className="animate-spin" /> Chargement…
          </div>
        )}

        {!loading && folders.length === 0 && files.length === 0 && (
          <p className="text-sm text-text-tertiary py-6">Aucune image ici.</p>
        )}

        {folders.length > 0 && (
          <>
            <p className="text-xs text-text-tertiary mb-2">Dossiers</p>
            <div className={grid ? 'grid grid-cols-4 gap-2 mb-4' : 'space-y-1 mb-4'}>
              {folders.map(f => (
                <button key={f.id} onDoubleClick={() => enter(f.id, f.name)} onClick={() => enter(f.id, f.name)}
                  className="flex items-center gap-2 px-3 h-11 rounded-lg bg-surface-1 hover:bg-surface-2 text-left transition-colors">
                  <Folder size={16} className="shrink-0 text-text-secondary" />
                  <span className="truncate text-sm text-text-primary">{f.name}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {files.length > 0 && (
          <>
            {folders.length > 0 && <p className="text-xs text-text-tertiary mb-2">Images</p>}
            {grid ? (
              <div className="grid grid-cols-4 gap-2 content-start">
                {files.map(f => (
                  <button key={f.id} title={f.name}
                    onClick={() => onPick({ kind: 'url', url: filesApi.downloadUrl(f.id) })}
                    className="rounded-lg overflow-hidden bg-surface-2 hover:opacity-80 transition-opacity">
                    {f.has_thumbnail
                      ? <img src={filesApi.thumbnailUrl(f.id)} alt={f.name} loading="lazy"
                          className="w-full aspect-square object-cover" />
                      : <span className="flex items-center justify-center w-full aspect-square text-text-tertiary">
                          <ImageIcon size={22} />
                        </span>}
                  </button>
                ))}
              </div>
            ) : (
              <div className="space-y-1">
                {files.map(f => (
                  <button key={f.id}
                    onClick={() => onPick({ kind: 'url', url: filesApi.downloadUrl(f.id) })}
                    className="w-full flex items-center gap-3 px-3 h-11 rounded-lg hover:bg-surface-2 text-left transition-colors">
                    {f.has_thumbnail
                      ? <img src={filesApi.thumbnailUrl(f.id)} alt="" className="w-8 h-8 rounded object-cover shrink-0" />
                      : <ImageIcon size={16} className="shrink-0 text-text-tertiary" />}
                    <span className="truncate text-sm text-text-primary">{f.name}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
