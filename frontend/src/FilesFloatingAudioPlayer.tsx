import { useRef, useEffect, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import {
  Play, Pause, X, Music, Minimize2, Maximize2, Download,
} from 'lucide-react'
import { FloatingWindow } from '@ui'
import { useWindowZStore } from '@ui'
import { useFilesMediaPlayerStore } from '@kubuno/drive'
import { filesApi, formatSize } from '@kubuno/drive'
// ── Progress bar ──────────────────────────────────────────────────────────────

function ProgressBar({
  position, duration, onSeek,
}: {
  position: number; duration: number; onSeek: (s: number) => void
}) {
  const barRef   = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const [dragPos, setDragPos] = useState<number | null>(null)

  const timeAt = useCallback((clientX: number): number => {
    const bar = barRef.current
    if (!bar || !duration) return 0
    const rect = bar.getBoundingClientRect()
    return Math.max(0, Math.min(duration, ((clientX - rect.left) / rect.width) * duration))
  }, [duration])

  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!dragging.current) return
      const t = timeAt(e.clientX)
      setDragPos(t)
      onSeek(t)
    }
    const up = () => { dragging.current = false; setDragPos(null) }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
  }, [timeAt, onSeek])

  const displayPos = dragPos ?? position
  const pct = duration > 0 ? (displayPos / duration) * 100 : 0

  return (
    <div
      ref={barRef}
      className="relative h-1.5 rounded-full bg-surface-3 cursor-pointer group"
      onMouseDown={e => {
        dragging.current = true
        const t = timeAt(e.clientX)
        setDragPos(t)
        onSeek(t)
        e.stopPropagation()
      }}
    >
      <div className="absolute inset-y-0 left-0 rounded-full bg-primary transition-none" style={{ width: `${pct}%` }} />
      <div
        className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-primary shadow opacity-0 group-hover:opacity-100 -translate-x-1/2"
        style={{ left: `${pct}%` }}
      />
    </div>
  )
}

