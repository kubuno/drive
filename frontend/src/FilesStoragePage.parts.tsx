/**
 * The parts of `FilesStoragePage.kbview` still written in React (the codemod could not convert them; see the
 * TODO comments in the view). Each is rendered by a `<ReactHost>` with the values it reads as props.
 */
import { useTranslation } from "react-i18next"
import { formatSize, type FileItem } from "@kubuno/drive"
import { Image, Film, Music, FileText, Archive, File as FileIcon, Folder as FolderIcon, Trash2, ChevronLeft, ChevronRight, History } from "lucide-react"
import { Button, Tabs } from "@ui"
import type { FilesStoragePage } from './FilesStoragePage'
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

type Tab = 'files' | 'folders' | 'versions'

function StatsBar({ files, totalBytes, pct, barColor }: { files: FileItem[]; totalBytes: number; pct: number; barColor: string }) {
  const cats = [...CATEGORIES, { label: 'Autre', color: '#9e9e9e', match: () => true } as Category]
  const byCategory = cats.map(cat => {
    const catFiles = cat.label === 'Autre'
      ? files.filter(f => !CATEGORIES.some(c => c.match(f.mime_type)))
      : files.filter(f => cat.match(f.mime_type))
    return { ...cat, bytes: catFiles.reduce((s, f) => s + f.size_bytes, 0) }
  }).filter(c => c.bytes > 0)
  const denom = totalBytes > 0 ? totalBytes : 1

  return (
    <div className="mt-3">
      <div className="flex h-2 rounded-full overflow-hidden bg-surface-3">
        {byCategory.length > 0
          ? byCategory.map(c => (
              <div key={c.label} title={`${c.label} — ${formatSize(c.bytes)}`}
                   className="transition-all duration-500"
                   style={{ width: `${(c.bytes / denom) * pct}%`, background: c.color }} />
            ))
          : <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: barColor }} />}
      </div>
      {byCategory.length > 0 && (
        <div className="flex flex-wrap gap-x-5 gap-y-1 mt-3">
          {byCategory.map(c => (
            <div key={c.label} className="flex items-center gap-1.5 text-xs text-text-secondary">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: c.color }} />
              {c.label} — {formatSize(c.bytes)}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
export { StatsBar }

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
export { Pager }

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
export { SelectionBar }

function VersionsBanner({ size, count, onManage }: { size: string; count: number; onManage: () => void }) {
  const { t } = useTranslation('drive')
  return (
    <div className="flex items-center gap-3 px-4 py-3 mb-6 rounded-xl bg-surface-1 border border-border">
      <History size={18} className="text-text-tertiary shrink-0" />
      <div className="min-w-0">
        <p className="text-sm text-text-primary">{t('version.summary_line', { size, count })}</p>
        <p className="text-xs text-text-tertiary mt-0.5">{t('version.summary_hint')}</p>
      </div>
      <Button size="sm" variant="secondary" className="ml-auto shrink-0" onClick={onManage}>
        {t('version.summary_manage')}
      </Button>
    </div>
  )
}
export { VersionsBanner }

export function Part1({ t, files, folders, versionedFiles, tab, setTab }: { t: NonNullable<FilesStoragePage['tr']>; files: NonNullable<FilesStoragePage['files']>; folders: NonNullable<FilesStoragePage['folders']>; versionedFiles: NonNullable<FilesStoragePage['versionedFiles']>; tab: NonNullable<FilesStoragePage['tab']>; setTab: NonNullable<FilesStoragePage['setTab']> }) {
  return (
    <Tabs
            tabs={[
              { id: 'files',   label: `${t('storage.tab_files')} (${files.length})`,     icon: FileIcon },
              { id: 'folders', label: `${t('storage.tab_folders')} (${folders.length})`, icon: FolderIcon },
              // Kept while the tab is open even once emptied, so purging the last
              // history does not yank the tab out from under the user.
              ...(versionedFiles.length > 0 || tab === 'versions'
                ? [{ id: 'versions' as const, label: `${t('version.tab')} (${versionedFiles.length})`, icon: History }]
                : []),
            ]}
            value={tab}
            onChange={t => setTab(t as Tab)}
            className="mb-4"
          />
  )
}

export function Part2({ cat }: { cat: NonNullable<FilesStoragePage['rows_page_files']>[number]['cat'] }) {
  return (
    <span style={{ color: cat.color }} className="shrink-0">{categoryIcon(cat, 16)}</span>
  )
}

export function Part3({ cat }: { cat: NonNullable<FilesStoragePage['rows_versioned_files']>[number]['cat'] }) {
  return (
    <span style={{ color: cat.color }} className="shrink-0">{categoryIcon(cat, 16)}</span>
  )
}
