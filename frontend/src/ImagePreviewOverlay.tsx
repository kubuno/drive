// Image previewer, built on the generic FilePreviewShell: the shell owns the
// chrome (header, menubar, share, open-with, prev/next, details, dialogs) and
// this file plugs the image-specific features in — the picture itself (with
// the thumbnail-cache busting the explorer already uses), zoom (fit/presets,
// Ctrl+wheel, +/− keys), printing and the « Ajuster l'image » editor hook.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { filesApi, type FileItem } from '@kubuno/drive'
import { useImageCacheStore } from '@kubuno/sdk'
import { MenuDropdown, type MenuItem } from '@ui'
import {
  Download, Printer, ChevronDown, Minus, Plus, Loader2, ImageOff, Search, Wand2,
} from 'lucide-react'
import FilePreviewShell, { ScrollThumbs, type PreviewShellApi, type ShortcutSection } from './FilePreviewShell'

const ZOOM_PRESETS = [0.5, 0.75, 1, 1.5, 2]

interface Props {
  file:          FileItem
  /** All previewable files of the current view, in order (←/→ navigation). */
  files:         FileItem[]
  onClose:       () => void
  onNavigate:    (f: FileItem) => void
  onRename:      (f: FileItem) => void
  onMove:        (f: FileItem) => void
  onShare:       (f: FileItem) => void
  onEditTags:    (f: FileItem) => void
  openWithItems: (f: FileItem) => MenuItem[]
  /** Opens the image adjust editor (rotation, crop, convert…). */
  onEditImage?:  (f: FileItem) => void
}