function fmt(secs: number): string {
  const s = Math.floor(secs)
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`
}

// ── Inner content (shared between expanded and mini) ──────────────────────────
// The single <audio> element lives here so it never unmounts while the store has a file.

function AudioPlayerCore() {
  const { t } = useTranslation('drive')
  const {
    file, isMinimized,
    minimize, restore, close,
    isPlaying, position, duration,
    restorePosition, _clearRestorePosition,
    _setPlaying, _setPosition, _setDuration,
  } = useFilesMediaPlayerStore()

  const audioRef = useRef<HTMLAudioElement>(null)
  const [zIdx]   = useState(() => useWindowZStore.getState().next())

  // Sync store → audio element when file changes; restore position on first load
  useEffect(() => {
    const el = audioRef.current
    if (!el || !file) return
    el.src = filesApi.downloadUrl(file.id)
    const pos = restorePosition
    const startPlayback = () => {
      if (pos > 0) {
        el.currentTime = pos
        _clearRestorePosition()
      }
      el.play().then(() => _setPlaying(true)).catch(() => {})
    }
    if (pos > 0 && el.readyState < 3) {
      el.addEventListener('canplay', startPlayback, { once: true })
    } else {
      startPlayback()
    }
  }, [file?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Drag ref for the mini widget (no shared drag state — each mousedown captures its own closure)
  const pillRef = useRef<HTMLDivElement>(null)

  const onPillMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button,a')) return
    const el = pillRef.current
    if (!el) return
    // Switch from right/bottom to left/top pixel mode on first drag (React never touches left/top).
    if (!el.style.left) {
      const r = el.getBoundingClientRect()
      el.style.right  = 'auto'
      el.style.bottom = 'auto'
      el.style.left   = `${r.left}px`
      el.style.top    = `${r.top}px`
    }
    const rect  = el.getBoundingClientRect()
    const initL = rect.left
    const initT = rect.top
    const startX = e.clientX
    const startY = e.clientY
    const w = el.offsetWidth
    const h = el.offsetHeight
    const onMove = (me: MouseEvent) => {
      el.style.left = `${Math.max(0, Math.min(window.innerWidth  - w, initL + (me.clientX - startX)))}px`
      el.style.top  = `${Math.max(0, Math.min(window.innerHeight - h, initT + (me.clientY - startY)))}px`
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup',   onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup',   onUp)
    e.preventDefault()
  }, [])

  if (!file) return null

  const togglePlay = () => {
    const el = audioRef.current
    if (!el) return
    if (isPlaying) { el.pause(); _setPlaying(false) }
    else { el.play().then(() => _setPlaying(true)).catch(() => {}) }
  }

  const seek = (secs: number) => {
    const el = audioRef.current
    if (!el) return
    el.currentTime = secs
    _setPosition(secs)
  }

  // Hidden audio element — always in the DOM while file is open
  const audioEl = (
    <audio
      ref={audioRef}
      onTimeUpdate={() => { if (audioRef.current) _setPosition(audioRef.current.currentTime) }}
      onDurationChange={() => {
        if (audioRef.current && isFinite(audioRef.current.duration)) _setDuration(audioRef.current.duration)
      }}
      onEnded={() => _setPlaying(false)}
      onError={() => _setPlaying(false)}
      className="hidden"
    />
  )

  // ── Minimized: corner widget ───────────────────────────────────────────────

  if (isMinimized) {
    return createPortal(
      <>
        {audioEl}
        <div
          ref={pillRef}
          className="fixed flex items-center gap-2 px-2 py-2 bg-white rounded-2xl shadow-[0_4px_24px_rgba(0,0,0,0.18)] border border-border select-none cursor-grab active:cursor-grabbing"
          style={{ bottom: 16, right: 16, zIndex: zIdx, maxWidth: 340 }}
          onMouseDown={onPillMouseDown}
        >
          {/* Icon */}
          <div className="w-10 h-10 rounded-lg bg-green-50 flex items-center justify-center flex-shrink-0">
            <Music size={18} className="text-green-500" />
          </div>
          {/* Info */}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-text-primary truncate leading-tight">{file.name}</p>
            <p className="text-xs text-text-tertiary leading-tight">{fmt(position)} / {fmt(duration)}</p>
          </div>
          {/* Controls */}
          <div className="flex items-center gap-0.5">
            <button
              onClick={e => { e.stopPropagation(); togglePlay() }}
              className="w-8 h-8 rounded-full bg-primary hover:bg-primary-hover text-white flex items-center justify-center transition-colors"
            >
              {isPlaying
                ? <Pause size={14} fill="white" />
                : <Play  size={14} fill="white" className="ml-px" />
              }
            </button>
            <button
              onClick={e => { e.stopPropagation(); restore() }}
              className="p-1.5 rounded-full text-text-tertiary hover:text-text-primary hover:bg-surface-2 transition-colors"
              title={t('audio.maximize')}
            >
              <Maximize2 size={14} />
            </button>
            <button
              onClick={e => { e.stopPropagation(); close() }}
              className="p-1.5 rounded-full text-text-tertiary hover:text-danger hover:bg-danger/10 transition-colors"
              title={t('common.close')}
            >
              <X size={14} />
            </button>
          </div>
        </div>
      </>,
      document.body,
    )
  }

  // ── Expanded: FloatingWindow ───────────────────────────────────────────────

  return (
    <FloatingWindow
      title={file.name}
      icon={<Music size={15} className="text-green-500" />}
      onClose={close}
      defaultWidth={340}
      minWidth={280}
      titleActions={
        <button
          onClick={minimize}
          className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-2 transition-colors"
          title={t('audio.minimize')}
        >
          <Minimize2 size={15} />
        </button>
      }
    >
      {audioEl}

      <div className="flex flex-col items-center gap-5 px-6 py-6">
        {/* Cover icon */}
        <div className="w-24 h-24 rounded-2xl bg-green-50 flex items-center justify-center shadow-inner">
          <Music size={40} className="text-green-400" />
        </div>

        {/* File info */}
        <div className="text-center w-full">
          <p className="text-sm font-semibold text-text-primary truncate" title={file.name}>{file.name}</p>
          <p className="text-xs text-text-tertiary mt-0.5">{formatSize(file.size_bytes)}</p>
        </div>

        {/* Progress */}
        <div className="w-full">
          <ProgressBar position={position} duration={duration} onSeek={seek} />
          <div className="flex justify-between text-xs text-text-tertiary mt-1">
            <span>{fmt(position)}</span>
            <span>{fmt(duration)}</span>
          </div>
        </div>

        {/* Play / Pause */}
        <button
          onClick={togglePlay}
          className="w-14 h-14 rounded-full bg-primary hover:bg-primary-hover text-white flex items-center justify-center shadow-md transition-colors"
        >
          {isPlaying
            ? <Pause size={22} fill="white" />
            : <Play  size={22} fill="white" className="ml-1" />
          }
        </button>

        {/* Download */}
        <a
          href={filesApi.downloadUrl(file.id)}
          download={file.name}
          className="flex items-center gap-1.5 px-4 py-1.5 text-xs text-text-secondary hover:text-text-primary border border-border rounded-full hover:bg-surface-1 transition-colors"
        >
          <Download size={13} />
          Télécharger
        </a>
      </div>
    </FloatingWindow>
  )
}

export default function FilesFloatingAudioPlayer() {
  const file = useFilesMediaPlayerStore(s => s.file)
  if (!file) return null
  return <AudioPlayerCore />
}
