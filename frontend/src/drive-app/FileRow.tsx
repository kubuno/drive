import React from 'react'
import { useTranslation } from 'react-i18next'
import { Star, Trash2, RotateCcw, MoreVertical } from 'lucide-react'
import { filesApi, formatSize, getFileIcon, type FileItem } from '@kubuno/drive'
import { useImageCacheStore, usePendingKind, pendingBoxClass, pendingBoxStyle } from '@kubuno/sdk'
import { openable, useLongPress } from '../openable'
import { TagDots } from '../TagUI'
import type { FileVersionStats } from '../fileVersions'
import LockBadge from './LockBadge'
import VersionBadge from './VersionBadge'

// ── FileRow (list view) ───────────────────────────────────────────────────────

export default function FileRow({ file, trashed, selected, preSelected, focused, canMove, onSelect, onContextMenu, onRestore, onDelete, onOpen, onDragStart, density = 'normal', hideMeta = false }: {
  file: FileItem
  trashed: boolean
  selected: boolean; preSelected?: boolean; focused?: boolean; canMove: boolean
  onSelect: (id: string, e: React.MouseEvent) => void
  onContextMenu: (e: React.MouseEvent) => void
  onRestore: () => void
  onDelete: () => void
  onOpen: () => void
  onDragStart?: (e: React.DragEvent) => void
  density?: 'compact' | 'normal' | 'large'
  hideMeta?: boolean
}) {
  const { t, i18n } = useTranslation('drive')
  const pendingKind = usePendingKind(file.id)
  const updated = new Date(file.updated_at).toLocaleDateString(i18n.language, { day: '2-digit', month: 'short', year: 'numeric' })
  const thumbVer = useImageCacheStore(s => s.global + (s.versions[file.id] ?? 0))
  const thumbSrc = thumbVer ? `${filesApi.thumbnailUrl(file.id)}?v=${thumbVer}` : filesApi.thumbnailUrl(file.id)
  const pad   = density === 'compact' ? 'px-3 py-1' : density === 'large' ? 'px-4 py-3.5' : 'px-4 py-2.5'
  const thumb = density === 'large' ? 'w-12 h-12' : density === 'compact' ? 'w-6 h-6' : 'w-8 h-8'
  const longPress = useLongPress(onContextMenu)
  return (
    <div data-selectable-id={file.id}
      draggable={canMove} onDragStart={onDragStart}
      className={`group relative flex items-center gap-3 ${pad} transition-colors cursor-default select-none border-l-[3px]
        ${selected ? 'bg-[#e8f0fe] border-primary' : preSelected ? 'bg-[#e8f0fe] border-primary/50' : focused ? 'bg-surface-1 border-primary/40' : 'bg-white border-transparent hover:bg-surface-1'} ${pendingBoxClass(pendingKind)}`}
      style={pendingBoxStyle(pendingKind)}
      {...longPress}
      onContextMenu={onContextMenu}
      {...openable<React.MouseEvent>({ select: (e) => { e.preventDefault(); onSelect(file.id, e) }, open: (e: React.MouseEvent) => { e.preventDefault(); if (!trashed) onOpen() } })}
    >
      <div className={`shrink-0 ${thumb} flex items-center justify-center rounded overflow-hidden bg-surface-2`}>
        {file.has_thumbnail
          ? <img src={thumbSrc} alt={file.name} className="w-full h-full object-cover" />
          : <span className="scale-75">{getFileIcon(file.mime_type, file.name)}</span>
        }
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-text-primary truncate flex items-center gap-1.5">
          <span className="truncate">{file.name}</span>
          {!trashed && <TagDots itemId={file.id} />}
          {!trashed && <LockBadge fileId={file.id} />}
          {/* Inline rather than laid over the thumbnail: at compact density that
            * square is 24 px, where a badge carrying a number is unreadable. */}
          <VersionBadge file={file as FileItem & FileVersionStats} variant="inline" />
        </p>
        {density === 'large' && <p className="text-[11px] text-text-tertiary truncate">{file.mime_type} · {formatSize(file.size_bytes)}</p>}
      </div>
      {!hideMeta && <span className="text-xs text-text-tertiary shrink-0 w-28 text-right">{updated}</span>}
      {!hideMeta && <span className="text-xs text-text-tertiary shrink-0 w-20 text-right">{formatSize(file.size_bytes)}</span>}
      {file.is_starred && !trashed && (
        <Star size={13} className="shrink-0 fill-yellow-400 text-yellow-400" />
      )}
      {trashed ? (
        <div className="flex gap-1 shrink-0">
          <button onClick={e => { e.stopPropagation(); onRestore() }}
            className="flex items-center gap-1 px-2 py-1 text-xs text-success hover:bg-success/10 rounded">
            <RotateCcw size={11} /> {t('ctx.restore')}
          </button>
          <button onClick={e => { e.stopPropagation(); onDelete() }}
            className="flex items-center gap-1 px-2 py-1 text-xs text-danger hover:bg-danger/10 rounded">
            <Trash2 size={11} /> {t('common.delete')}
          </button>
        </div>
      ) : (
        <button
          className="shrink-0 p-1.5 rounded-full hover:bg-surface-2 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={e => { e.stopPropagation(); onContextMenu(e) }}
        >
          <MoreVertical size={14} className="text-text-secondary" />
        </button>
      )}
    </div>
  )
}
