import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Folder, FolderOpen, FileText, Search, Loader2 } from 'lucide-react'
import { filesApi, FolderGlyph, FileItem, type RemoteEntry } from '@kubuno/drive'
import { openable } from './openable'
import { useFilesDialogStore, OpenDialogOptions, fileMatchesOptions } from '@kubuno/drive'
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

function FileIcon({ mimeType, name }: { mimeType: string; name: string }) {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  const isImage = mimeType.startsWith('image/')
  const isFont  = ['ttf', 'otf', 'woff', 'woff2', 'eot'].includes(ext)
  const color   = isImage ? 'text-blue-500' : isFont ? 'text-violet-500' : 'text-text-tertiary'
  return <FileText size={16} className={color} />
}

interface Props {
  opts:    OpenDialogOptions
  onClose: (file: FileItem | null) => void
}

function OpenDialogInner({ opts, onClose }: Props) {
  const { t } = useTranslation('drive')
  const [currentSourceId, setCurrentSourceId] = useState<string | null>(null)
  const [folderId,        setFolderId]         = useState<string | null>(null)
  const [remote,          setRemote]           = useState<RemoteLoc | null>(null)
  const [pathCrumbs,      setPathCrumbs]       = useState<InternalCrumb[]>([])
  const [selected,        setSelected]         = useState<FileItem | null>(null)
  const [selectedRemote,  setSelectedRemote]   = useState<RemoteEntry | null>(null)
  const [search,          setSearch]           = useState('')
  const [busy,            setBusy]             = useState(false)

  // ── Local sources ──────────────────────────────────────────────────────────────
  const foldersQ = useQuery({ queryKey: ['dialog-folders', folderId], queryFn: () => filesApi.listFolders(folderId), staleTime: 10_000, enabled: !remote })
  const filesQ   = useQuery({ queryKey: ['dialog-files',   folderId], queryFn: () => filesApi.listFiles(folderId),   staleTime: 10_000, enabled: !remote })
  // ── Remote mounts ──────────────────────────────────────────────────────────────
  const remotesQ = useQuery({ queryKey: ['dialog-remotes'], queryFn: filesApi.listRemotes, staleTime: 30_000 })
  const remoteQ  = useQuery({
    queryKey: ['dialog-remote-browse', remote?.id, remote?.path],
    queryFn:  () => filesApi.browseRemote(remote!.id, remote!.path),
    enabled:  !!remote,
    retry:    false,
  })

  const remotes   = remotesQ.data ?? []
  const sources: StorageOpt[] = [
    { id: null, name: t('nav.my_files') },
    ...remotes.map(m => ({ id: m.id, name: m.name, remote: true })),
  ]

  const matchesSearch = (n: string) => search === '' || n.toLowerCase().includes(search.toLowerCase())
  const folders    = !remote ? (foldersQ.data?.folders ?? []).filter(fo => matchesSearch(fo.name)) : []
  const files      = !remote ? (filesQ.data?.files ?? []).filter(f =>
    !f.is_trashed && fileMatchesOptions(f.name, f.mime_type, opts) && matchesSearch(f.name)) : []
  const remoteDirs  = remote ? (remoteQ.data ?? []).filter(e => e.is_dir && matchesSearch(e.name)) : []
  const remoteFiles = remote ? (remoteQ.data ?? []).filter(e => !e.is_dir && fileMatchesOptions(e.name, '', opts) && matchesSearch(e.name)) : []

  const isLoading = remote ? remoteQ.isLoading : (foldersQ.isLoading || filesQ.isLoading)
  const empty     = folders.length === 0 && files.length === 0 && remoteDirs.length === 0 && remoteFiles.length === 0

  const reset = () => { setSelected(null); setSelectedRemote(null); setSearch('') }

  const selectSource = (id: string | null) => {
    setCurrentSourceId(id); setPathCrumbs([])
    if (id === null) {
      setRemote(null); setFolderId(null)
    } else {
      const m = remotes.find(r => r.id === id)
      if (m) setRemote({ id: m.id, name: m.name, path: '' })
      setFolderId(null)
    }
    reset()
  }

  const enterFolder    = (id: string, name: string) => { setFolderId(id); setPathCrumbs(p => [...p, { name, folderId: id }]); reset() }
  const enterRemoteDir = (e: RemoteEntry) => {
    const loc = { id: remote!.id, name: remote!.name, path: e.path }
    setRemote(loc); setPathCrumbs(p => [...p, { name: e.name, remotePath: e.path }]); reset()
  }
  const navigatePath   = (idx: number) => {
    const slice = pathCrumbs.slice(0, idx + 1)
    const crumb = slice[slice.length - 1]
    setPathCrumbs(slice)
    if (remote) setRemote({ ...remote, path: crumb.remotePath ?? '' })
    else        setFolderId(crumb.folderId ?? null)
    reset()
  }

  // ── Jump from the left tree to an arbitrary folder (rebuild breadcrumb) ─────────
  const jumpLocal = async (fid: string | null) => {
    reset()
    if (!fid) { setFolderId(null); setPathCrumbs([]); return }
    setFolderId(fid)
    try {
      const { folder, ancestors } = await filesApi.getFolder(fid)
      setPathCrumbs([...ancestors.map(a => ({ name: a.name, folderId: a.id })), { name: folder.name, folderId: fid }])
    } catch { setPathCrumbs([{ name: '…', folderId: fid }]) }
  }
  const jumpRemote = (path: string) => {
    if (!remote) return
    setRemote({ ...remote, path }); reset()
    const segs = path.split('/').filter(Boolean)
    setPathCrumbs(segs.map((name, i) => ({ name, remotePath: segs.slice(0, i + 1).join('/') })))
  }

  // Materialise a remote file: download → re-upload locally → return as FileItem.
  const openRemoteFile = async (e: RemoteEntry) => {
    if (!remote) return
    setBusy(true)
    try {
      const blob = await filesApi.fetchRemoteFileBlob(remote.id, e.path)
      const f = new File([blob], e.name, { type: blob.type || 'application/octet-stream' })
      const { file } = await filesApi.uploadFile(f, null)
      onClose(file)
    } catch { setBusy(false) }
  }

  const confirmOpen = () => {
    if (selected) onClose(selected)
    else if (selectedRemote) void openRemoteFile(selectedRemote)
  }

  const filterLabel = opts.acceptExtensions?.length ? opts.acceptExtensions.map(e => `.${e}`).join(', ') : null

  return (
    <FloatingWindow
      title={opts.title ?? t('opendialog.title')}
      icon={<FolderOpen size={17} className="text-primary" />}
      onClose={() => onClose(null)}
      defaultWidth={840}
      defaultHeight={520}
      resizable
      titleActions={filterLabel ? (
        <span className="text-xs text-text-tertiary bg-surface-2 px-2 py-0.5 rounded-full">{filterLabel}</span>
      ) : undefined}
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
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('common.search_ph')}
              className="pl-6 pr-2 py-1 text-xs border border-border rounded-lg bg-white outline-none focus:ring-1 focus:ring-primary w-36" />
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-3">
          {isLoading ? (
            <div className="flex items-center justify-center h-full"><Loader2 size={20} className="animate-spin text-text-tertiary" /></div>
          ) : empty ? (
            <div className="flex flex-col items-center justify-center h-full text-text-tertiary text-sm gap-2">
              <FolderOpen size={32} strokeWidth={1} />
              <p>{search ? t('common.no_results') : t('common.empty_folder')}</p>
            </div>
          ) : (
            <div className="space-y-0.5">
              {/* Local sub-folders */}
              {folders.map(fo => (
                <button key={fo.id} {...openable({ open: () => enterFolder(fo.id, fo.name), select: reset })}
                  className="flex items-center gap-3 w-full px-3 py-2 rounded-lg hover:bg-surface-1 text-left group">
                  <FolderGlyph folder={fo} size={16} className="flex-shrink-0" />
                  <span className="text-sm text-text-primary flex-1 truncate">{fo.name}</span>
                  <ChevronRight size={14} className="text-text-tertiary opacity-0 group-hover:opacity-100" />
                </button>
              ))}
              {/* Remote sub-folders */}
              {remoteDirs.map(e => (
                <button key={e.path} {...openable({ open: () => enterRemoteDir(e), select: reset })}
                  className="flex items-center gap-3 w-full px-3 py-2 rounded-lg hover:bg-surface-1 text-left group">
                  <Folder size={16} className="text-text-secondary flex-shrink-0" />
                  <span className="text-sm text-text-primary flex-1 truncate">{e.name}</span>
                  <ChevronRight size={14} className="text-text-tertiary opacity-0 group-hover:opacity-100" />
                </button>
              ))}
              {/* Local files */}
              {files.map(file => (
                <button key={file.id} onClick={() => { setSelected(file); setSelectedRemote(null) }} onDoubleClick={() => onClose(file)}
                  className={`flex items-center gap-3 w-full px-3 py-2 rounded-lg text-left transition-colors ${selected?.id === file.id ? 'bg-primary/10 ring-1 ring-primary' : 'hover:bg-surface-1'}`}>
                  <FileIcon mimeType={file.mime_type} name={file.name} />
                  <span className="text-sm text-text-primary flex-1 truncate">{file.name}</span>
                  <span className="text-xs text-text-tertiary flex-shrink-0">{(file.size_bytes / 1024).toFixed(0)} {t('common.kb')}</span>
                </button>
              ))}
              {/* Remote files */}
              {remoteFiles.map(e => (
                <button key={e.path} onClick={() => { setSelectedRemote(e); setSelected(null) }} onDoubleClick={() => openRemoteFile(e)}
                  className={`flex items-center gap-3 w-full px-3 py-2 rounded-lg text-left transition-colors ${selectedRemote?.path === e.path ? 'bg-primary/10 ring-1 ring-primary' : 'hover:bg-surface-1'}`}>
                  <FileIcon mimeType="" name={e.name} />
                  <span className="text-sm text-text-primary flex-1 truncate">{e.name}</span>
                  <span className="text-xs text-text-tertiary flex-shrink-0">{e.size_bytes > 0 ? `${(e.size_bytes / 1024).toFixed(0)} ${t('common.kb')}` : ''}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 px-5 py-3 border-t border-border bg-surface-1 flex-shrink-0">
          {busy ? (
            <span className="flex-1 text-xs text-text-secondary flex items-center gap-2"><Loader2 size={13} className="animate-spin" /> {t('opendialog.materializing', { defaultValue: 'Récupération du fichier distant…' })}</span>
          ) : (selected || selectedRemote) ? (
            <span className="flex-1 text-xs text-text-secondary truncate">{t('opendialog.selected')} <strong>{selected?.name ?? selectedRemote?.name}</strong></span>
          ) : (
            <span className="flex-1 text-xs text-text-tertiary">{t('opendialog.hint')}</span>
          )}
          <Button variant="secondary" size="sm" onClick={() => onClose(null)} disabled={busy}>{t('common.cancel')}</Button>
          <Button size="sm" onClick={confirmOpen} disabled={busy || (!selected && !selectedRemote)}>{t('common.open')}</Button>
        </div>
        </div>
      </div>
    </FloatingWindow>
  )
}

export default function FilesOpenDialog() {
  const opts    = useFilesDialogStore(s => s.openOpts)
  const resolve = useFilesDialogStore(s => s._resolveOpen)
  if (!opts) return null
  return <OpenDialogInner opts={opts} onClose={resolve} />
}
