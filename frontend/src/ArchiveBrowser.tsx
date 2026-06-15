import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import {
  Folder, FileText, Download, X, ChevronRight, ArrowLeft,
  Loader2, Package, Image, Film, Music, type LucideIcon,
} from 'lucide-react'
import { filesApi, formatSize, type FileItem, type ArchiveEntry } from '@kubuno/drive'
interface Props {
  file:    FileItem
  onClose: () => void
}

export default function ArchiveBrowser({ file, onClose }: Props) {
  const { t } = useTranslation('drive')
  const [path, setPath] = useState('')

  const { data, isLoading } = useQuery({
    queryKey:  ['archive-list', file.id, path],
    queryFn:   () => filesApi.listArchive(file.id, path),
    staleTime: 30_000,
  })

  const entries = data?.entries ?? []
  const parts   = path ? path.split('/') : []

  const navigate = (newPath: string) => setPath(newPath)
  const goUp     = () => {
    const idx = path.lastIndexOf('/')
    setPath(idx >= 0 ? path.slice(0, idx) : '')
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl h-[80vh] flex flex-col overflow-hidden">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-start gap-3 px-4 py-3 border-b border-border flex-shrink-0">
          <Package size={20} className="text-text-secondary flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-text-primary truncate">{file.name}</p>
            <nav className="flex items-center flex-wrap gap-0.5 mt-0.5">
              <button
                onClick={() => setPath('')}
                className="text-xs text-text-secondary hover:text-primary transition-colors"
              >
                Racine
              </button>
              {parts.map((part, i) => (
                <span key={i} className="flex items-center gap-0.5">
                  <ChevronRight size={12} className="text-text-tertiary" />
                  <button
                    onClick={() => setPath(parts.slice(0, i + 1).join('/'))}
                    className="text-xs text-text-secondary hover:text-primary transition-colors"
                  >
                    {part}
                  </button>
                </span>
              ))}
            </nav>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-surface-2 text-text-secondary transition-colors flex-shrink-0"
          >
            <X size={18} />
          </button>
        </div>

        {/* ── Sub-toolbar ────────────────────────────────────────────────── */}
        {path && (
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border flex-shrink-0">
            <button
              onClick={goUp}
              className="flex items-center gap-1.5 text-xs text-text-primary hover:bg-surface-2
                         px-2 py-1 rounded transition-colors"
            >
              <ArrowLeft size={13} />
              Niveau supérieur
            </button>
          </div>
        )}

        {/* ── Entries ────────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 size={22} className="animate-spin text-primary" />
            </div>
          ) : entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 gap-2 text-text-secondary">
              <Folder size={32} className="opacity-40" />
              <span className="text-sm">{t('common.empty_folder')}</span>
            </div>
          ) : (
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-xs text-text-tertiary border-b border-border">
                  <th className="text-left font-normal px-4 py-2">{t('common.name')}</th>
                  <th className="text-right font-normal px-4 py-2 w-24">{t('common.size')}</th>
                  <th className="w-10 px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {entries.map(entry => (
                  <EntryRow
                    key={entry.path}
                    entry={entry}
                    fileId={file.id}
                    onNavigate={navigate}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* ── Footer ─────────────────────────────────────────────────────── */}
        <div className="px-4 py-2 border-t border-border text-xs text-text-tertiary flex-shrink-0">
          {data?.total ?? 0} élément{(data?.total ?? 0) !== 1 ? 's' : ''} dans l'archive
        </div>
      </div>
    </div>
  )
}

// ── Icon helper ──────────────────────────────────────────────────────────────

function fileIcon(name: string): LucideIcon {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (['jpg','jpeg','png','gif','webp','svg','avif','heic'].includes(ext)) return Image
  if (['mp4','mkv','mov','avi','webm'].includes(ext)) return Film
  if (['mp3','ogg','wav','flac','aac'].includes(ext)) return Music
  return FileText
}

// ── EntryRow ──────────────────────────────────────────────────────────────────

function EntryRow({ entry, fileId, onNavigate }: {
  entry:      ArchiveEntry
  fileId:     string
  onNavigate: (path: string) => void
}) {
  const { t } = useTranslation('drive')
  if (entry.is_dir) {
    return (
      <tr
        onClick={() => onNavigate(entry.path)}
        className="cursor-pointer hover:bg-surface-1 transition-colors"
      >
        <td className="px-4 py-2">
          <span className="flex items-center gap-3">
            <Folder size={16} className="text-text-secondary flex-shrink-0" />
            <span className="text-text-primary">{entry.name}</span>
          </span>
        </td>
        <td className="px-4 py-2 text-right text-text-tertiary">—</td>
        <td className="px-2 py-2 text-right">
          <ChevronRight size={14} className="text-text-tertiary" />
        </td>
      </tr>
    )
  }

  const IconComp = fileIcon(entry.name)

  return (
    <tr className="hover:bg-surface-1 transition-colors group">
      <td className="px-4 py-2">
        <span className="flex items-center gap-3">
          <IconComp size={16} className="text-text-tertiary flex-shrink-0" />
          <span className="text-text-primary">{entry.name}</span>
        </span>
      </td>
      <td className="px-4 py-2 text-right text-text-tertiary text-xs">
        {formatSize(entry.size)}
      </td>
      <td className="px-2 py-2 text-right">
        <a
          href={filesApi.archiveFileUrl(fileId, entry.path)}
          download={entry.name}
          onClick={e => e.stopPropagation()}
          title={t('common.download')}
          className="inline-flex items-center justify-center p-1 rounded
                     opacity-0 group-hover:opacity-100 hover:bg-surface-2 transition-all"
        >
          <Download size={13} className="text-text-secondary" />
        </a>
      </td>
    </tr>
  )
}
