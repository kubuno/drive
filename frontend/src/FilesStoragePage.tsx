import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@kubuno/sdk'
import { api } from '@kubuno/sdk'
import { filesApi, formatSize, type FileItem } from '@kubuno/drive'
import {
  Image, Film, Music, FileText, Archive, File as FileIcon, Folder as FolderIcon,
  Loader2, Trash2, ChevronLeft, ChevronRight,
} from 'lucide-react'
import { Button, Checkbox, Tabs } from '@ui'
import { useConfirm } from '@kubuno/sdk'
import { ConfirmDialog } from '@ui'

const PAGE_SIZE = 25

// ── Catégories ────────────────────────────────────────────────────────────────

interface Category { label: string; color: string; match: (mime: string) => boolean }

const CATEGORIES: Category[] = [
  { label: 'Images',    color: '#1a73e8', match: m => m.startsWith('image/') },
  { label: 'Vidéos',    color: '#ea4335', match: m => m.startsWith('video/') },
  { label: 'Audio',     color: '#fbbc04', match: m => m.startsWith('audio/') },
  { label: 'Documents', color: '#34a853', match: m =>
      m.startsWith('text/') || m.includes('pdf') || m.includes('word') ||
      m.includes('spreadsheet') || m.includes('presentation') || m.includes('opendocument') },
  { label: 'Archives',  color: '#ff6d00', match: m =>
      m.includes('zip') || m.includes('tar') || m.includes('gzip') ||
      m.includes('rar') || m.includes('7z') || m.includes('bzip') },
]

function categorize(file: FileItem): Category {
  return CATEGORIES.find(c => c.match(file.mime_type)) ??
    { label: 'Autre', color: '#9e9e9e', match: () => true }
}

function categoryIcon(cat: Category, size = 16) {
  switch (cat.label) {
    case 'Images':    return <Image    size={size} />
    case 'Vidéos':    return <Film     size={size} />
    case 'Audio':     return <Music    size={size} />
    case 'Documents': return <FileText size={size} />
    case 'Archives':  return <Archive  size={size} />
    default:          return <FileIcon size={size} />
  }
}

