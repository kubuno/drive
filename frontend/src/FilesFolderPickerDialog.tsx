import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Folder, FolderOpen, Loader2, Search } from 'lucide-react'
import { filesApi, FolderGlyph, type RemoteEntry } from '@kubuno/drive'
import { useFilesDialogStore, type FolderPickerOptions, type FolderSelection } from '@kubuno/drive'
import { FloatingWindow } from '@ui'
import { Button } from '@ui'
import DialogBreadcrumb, { type StorageOpt } from './DialogBreadcrumb'
import DialogTree from './DialogTree'

interface RemoteLoc { id: string; name: string; path: string }
// Internal crumb — carries navigation state; only { name } is passed to DialogBreadcrumb
interface InternalCrumb {
  name:        string
  folderId?:   string | null
  remotePath?: string
}

interface Props {
  opts:    FolderPickerOptions
  onClose: (folder: FolderSelection | null) => void
}

function FolderPickerInner({ opts, onClose }: Props) {
  const { t } = useTranslation('drive')
  const [currentSourceId, setCurrentSourceId] = useState<string | null>(null)
  const [folderId,        setFolderId]         = useState<string | null>(null)
  const [remote,          setRemote]           = useState<RemoteLoc | null>(null)
  const [pathCrumbs,      setPathCrumbs]       = useState<InternalCrumb[]>([])
  const [search,          setSearch]           = useState('')

  const foldersQ = useQuery({
    queryKey: ['folder-picker', folderId],
    queryFn:  () => filesApi.listFolders(folderId),
    staleTime: 10_000,
    enabled:  !remote,
  })
  const remotesQ = useQuery({ queryKey: ['folder-picker-remotes'], queryFn: filesApi.listRemotes, staleTime: 30_000 })
  const remoteQ  = useQuery({
    queryKey: ['folder-picker-remote-browse', remote?.id, remote?.path],
    queryFn:  () => filesApi.browseRemote(remote!.id, remote!.path),
    enabled:  !!remote,
    retry:    false,
  })

  const remotes   = remotesQ.data ?? []
  const sources: StorageOpt[] = [
    { id: null, name: t('nav.my_files') },
    ...remotes.map(m => ({ id: m.id, name: m.name, remote: true })),
  ]

  const matches    = (n: string) => search === '' || n.toLowerCase().includes(search.toLowerCase())
  const folders    = !remote ? (foldersQ.data?.folders ?? []).filter(fo => matches(fo.name)) : []
  const remoteDirs = remote  ? (remoteQ.data  ?? []).filter(e => e.is_dir && matches(e.name)) : []

  const isLoading = remote ? remoteQ.isLoading : foldersQ.isLoading
  const empty     = folders.length === 0 && remoteDirs.length === 0

  const selectSource = (id: string | null) => {
    setCurrentSourceId(id); setPathCrumbs([]); setSearch('')
    if (id === null) {
      setRemote(null); setFolderId(null)
    } else {
      const m = remotes.find(r => r.id === id)
      if (m) setRemote({ id: m.id, name: m.name, path: '' })
      setFolderId(null)
    }
  }

  const enterFolder    = (id: string, name: string) => {
    setFolderId(id); setPathCrumbs(p => [...p, { name, folderId: id }]); setSearch('')
  }
  const enterRemoteDir = (e: RemoteEntry) => {
    const loc = { id: remote!.id, name: remote!.name, path: e.path }
    setRemote(loc); setPathCrumbs(p => [...p, { name: e.name, remotePath: e.path }]); setSearch('')
  }
  const navigatePath   = (idx: number) => {
    const slice = pathCrumbs.slice(0, idx + 1)
    const crumb = slice[slice.length - 1]
    setPathCrumbs(slice); setSearch('')
    if (remote) setRemote({ ...remote, path: crumb.remotePath ?? '' })
    else        setFolderId(crumb.folderId ?? null)
  }

  // ── Jump from the left tree to an arbitrary folder (rebuild breadcrumb) ─────────
  const jumpLocal = async (fid: string | null) => {
    setSearch('')
    if (!fid) { setFolderId(null); setPathCrumbs([]); return }
    setFolderId(fid)
    try {
      const { folder, ancestors } = await filesApi.getFolder(fid)
      setPathCrumbs([...ancestors.map(a => ({ name: a.name, folderId: a.id })), { name: folder.name, folderId: fid }])
    } catch { setPathCrumbs([{ name: '…', folderId: fid }]) }
  }
  const jumpRemote = (path: string) => {
    if (!remote) return
    setRemote({ ...remote, path }); setSearch('')
    const segs = path.split('/').filter(Boolean)
    setPathCrumbs(segs.map((name, i) => ({ name, remotePath: segs.slice(0, i + 1).join('/') })))
  }

  const currentName = pathCrumbs.length > 0
    ? pathCrumbs[pathCrumbs.length - 1].name
    : (sources.find(s => s.id === currentSourceId)?.name ?? t('nav.my_files'))

  const handleSelect = () => {
    if (remote) {
      // Canonical "[<mount>]/<path>" form (brackets identify the storage).
      const path = remote.path.replace(/^\/+/, '')
      const name = path ? `[${remote.name}]/${path}` : `[${remote.name}]`
      onClose({ id: null, name, remote: { mountId: remote.id, path: remote.path } })
    } else {
      // Canonical "[Drive]/<path>" form ([Drive] = the user's own root).
      const rel = pathCrumbs.map(c => c.name).join('/')
      const name = rel ? `[Drive]/${rel}` : '[Drive]'
      onClose({ id: folderId, name })
    }
  }

  return (
    <FloatingWindow
      title={opts.title ?? t('folderpicker.title')}
      icon={<FolderOpen size={17} className="text-primary" />}
      onClose={() => onClose(null)}
      defaultWidth={780}
      defaultHeight={480}
      resizable
    >
      <div className="flex flex-1 min-h-0">
        <DialogTree
          sourceId={currentSourceId}
          rootLabel={sources.find(s => s.id === currentSourceId)?.name ?? t('nav.my_files')}
          selectedFolderId={folderId}
          selectedRemotePath={remote?.path ?? ''}
          onPickLocal={jumpLocal}
          onPickRemote={jumpRemote}
        />
        <div className="flex flex-col flex-1 min-h-0">
        {/* Breadcrumb + Search */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-surface-1 flex-shrink-0">
          <DialogBreadcrumb
            sources={sources}
            currentSourceId={currentSourceId}
            onSelectSource={selectSource}
            pathCrumbs={pathCrumbs}
            onNavigatePath={navigatePath}
          />
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

        {/* Sub-folders */}
        <div className="flex-1 overflow-y-auto p-3">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 size={20} className="animate-spin text-text-tertiary" />
            </div>
          ) : empty ? (
            <div className="flex flex-col items-center justify-center h-full text-text-tertiary text-sm gap-2">
              <FolderOpen size={32} strokeWidth={1} />
              <p className="text-xs">{search ? t('common.no_results') : t('folderpicker.empty')}</p>
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
              {remoteDirs.map(e => (
                <button
                  key={e.path}
                  onClick={() => enterRemoteDir(e)}
                  className="flex items-center gap-3 w-full px-3 py-2 rounded-lg hover:bg-surface-1 text-left group"
                >
                  <Folder size={16} className="text-text-secondary flex-shrink-0" />
                  <span className="text-sm text-text-primary flex-1 truncate">{e.name}</span>
                  <ChevronRight size={14} className="text-text-tertiary opacity-0 group-hover:opacity-100" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 px-5 py-3 border-t border-border bg-surface-1 flex-shrink-0">
          <span className="flex-1 text-xs text-text-secondary truncate">
            {t('folderpicker.create_in')} <strong>{currentName}</strong>
          </span>
          <Button variant="secondary" size="sm" onClick={() => onClose(null)}>{t('common.cancel')}</Button>
          <Button size="sm" onClick={handleSelect}>{t('folderpicker.select_here')}</Button>
        </div>
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
