import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Star, Trash2, RotateCcw, MoreVertical, Play } from 'lucide-react'
import { filesApi, getFileIcon, type FileItem } from '@kubuno/drive'
import { useAuthStore, useImageCacheStore, usePendingKind, pendingBoxClass, pendingBoxStyle } from '@kubuno/sdk'
import { isCoarsePointer, useLongPress } from '../openable'
import { TagDots } from '../TagUI'
import type { FileVersionStats } from '../fileVersions'
import LockBadge from './LockBadge'
import VersionBadge from './VersionBadge'

const _videoPreviewCache = new Map<string, string>()

export default function FileCard({
  file, trashed, selected, preSelected, focused, onSelect, onContextMenu, onDragStart, onRestore, onDelete, onOpen,
  thumbH = 128, iconScale = 1, dense = false,
}: {
  file: FileItem
  trashed: boolean
  selected: boolean
  preSelected?: boolean
  focused?: boolean
  onSelect: (id: string, e: React.MouseEvent) => void
  onContextMenu: (e: React.MouseEvent) => void
  onDragStart: () => void
  onRestore: () => void
  onDelete: () => void
  onOpen: () => void
  thumbH?: number
  iconScale?: number
  dense?: boolean
}) {
  const { t } = useTranslation('drive')
  const pendingKind = usePendingKind(file.id)
  const isImage = file.mime_type.startsWith('image/')
  const isVideo = file.mime_type.startsWith('video/')
  // The thumbnail is always attempted for images & videos (generated server-side
  // on the fly); `thumbErr` falls back to the type icon when the server cannot
  // produce it.
  const [thumbErr, setThumbErr] = useState(false)
  const hasBigThumb = isImage || isVideo
  // Extension badge shown on the thumbnail (e.g. "DOCX", "PDF"). Skipped for
  // dotless names, hidden files (".gitignore") and non-extension-looking tails.
  const badgeExt = (() => {
    const dot = file.name.lastIndexOf('.')
    if (dot <= 0 || dot === file.name.length - 1) return ''
    const e = file.name.slice(dot + 1)
    return /^[a-z0-9]{1,5}$/i.test(e) ? e.toUpperCase() : ''
  })()
  const thumbVer = useImageCacheStore(s => s.global + (s.versions[file.id] ?? 0))
  const thumbSrc = thumbVer ? `${filesApi.thumbnailUrl(file.id)}?v=${thumbVer}` : filesApi.thumbnailUrl(file.id)
  const videoRef    = useRef<HTMLVideoElement>(null)
  const fetchingRef = useRef(false)
  const [videoPlaying, setVideoPlaying] = useState(false)

  const startVideoPreview = useCallback(async () => {
    if (fetchingRef.current || !videoRef.current) return
    if (videoRef.current.src && videoRef.current.src.startsWith('blob:')) {
      setVideoPlaying(true)
      videoRef.current.currentTime = 0
      videoRef.current.play().catch(() => {})
      return
    }
    const cached = _videoPreviewCache.get(file.id)
    if (cached) {
      videoRef.current.src = cached
      setVideoPlaying(true)
      videoRef.current.play().catch(() => {})
      return
    }
    fetchingRef.current = true
    try {
      const token = useAuthStore.getState().accessToken
      const res = await fetch(`/api/v1/drive/${file.id}/download`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Range: 'bytes=0-10485760',
        },
      })
      if (!res.ok) return
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      _videoPreviewCache.set(file.id, url)
      if (videoRef.current) {
        videoRef.current.src = url
        setVideoPlaying(true)
        videoRef.current.play().catch(() => {})
      }
    } catch {/* ignore */} finally {
      fetchingRef.current = false
    }
  }, [file.id])

  const stopVideoPreview = useCallback(() => {
    setVideoPlaying(false)
    if (videoRef.current) { videoRef.current.pause(); videoRef.current.currentTime = 0 }
  }, [])

  useEffect(() => {
    if (!isVideo || !hasBigThumb) return
    if (selected) { void startVideoPreview() }
    else stopVideoPreview()
  }, [selected]) // eslint-disable-line react-hooks/exhaustive-deps

  const longPress = useLongPress(onContextMenu)
  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault()
    // Touch UIs have no double-click: a single tap opens (unless trashed).
    if (isCoarsePointer() && !trashed) { onOpen(); return }
    onSelect(file.id, e)
  }
  const handleDoubleClick = (e: React.MouseEvent) => {
    if (trashed || isCoarsePointer()) return
    e.preventDefault()
    onOpen()
  }

  const handleVideoMouseEnter = () => { void startVideoPreview() }
  const handleVideoMouseLeave = () => { if (!selected) stopVideoPreview() }
  const handleVideoTimeUpdate = () => {
    if (videoRef.current && videoRef.current.currentTime >= 5) stopVideoPreview()
  }
  const handleVideoEnded = () => stopVideoPreview()

  return (
    <div
      data-selectable-id={file.id}
      className={`group relative rounded-xl border
                 hover:shadow-[0_1px_6px_rgba(0,0,0,0.1)]
                 transition-all min-w-0 select-none cursor-default
                 ${selected
                   ? 'border-primary ring-2 ring-primary/20 bg-[#ddeafc]'
                   : preSelected
                   ? 'border-primary/50 bg-[#ddeafc]'
                   : focused
                   ? 'border-primary/60 ring-2 ring-primary/20 bg-surface-1'
                   : 'border-[#e8eaed] bg-surface-1 hover:border-border hover:bg-[#e4ecf7]'
                 } ${pendingBoxClass(pendingKind)}`}
      style={pendingBoxStyle(pendingKind)}
      draggable={!trashed}
      {...longPress}
      onContextMenu={onContextMenu}
      onDragStart={onDragStart}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
    >
      {/* Checkbox overlay — top-left corner, consistent with FolderCard. */}

      {/* Header: type icon + name + star + menu (the checkbox covers the icon on hover) */}
      <div className={`flex items-center gap-2 ${dense ? 'px-2 h-8' : 'px-3 h-10'}`}>
        <span className="shrink-0 flex items-center [&_svg]:w-[18px] [&_svg]:h-[18px]">{getFileIcon(file.mime_type, file.name)}</span>
        <span className={`${dense ? 'text-xs' : 'text-xs'} truncate flex-1 ${trashed ? 'text-text-secondary line-through' : 'text-text-primary'}`} title={file.name}>{file.name}</span>
        {!trashed && <TagDots itemId={file.id} />}
        {!trashed && <LockBadge fileId={file.id} />}
        {file.is_starred && !trashed && <Star size={12} className="shrink-0 fill-yellow-400 text-yellow-400" />}
        <button className="shrink-0 -mr-1.5 p-1 rounded-full hover:bg-black/10 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => { e.stopPropagation(); onContextMenu(e) }}>
          <MoreVertical size={14} className="text-text-secondary" />
        </button>
      </div>
      {/* Preview: full-area thumbnail (images & videos), otherwise a large type icon */}
      <div
        className={`relative overflow-hidden rounded-lg bg-white ${dense ? 'mx-1.5 mb-1.5' : 'mx-2 mb-2'}`}
        style={{ height: thumbH }}
        onMouseEnter={isVideo && hasBigThumb && !thumbErr ? handleVideoMouseEnter : undefined}
        onMouseLeave={isVideo && hasBigThumb && !thumbErr ? handleVideoMouseLeave : undefined}
      >
        {/* Kept revisions, top-left — the extension badge holds the opposite
          * corner, and neither ever overlaps the video play button. */}
        <VersionBadge file={file as FileItem & FileVersionStats} variant="overlay" />
        {hasBigThumb && !thumbErr ? (
          <>
            <img
              src={thumbSrc}
              alt={file.name}
              className={`w-full h-full object-cover transition-opacity duration-200 ${videoPlaying ? 'opacity-0' : 'opacity-100'}`}
              loading="lazy"
              onError={() => setThumbErr(true)}
            />
            {isVideo && (
              <video
                ref={videoRef}
                muted
                playsInline
                preload="none"
                onTimeUpdate={handleVideoTimeUpdate}
                onEnded={handleVideoEnded}
                className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-200 ${videoPlaying ? 'opacity-100' : 'opacity-0'}`}
              />
            )}
            {isVideo && !videoPlaying && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-9 h-9 rounded-full bg-black/50 flex items-center justify-center">
                  <Play size={16} className="text-white ml-0.5" fill="white" />
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <div style={{ transform: `scale(${iconScale})` }}>{getFileIcon(file.mime_type, file.name)}</div>
          </div>
        )}
      </div>

      {/* Extension badge — bottom-right of the preview. The outer span uses
          `background-color: inherit` so its padding ring matches the card's own
          background in EVERY state (hover/selected/focused) live, carving a
          seamless notch into the white preview area around the white pill.
          Inline styles so it never depends on arbitrary Tailwind utilities. */}
      {badgeExt && (
        <span
          className="absolute z-10 inline-block pointer-events-none"
          style={{
            bottom: '4px', right: '4px',
            padding: dense ? '5px' : '7px', borderRadius: dense ? '10px 0 0 0' : '12px 0 0 0',
            backgroundColor: 'inherit',
            // Match the card's `transition-all` (150ms) so the notch colour
            // animates in lockstep with the card background on hover/select.
            transition: 'background-color 150ms cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        >
          <span
            className="block font-semibold uppercase"
            style={{
              fontSize: '10px', lineHeight: 1, padding: '2px 5px', letterSpacing: '0.04em',
              borderRadius: '6px', color: 'var(--color-text-secondary)',
            }}
          >
            {badgeExt}
          </span>
        </span>
      )}

      {trashed ? (
        <div className="absolute inset-0 flex flex-col items-center justify-end pb-2
                        opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="flex gap-1 bg-white/90 rounded-lg shadow px-2 py-1">
            <button
              onClick={e => { e.stopPropagation(); onRestore() }}
              className="flex items-center gap-1 px-2 py-1 text-xs text-success hover:bg-success/10 rounded"
            >
              <RotateCcw size={11} /> {t('ctx.restore')}
            </button>
            <button
              onClick={e => { e.stopPropagation(); onDelete() }}
              className="flex items-center gap-1 px-2 py-1 text-xs text-danger hover:bg-danger/10 rounded"
            >
              <Trash2 size={11} /> {t('common.delete')}
            </button>
          </div>
        </div>
      ) : (
        <button
          className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 p-1 rounded-full
                     hover:bg-black/10 transition-opacity"
          onClick={e => { e.stopPropagation(); onContextMenu(e) }}
        >
          <MoreVertical size={14} className="text-text-secondary" />
        </button>
      )}
    </div>
  )
}
