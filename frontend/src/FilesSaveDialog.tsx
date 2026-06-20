import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Folder, FolderOpen, Loader2, Save, Search } from 'lucide-react'
import { filesApi, FolderGlyph, type RemoteEntry } from '@kubuno/drive'
import { useFilesDialogStore } from '@kubuno/drive'
import { FloatingWindow } from '@ui'
import { Button, Input } from '@ui'
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
  defaultName:     string
  defaultFolderId: string | null
  onClose: (result: { folderId: string | null; name: string } | null) => void
}

function SaveDialogInner({ defaultName, defaultFolderId, onClose }: Props) {
  const { t } = useTranslation('drive')
  const [currentSourceId, setCurrentSourceId] = useState<string | null>(null)
  const [folderId,        setFolderId]         = useState<string | null>(defaultFolderId)
  const [remote,          setRemote]           = useState<RemoteLoc | null>(null)
  const [pathCrumbs,      setPathCrumbs]       = useState<InternalCrumb[]>([])
  const [filename,        setFilename]         = useState(defaultName)
  const [search,          setSearch]           = useState('')
  const [ready,           setReady]            = useState(!defaultFolderId)

  // Initialise path crumbs from the starting folder.
  useEffect(() => {
    if (!defaultFolderId) { setReady(true); return }
    filesApi.getFolder(defaultFolderId)
      .then(({ folder, ancestors }) => {
        setPathCrumbs([
          ...ancestors.map(a => ({ name: a.name, folderId: a.id })),
          { name: folder.name, folderId: folder.id },
        ])
      })
      .catch(() => {})
      .finally(() => setReady(true))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Local folders ─────────────────────────────────────────────────────────────
  const foldersQ = useQuery({
    queryKey: ['save-dialog-folders', folderId],
    queryFn:  () => filesApi.listFolders(folderId),
    staleTime: 10_000,
    enabled:  ready && !remote,
  })
  // ── Remote mounts ─────────────────────────────────────────────────────────────
  const remotesQ = useQuery({ queryKey: ['save-dialog-remotes'], queryFn: filesApi.listRemotes, staleTime: 30_000, enabled: ready })
  // ── Contents of a remote mount (folders only) ─────────────────────────────────
  const remoteQ  = useQuery({
    queryKey: ['save-dialog-remote-browse', remote?.id, remote?.path],
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
  const remoteDirs = remote  ? (remoteQ.data ?? []).filter(e => e.is_dir && matches(e.name)) : []

  const isLoading = !ready || (remote ? remoteQ.isLoading : foldersQ.isLoading)
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

  // Saving into a remote mount isn't supported by the current SaveDialogResult shape
  // (it carries only a local folderId). Browsing remotes is allowed; saving stays local.
  const canSave = filename.trim().length > 0 && !remote

  return (
    <FloatingWindow
      title={t('savedialog.title')}
      icon={<Save size={17} className="text-primary" />}
      onClose={() => onClose(null)}
      defaultWidth={780}
      defaultHeight={500}
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

        {/* Folder list */}
        <div className="flex-1 overflow-y-auto p-3">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 size={20} className="animate-spin text-text-tertiary" />
            </div>
          ) : empty ? (
            <div className="flex flex-col items-center justify-center h-full text-text-tertiary text-sm gap-2">
              <FolderOpen size={32} strokeWidth={1} />
              <p>{search ? t('common.no_results') : t('savedialog.empty')}</p>
            </div>
          ) : (
            <div className="space-y-0.5">
              {/* Local sub-folders */}
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
              {/* Remote sub-folders */}
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
        <div className="flex flex-col gap-1 px-5 py-3 border-t border-border bg-surface-1 flex-shrink-0">
          {remote && (
            <span className="text-xs text-warning">
              {t('savedialog.remote_readonly', { defaultValue: 'Enregistrement vers un stockage externe non disponible — choisissez un dossier local.' })}
            </span>
          )}
          <div className="flex items-center gap-3">
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