export default function ImagePreviewOverlay({
  file, files, onClose, onNavigate, onRename, onMove, onShare, onEditTags,
  openWithItems, onEditImage,
}: Props) {
  const { t } = useTranslation('drive')
  const current = file
  const openedAtRef = useRef(performance.now())

  // Full-resolution source: the real file served inline (`inline=1` also tells
  // the backend NOT to count a download). The explorer's cache-bust version
  // still refreshes the picture after edits / « Actualiser ».
  const thumbVer = useImageCacheStore(s => s.global + (s.versions[current.id] ?? 0))
  const src = `${filesApi.downloadUrl(current.id)}?inline=1&v=${thumbVer}`

  // ── Image natural size / load state ────────────────────────────────────────
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const [failed,  setFailed]  = useState(false)
  useEffect(() => { setNatural(null); setFailed(false); setZoom('fit') }, [current.id])

  // ── Zoom ───────────────────────────────────────────────────────────────────
  const [zoom, setZoom] = useState<number | 'fit'>('fit')
  const areaRef = useRef<HTMLDivElement>(null)
  const [areaSize, setAreaSize] = useState<{ w: number; h: number }>({ w: window.innerWidth, h: window.innerHeight })
  useEffect(() => {
    const el = areaRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setAreaSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setAreaSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  const effScale = useMemo(() => {
    if (!natural) return 1
    if (zoom !== 'fit') return zoom
    const fw = (areaSize.w - 64) / natural.w
    const fh = (areaSize.h - 32) / natural.h
    return Math.max(0.05, Math.min(fw, fh, 1))
  }, [zoom, natural, areaSize])

  const zoomLabel = `${Math.round(effScale * 100)} %`
  const zoomIn  = useCallback(() => setZoom(Math.min(+(effScale + 0.25).toFixed(2), 5)), [effScale])
  const zoomOut = useCallback(() => setZoom(Math.max(+(effScale - 0.25).toFixed(2), 0.1)), [effScale])

  // Ctrl/⌘ + wheel zooms (non-passive to beat the browser page zoom).
  const effScaleRef = useRef(effScale)
  effScaleRef.current = effScale
  useEffect(() => {
    const el = areaRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const step = e.deltaY < 0 ? 0.1 : -0.1
      setZoom(Math.min(5, Math.max(0.1, +(effScaleRef.current + step).toFixed(2))))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // Local zoom presets dropdown (toolbar % button).
  const [zoomMenu, setZoomMenu] = useState<{ top: number; left: number } | null>(null)
  const zoomMenuItems = useMemo<MenuItem[]>(() => [
    { type: 'action', label: t('preview.fit', { defaultValue: 'Ajuster à la fenêtre' }), checked: zoom === 'fit', onClick: () => setZoom('fit') },
    { type: 'separator' },
    ...ZOOM_PRESETS.map<MenuItem>(z => ({
      type: 'action', label: `${Math.round(z * 100)} %`, checked: zoom === z, onClick: () => setZoom(z),
    })),
  ], [t, zoom])

  // ── Actions ────────────────────────────────────────────────────────────────
  const handleDownload = useCallback(() => {
    window.open(filesApi.downloadUrl(current.id), '_blank', 'noreferrer')
  }, [current.id])

  // Prints the image from a same-origin iframe (full width, no margins).
  const printingRef = useRef(false)
  const handlePrint = useCallback(async () => {
    if (printingRef.current) return
    printingRef.current = true
    try {
      const iframe = document.createElement('iframe')
      Object.assign(iframe.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' })
      document.body.appendChild(iframe)
      const idoc = iframe.contentDocument
      if (!idoc) { document.body.removeChild(iframe); return }
      idoc.open()
      idoc.write(`<!doctype html><html><head><style>
        @page { margin: 0; }
        html, body { margin: 0; padding: 0; }
        img { display: block; width: 100%; }
      </style></head><body><img src="${src}"></body></html>`)
      idoc.close()
      await Promise.all([...idoc.images].map(im =>
        im.complete ? Promise.resolve() : new Promise(r => { im.onload = im.onerror = () => r(null) })))
      iframe.contentWindow?.focus()
      iframe.contentWindow?.print()
      setTimeout(() => { try { document.body.removeChild(iframe) } catch { /* gone */ } }, 60_000)
    } finally {
      printingRef.current = false
    }
  }, [src])

  // ── Shell extensions ───────────────────────────────────────────────────────

  const viewMenu = useMemo<MenuItem[]>(() => [
    { type: 'submenu', label: t('preview.zoom', { defaultValue: 'Zoomer' }), icon: <Search size={14} />, items: zoomMenuItems },
  ], [t, zoomMenuItems])

  const shortcutSections = useMemo<ShortcutSection[]>(() => [
    {
      title: t('preview.sc_doc', { defaultValue: 'Commandes du document' }),
      rows: [
        { label: t('preview.zoom_in',  { defaultValue: 'Zoom avant' }),   keys: ['+', '='] },
        { label: t('preview.zoom_out', { defaultValue: 'Zoom arrière' }), keys: ['-'] },
      ],
    },
  ], [t])

  const onViewerKey = useCallback((e: KeyboardEvent): boolean => {
    const target = e.target as HTMLElement | null
    const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
    if (e.key === 'Escape') {
      if (zoomMenu) { setZoomMenu(null); return true }
      return false
    }
    if (typing) return false
    if (e.key === '+' || e.key === '=') { zoomIn(); return true }
    if (e.key === '-')                  { zoomOut(); return true }
    return false
  }, [zoomMenu, zoomIn, zoomOut])

  const toolbar = (
    <>
      <button onClick={handleDownload} title={t('common.download')} className="p-1.5 rounded-full hover:bg-white/15 transition-colors">
        <Download size={15} />
      </button>
      <button onClick={() => { void handlePrint() }} title={t('preview.print', { defaultValue: 'Imprimer' })} className="p-1.5 rounded-full hover:bg-white/15 transition-colors">
        <Printer size={15} />
      </button>

      <div className="w-px h-4 bg-white/20 mx-2" />

      <button onClick={zoomOut} title={t('preview.zoom_out', { defaultValue: 'Zoom arrière' })} className="p-1.5 rounded-full hover:bg-white/15 transition-colors">
        <Minus size={15} />
      </button>
      <button
        onClick={e => {
          const r = e.currentTarget.getBoundingClientRect()
          setZoomMenu(prev => (prev ? null : { top: r.bottom + 4, left: r.left }))
        }}
        className="px-2 py-0.5 rounded hover:bg-white/15 tabular-nums transition-colors flex items-center gap-1"
      >
        {zoomLabel}
        <ChevronDown size={12} className="text-white/60" />
      </button>
      <button onClick={zoomIn} title={t('preview.zoom_in', { defaultValue: 'Zoom avant' })} className="p-1.5 rounded-full hover:bg-white/15 transition-colors">
        <Plus size={15} />
      </button>

      {onEditImage && (
        <>
          <div className="w-px h-4 bg-white/20 mx-2" />
          <button
            onClick={() => onEditImage(current)}
            className="flex items-center gap-1.5 pl-2 pr-3 py-1 rounded-full hover:bg-white/15 transition-colors"
          >
            <Wand2 size={15} />
            <span className="text-xs">{t('preview.adjust_image', { defaultValue: 'Ajuster' })}</span>
          </button>
        </>
      )}
    </>
  )

  const overlays = zoomMenu ? (
    <MenuDropdown
      items={zoomMenuItems}
      pos={{ top: zoomMenu.top, left: zoomMenu.left, minWidth: 200 }}
      theme="dark"
      onClose={() => setZoomMenu(null)}
    />
  ) : null

  // ── Viewer content (image zone) ────────────────────────────────────────────

  const renderContent = (shell: PreviewShellApi) => {
    const onBackdropClick = (e: React.MouseEvent) => {
      if (e.target !== e.currentTarget) return
      if (zoomMenu) return
      // Ignore the residual click of the opening double-click: the card opens
      // on the 2nd mousedown, so its click event lands on this backdrop.
      if (performance.now() - openedAtRef.current < 400) return
      shell.requestClose()
    }
    const cssW = natural ? Math.round(natural.w * effScale) : undefined
    const cssH = natural ? Math.round(natural.h * effScale) : undefined
    return (
      <div className="pdf-scroll-wrap relative flex-1 min-w-0">
        <div
          ref={areaRef}
          onClick={onBackdropClick}
          className="pdf-noscrollbar relative h-full w-full overflow-auto"
        >
          {failed ? (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-white/60">
              <ImageOff size={44} className="opacity-40" />
              <p className="text-xs">{t('preview.error_load', { defaultValue: 'Impossible d’afficher ce document' })}</p>
              <button
                onClick={handleDownload}
                className="flex items-center gap-1.5 px-3.5 py-2 text-xs bg-white/10 hover:bg-white/20 text-white rounded-full transition-colors"
              >
                <Download size={14} />
                {t('common.download')}
              </button>
            </div>
          ) : (
            <div
              onClick={onBackdropClick}
              className="min-h-full min-w-fit flex items-center justify-center py-4 px-8"
            >
              {!natural && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <Loader2 size={24} className="animate-spin text-white/60" />
                </div>
              )}
              <img
                key={`${current.id}-${thumbVer}`}
                src={src}
                alt={current.name}
                draggable={false}
                onLoad={e => setNatural({ w: e.currentTarget.naturalWidth || 1, h: e.currentTarget.naturalHeight || 1 })}
                onError={() => setFailed(true)}
                className="shadow-2xl select-none"
                style={natural ? { width: cssW, height: cssH, maxWidth: 'none' } : { opacity: 0 }}
              />
            </div>
          )}
        </div>
        <ScrollThumbs target={areaRef} deps={[effScale, current.id, natural?.w]} />
      </div>
    )
  }

  return (
    <FilePreviewShell
      file={file}
      files={files}
      onClose={onClose}
      onNavigate={onNavigate}
      onRename={onRename}
      onMove={onMove}
      onShare={onShare}
      onEditTags={onEditTags}
      openWithItems={openWithItems}
      ext={{
        viewMenu,
        toolbar,
        onPrint: handlePrint,
        shortcutSections,
        onKey: onViewerKey,
        overlays,
      }}
    >
      {renderContent}
    </FilePreviewShell>
  )
}
