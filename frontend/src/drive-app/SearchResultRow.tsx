import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Folder as FolderIcon, Star, Download } from 'lucide-react'
import { filesApi, formatSize, getFileIcon, type FileItem, type SearchHit } from '@kubuno/drive'
import { useImageCacheStore } from '@kubuno/sdk'

// ── Search helpers ────────────────────────────────────────────────────────────

/** Sanitizes the `ts_headline` snippet: escapes all HTML, then re-allows `<b>`. */
export function sanitizeSnippet(raw: string): string {
  const escaped = raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return escaped
    .replace(/&lt;b&gt;/g, '<b>')
    .replace(/&lt;\/b&gt;/g, '</b>')
}

// Image/video thumbnail: the thumbnail is ALWAYS attempted (the server generates
// it on the fly when missing — including videos via ffmpeg). On failure (corrupt
// file, undecodable format…) it falls back to the type icon.
function ThumbImg({ file, src, className }: { file: FileItem; src: string; className: string }) {
  const [err, setErr] = useState(false)
  const thumbable = file.mime_type.startsWith('image/') || file.mime_type.startsWith('video/')
  if (err || !thumbable) return <>{getFileIcon(file.mime_type, file.name)}</>
  return <img src={src} alt={file.name} className={className} loading="lazy" onError={() => setErr(true)} />
}

// ── SearchResultRow ───────────────────────────────────────────────────────────

export default function SearchResultRow({ file, onOpen }: { file: SearchHit; onOpen: (file: FileItem) => void }) {
  const { t, i18n } = useTranslation('drive')
  const updated = new Date(file.updated_at).toLocaleDateString(i18n.language, {
    day: '2-digit', month: 'short', year: 'numeric',
  })
  const thumbVer = useImageCacheStore(s => s.global + (s.versions[file.id] ?? 0))
  const thumbSrc = thumbVer ? `${filesApi.thumbnailUrl(file.id)}?v=${thumbVer}` : filesApi.thumbnailUrl(file.id)

  return (
    <div className="group flex items-start gap-4 py-3 px-2 rounded-lg hover:bg-surface-1 transition-colors">
      <div className="flex-shrink-0 w-10 flex items-center justify-center pt-0.5">
        <ThumbImg file={file} src={thumbSrc} className="w-9 h-9 object-cover rounded" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onOpen(file)}
            className="text-[15px] text-primary hover:underline truncate text-left"
          >
            {file.name}
          </button>
          {file.match_kind === 'semantic' && (
            <span className="flex-shrink-0 text-[10px] uppercase tracking-wide text-primary bg-primary-light px-1.5 py-0.5 rounded-full">
              {t('search.badge_semantic')}
            </span>
          )}
          {file.is_starred && <Star size={13} className="flex-shrink-0 fill-yellow-400 text-yellow-400" />}
          {file.is_trashed && (
            <span className="flex-shrink-0 text-xs text-danger bg-danger-light px-2 py-0.5 rounded-full">
              {t('nav.trash')}
            </span>
          )}
        </div>
        {/* File path (parent folder) */}
        <p className="text-xs text-text-tertiary mt-0.5 truncate flex items-center gap-1">
          <FolderIcon size={11} className="flex-shrink-0 opacity-70" />
          {file.folder_path && file.folder_path !== '/' ? file.folder_path : t('nav.my_drive', { defaultValue: 'Mon Drive' })}
        </p>
        {file.snippet && (
          <p
            className="text-xs text-text-secondary mt-1 line-clamp-2 [&_b]:text-text-primary [&_b]:font-semibold"
            dangerouslySetInnerHTML={{ __html: sanitizeSnippet(file.snippet) }}
          />
        )}
        <p className="text-xs text-text-tertiary mt-0.5">{formatSize(file.size_bytes)} · {updated}</p>
      </div>
      <a
        href={filesApi.downloadUrl(file.id)}
        target="_blank"
        rel="noreferrer"
        className="flex-shrink-0 p-1.5 rounded hover:bg-surface-2 opacity-0 group-hover:opacity-100 transition-all"
        onClick={e => e.stopPropagation()}
        aria-label={`${t('common.download')} ${file.name}`}
      >
        <Download size={14} className="text-text-secondary" />
      </a>
    </div>
  )
}