function StatsBar({ files, totalBytes }: { files: FileItem[]; totalBytes: number }) {
  const cats = [...CATEGORIES, { label: 'Autre', color: '#9e9e9e', match: () => true } as Category]
  const byCategory = cats.map(cat => {
    const catFiles = cat.label === 'Autre'
      ? files.filter(f => !CATEGORIES.some(c => c.match(f.mime_type)))
      : files.filter(f => cat.match(f.mime_type))
    return { ...cat, bytes: catFiles.reduce((s, f) => s + f.size_bytes, 0) }
  }).filter(c => c.bytes > 0)

  return (
    <div className="mt-4">
      <div className="flex h-2 rounded-full overflow-hidden bg-surface-3 mb-3">
        {byCategory.map(c => (
          <div key={c.label} title={`${c.label} — ${formatSize(c.bytes)}`}
               style={{ width: `${(c.bytes / totalBytes) * 100}%`, background: c.color }} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1">
        {byCategory.map(c => (
          <div key={c.label} className="flex items-center gap-1.5 text-xs text-text-secondary">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: c.color }} />
            {c.label} — {formatSize(c.bytes)}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Pagination ────────────────────────────────────────────────────────────────

function Pager({ page, pageCount, onPage }: { page: number; pageCount: number; onPage: (p: number) => void }) {
  const { t } = useTranslation('drive')
  if (pageCount <= 1) return null
  return (
    <div className="flex items-center justify-center gap-3 py-3 border-t border-border">
      <button
        onClick={() => onPage(page - 1)} disabled={page <= 0}
        className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg text-text-secondary
                   hover:bg-surface-2 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        <ChevronLeft size={16} /> {t('storage.prev')}
      </button>
      <span className="text-sm text-text-tertiary tabular-nums">{t('storage.page', { page: page + 1, total: pageCount })}</span>
      <button
        onClick={() => onPage(page + 1)} disabled={page >= pageCount - 1}
        className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg text-text-secondary
                   hover:bg-surface-2 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        {t('storage.next')} <ChevronRight size={16} />
      </button>
    </div>
  )
}

// ── Barre d'actions de sélection ──────────────────────────────────────────────

function SelectionBar({ count, onArchive, onDelete, busy }: {
  count: number; onArchive: () => void; onDelete: () => void; busy: boolean
}) {
  const { t } = useTranslation('drive')
  if (count === 0) return null
  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-primary-light border-b border-border no-print">
      <span className="text-sm font-medium text-primary flex-1">{t('storage.selected', { count })}</span>
      <Button size="sm" variant="secondary" icon={<Archive size={14} />} onClick={onArchive} loading={busy}>
        {t('storage.archive')}
      </Button>
      <Button size="sm" variant="danger" icon={<Trash2 size={14} />} onClick={onDelete} loading={busy}>
        {t('storage.delete')}
      </Button>
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

type Tab = 'files' | 'folders'

export default function FilesStoragePage() {
  const navigate = useNavigate()
  const { t } = useTranslation('drive')
  const { user, updateUser } = useAuthStore()
  const qc = useQueryClient()
  const { confirm, confirmState, handleConfirm, handleCancel } = useConfirm()

  const [tab, setTab]               = useState<Tab>('files')
  const [filePage, setFilePage]     = useState(0)
  const [folderPage, setFolderPage] = useState(0)
  const [selFiles, setSelFiles]     = useState<Set<string>>(new Set())
  const [selFolders, setSelFolders] = useState<Set<string>>(new Set())

  const filesQ = useQuery({
    queryKey: ['files-by-size'],
    queryFn:  () => filesApi.listFilesBySize(1000).then(d => d.files),
  })
  const foldersQ = useQuery({
    queryKey: ['folders-by-size'],
    queryFn:  () => filesApi.listFoldersBySize(1000).then(d => d.folders),
  })

  const files   = filesQ.data ?? []
  const folders = foldersQ.data ?? []

  const usedBytes  = user?.used_bytes  ?? 0
  const quotaBytes = user?.quota_bytes ?? 0
  const pct = quotaBytes > 0 ? Math.min(100, Math.round((usedBytes / quotaBytes) * 100)) : 0
  const barColor = pct > 90 ? '#d93025' : pct > 70 ? '#f9ab00' : '#1a73e8'
  const totalFileBytes = useMemo(() => files.reduce((s, f) => s + f.size_bytes, 0), [files])

  const refreshUser = async () => {
    try { const { data } = await api.get<{ user: typeof user }>('/me'); if (data?.user) updateUser(data.user) } catch { /* ignore */ }
  }
  const afterMutation = () => {
    qc.invalidateQueries({ queryKey: ['files-by-size'] })
    qc.invalidateQueries({ queryKey: ['folders-by-size'] })
    qc.invalidateQueries({ queryKey: ['files'] })
    qc.invalidateQueries({ queryKey: ['folders'] })
    refreshUser()
    setSelFiles(new Set()); setSelFolders(new Set())
  }

  const deleteMut = useMutation({
    mutationFn: async () => {
      if (tab === 'files') await Promise.all([...selFiles].map(id => filesApi.trashFile(id)))
      else                 await Promise.all([...selFolders].map(id => filesApi.trashFolder(id)))
    },
    onSuccess: afterMutation,
  })

  const archiveMut = useMutation({
    mutationFn: () => {
      const fileIds   = tab === 'files'   ? [...selFiles]   : []
      const folderIds = tab === 'folders' ? [...selFolders] : []
      const stamp = new Date().toISOString().slice(0, 10)
      return filesApi.compressSave(fileIds, folderIds, `archive-${stamp}.zip`, null)
    },
    onSuccess: afterMutation,
  })

  const onDelete = async () => {
    const count = tab === 'files' ? selFiles.size : selFolders.size
    const ok = await confirm({
      title: t('storage.confirm_delete_title'),
      message: t('storage.confirm_delete_msg', { count }),
      variant: 'danger',
      confirmLabel: t('storage.delete'),
    })
    if (ok) deleteMut.mutate()
  }

  const busy = deleteMut.isPending || archiveMut.isPending
  const loading = filesQ.isLoading || foldersQ.isLoading

  // Pagination courante
  const filePages   = Math.max(1, Math.ceil(files.length   / PAGE_SIZE))
  const folderPages = Math.max(1, Math.ceil(folders.length / PAGE_SIZE))
  const pageFiles   = files.slice(filePage   * PAGE_SIZE, filePage   * PAGE_SIZE + PAGE_SIZE)
  const pageFolders = folders.slice(folderPage * PAGE_SIZE, folderPage * PAGE_SIZE + PAGE_SIZE)

  const toggleFile = (id: string) =>
    setSelFiles(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleFolder = (id: string) =>
    setSelFolders(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  const allFilesOnPage   = pageFiles.length > 0 && pageFiles.every(f => selFiles.has(f.id))
  const allFoldersOnPage = pageFolders.length > 0 && pageFolders.every(f => selFolders.has(f.id))
  const toggleAllFiles = () =>
    setSelFiles(s => { const n = new Set(s); allFilesOnPage ? pageFiles.forEach(f => n.delete(f.id)) : pageFiles.forEach(f => n.add(f.id)); return n })
  const toggleAllFolders = () =>
    setSelFolders(s => { const n = new Set(s); allFoldersOnPage ? pageFolders.forEach(f => n.delete(f.id)) : pageFolders.forEach(f => n.add(f.id)); return n })

  return (
    <div className="h-full overflow-y-auto py-6 px-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate(-1)}
          className="p-1.5 rounded-full hover:bg-surface-2 text-text-secondary transition-colors" title="Retour">
          <ChevronLeft size={20} />
        </button>
        <h1 className="text-xl font-medium text-text-primary">{t('storage.title')}</h1>
      </div>

      {/* Quota summary */}
      <div className="bg-white rounded-xl border border-border p-6 mb-6">
        <p className="text-3xl font-light text-text-primary mb-1">
          {formatSize(usedBytes)}
          <span className="text-base font-normal text-text-secondary ml-2">{t('storage.used_suffix', { quota: formatSize(quotaBytes) })}</span>
        </p>
        <div className="mt-3 h-2 bg-surface-3 rounded-full overflow-hidden">
          <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: barColor }} />
        </div>
        <p className="text-xs text-text-tertiary mt-1">{t('storage.percent_used', { pct })}</p>
        {files.length > 0 && <StatsBar files={files} totalBytes={totalFileBytes || usedBytes} />}
        <div className="mt-5 flex gap-2">
          <Button size="sm" variant="secondary" icon={<Trash2 size={14} />} onClick={() => navigate('/drive/trash')}>
            {t('storage.free_space')}
          </Button>
        </div>
      </div>

      {/* Onglets */}
      <Tabs
        tabs={[
          { id: 'files',   label: `${t('storage.tab_files')} (${files.length})`,     icon: FileIcon },
          { id: 'folders', label: `${t('storage.tab_folders')} (${folders.length})`, icon: FolderIcon },
        ]}
        value={tab}
        onChange={t => setTab(t as Tab)}
        className="mb-4"
      />

      <div className="bg-white rounded-xl border border-border overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-text-secondary">
            <Loader2 size={18} className="animate-spin" /><span className="text-sm">Chargement…</span>
          </div>
        ) : tab === 'files' ? (
          <>
            <SelectionBar count={selFiles.size} busy={busy}
              onArchive={() => archiveMut.mutate()} onDelete={onDelete} />
            {files.length === 0 ? (
              <p className="text-sm text-text-tertiary text-center py-12">{t('storage.no_files')}</p>
            ) : (
              <>
                <div className="flex items-center gap-3 px-4 py-2 bg-surface-1">
                  <Checkbox checked={allFilesOnPage} onChange={toggleAllFiles} />
                  <span className="flex-1 text-xs font-medium text-text-tertiary uppercase tracking-wide">{t('storage.col_name')}</span>
                  <span className="text-xs font-medium text-text-tertiary uppercase tracking-wide">{t('storage.col_size')}</span>
                </div>
                <div className="divide-y divide-border/50">
                  {pageFiles.map(file => {
                    const cat = categorize(file)
                    return (
                      <div key={file.id}
                        className={`flex items-center gap-3 px-4 py-2.5 transition-colors cursor-pointer
                                    ${selFiles.has(file.id) ? 'bg-primary-light' : 'hover:bg-surface-1'}`}
                        onClick={() => toggleFile(file.id)}>
                        <Checkbox checked={selFiles.has(file.id)} onChange={() => toggleFile(file.id)} />
                        <span style={{ color: cat.color }} className="shrink-0">{categoryIcon(cat, 16)}</span>
                        <span className="flex-1 text-sm text-text-primary truncate">{file.name}</span>
                        <span className="text-sm text-text-secondary tabular-nums shrink-0">{formatSize(file.size_bytes)}</span>
                      </div>
                    )
                  })}
                </div>
                <Pager page={filePage} pageCount={filePages} onPage={setFilePage} />
              </>
            )}
          </>
        ) : (
          <>
            <SelectionBar count={selFolders.size} busy={busy}
              onArchive={() => archiveMut.mutate()} onDelete={onDelete} />
            {folders.length === 0 ? (
              <p className="text-sm text-text-tertiary text-center py-12">{t('storage.no_folders')}</p>
            ) : (
              <>
                <div className="flex items-center gap-3 px-4 py-2 bg-surface-1">
                  <Checkbox checked={allFoldersOnPage} onChange={toggleAllFolders} />
                  <span className="flex-1 text-xs font-medium text-text-tertiary uppercase tracking-wide">{t('storage.col_name')}</span>
                  <span className="text-xs font-medium text-text-tertiary uppercase tracking-wide w-20 text-right">{t('storage.col_files')}</span>
                  <span className="text-xs font-medium text-text-tertiary uppercase tracking-wide w-24 text-right">{t('storage.col_size')}</span>
                </div>
                <div className="divide-y divide-border/50">
                  {pageFolders.map(folder => (
                    <div key={folder.id}
                      className={`flex items-center gap-3 px-4 py-2.5 transition-colors cursor-pointer
                                  ${selFolders.has(folder.id) ? 'bg-primary-light' : 'hover:bg-surface-1'}`}
                      onClick={() => toggleFolder(folder.id)}>
                      <Checkbox checked={selFolders.has(folder.id)} onChange={() => toggleFolder(folder.id)} />
                      <FolderIcon size={16} className="shrink-0 text-text-secondary" />
                      <span className="flex-1 text-sm text-text-primary truncate" title={folder.path}>{folder.name}</span>
                      <span className="text-sm text-text-tertiary tabular-nums shrink-0 w-20 text-right">{folder.file_count}</span>
                      <span className="text-sm text-text-secondary tabular-nums shrink-0 w-24 text-right">{formatSize(folder.total_size)}</span>
                    </div>
                  ))}
                </div>
                <Pager page={folderPage} pageCount={folderPages} onPage={setFolderPage} />
              </>
            )}
          </>
        )}
      </div>

      {confirmState && (
        <ConfirmDialog {...confirmState} onConfirm={handleConfirm} onCancel={handleCancel} />
      )}
    </div>
  )
}
