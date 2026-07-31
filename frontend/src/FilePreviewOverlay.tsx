// PDF previewer, built ON TOP of the generic FilePreviewShell: the shell owns
// the chrome (header, menubar, share, open-with, prev/next, gutter, details,
// dialogs, base keys) while this file plugs in everything PAGE-related —
// pdf.js loading, continuously scrolled pages, thumbnails/outline rail, zoom,
// in-document search, anchored comments and image-based printing — through the
// shell's extension points. pdf.js is loaded lazily so the main bundle stays
// small. All file dialogs (rename, move, share, labels) are owned by the
// parent and render above the overlay (they use z > 50).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { PDFDocumentProxy, PDFDocumentLoadingTask } from 'pdfjs-dist'
import { filesApi, type FileItem } from '@kubuno/drive'
import { api, useAuthStore } from '@kubuno/sdk'
import { MenuDropdown, type MenuItem } from '@ui'
import {
  X, Download, Printer, ChevronRight, ChevronDown, Minus, Plus, Loader2,
  FileText, Search, Eye, ArrowUp, ArrowDown, MessageSquarePlus, MessageSquare,
  Trash2, Check, Image as ImageIcon, List,
} from 'lucide-react'
import FilePreviewShell, { ScrollThumbs, type PreviewShellApi, type ShortcutSection } from './FilePreviewShell'

// ── Anchored comments ─────────────────────────────────────────────────────────

interface PdfComment {
  id:          string
  file_id:     string
  author_id:   string
  author_name: string | null
  page:        number
  x:           number
  y:           number
  w:           number
  h:           number
  body:        string
  resolved:    boolean
  created_at:  string
  updated_at:  string
}

/** A rectangle normalized to [0,1] within a page, plus the page it lives on. */
interface DraftRect { page: number; x: number; y: number; w: number; h: number }

/** A node of the document outline (bookmarks), as returned by pdf.js. */
interface OutlineNode { title: string; dest?: unknown; url?: string | null; items?: OutlineNode[] }
/** Screen anchor (viewport px) used to position a floating card next to a rect. */
interface Anchor { top: number; left: number }

// ── pdf.js lazy loader ────────────────────────────────────────────────────────

type PdfJsModule = typeof import('pdfjs-dist')
let pdfjsPromise: Promise<PdfJsModule> | null = null
function loadPdfjs(): Promise<PdfJsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist').then(m => {
      m.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/build/pdf.worker.min.mjs',
        import.meta.url,
      ).href
      return m
    })
  }
  return pdfjsPromise
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  file:          FileItem
  /** All previewable files in the current view (folder or search results), in
   *  order and of ANY supported type — powers ←/→ file navigation. */
  files:         FileItem[]
  onClose:       () => void
  /** Opens another previewable file in its own viewer (PDF stays in this
   *  overlay; images/video/text/etc. hand off to their viewer). */
  onNavigate:    (f: FileItem) => void
  onRename:      (f: FileItem) => void
  onMove:        (f: FileItem) => void
  onShare:       (f: FileItem) => void
  onEditTags:    (f: FileItem) => void
  /** Builds the « Ouvrir avec » menu entries for a file (apps + contributors). */
  openWithItems: (f: FileItem) => MenuItem[]
}

/** One search hit: a rectangle in base (scale-1) viewport coordinates. */
interface SearchHitRect { page: number; x: number; y: number; w: number; h: number }

// ── Text-selection stabilizer (port of pdf.js TextLayerBuilder) ──────────────
// Dragging a selection across the blank space between text runs would otherwise
// jump to distant spans (absolute positioning breaks the browser's hit testing).
// pdf.js fixes this by keeping an `endOfContent` div that, while a selection is
// active, is moved right AFTER the current selection anchor — empty areas then
// hit-test onto it instead of an unrelated span. One global listener serves all
// mounted text layers (all pages).

const textLayerEnds = new Map<HTMLElement, HTMLElement>()
let selectionAC: AbortController | null = null

function registerTextLayer(div: HTMLElement, end: HTMLElement) {
  textLayerEnds.set(div, end)
  enableGlobalSelectionListener()
}

function unregisterTextLayer(div: HTMLElement) {
  textLayerEnds.delete(div)
  if (textLayerEnds.size === 0) { selectionAC?.abort(); selectionAC = null }
}

function enableGlobalSelectionListener() {
  if (selectionAC) return
  selectionAC = new AbortController()
  const signal = selectionAC.signal
  const reset = (end: HTMLElement, textLayer: HTMLElement) => {
    textLayer.append(end)
    end.style.width = ''
    end.style.height = ''
    textLayer.classList.remove('selecting')
  }
  let isPointerDown = false
  document.addEventListener('pointerdown', () => { isPointerDown = true }, { signal })
  document.addEventListener('pointerup', () => { isPointerDown = false; textLayerEnds.forEach(reset) }, { signal })
  window.addEventListener('blur', () => { isPointerDown = false; textLayerEnds.forEach(reset) }, { signal })
  document.addEventListener('keyup', () => { if (!isPointerDown) textLayerEnds.forEach(reset) }, { signal })

  let isFirefox: boolean | undefined
  let prevRange: Range | null = null
  document.addEventListener('selectionchange', () => {
    const selection = document.getSelection()
    if (!selection || selection.rangeCount === 0 || textLayerEnds.size === 0) {
      textLayerEnds.forEach(reset)
      return
    }
    // Mark layers the selection currently crosses.
    const active = new Set<HTMLElement>()
    for (let i = 0; i < selection.rangeCount; i++) {
      const range = selection.getRangeAt(i)
      for (const div of textLayerEnds.keys()) {
        if (!active.has(div) && range.intersectsNode(div)) active.add(div)
      }
    }
    for (const [div, end] of textLayerEnds) {
      if (active.has(div)) div.classList.add('selecting')
      else reset(end, div)
    }
    // Firefox handles empty-space hit testing itself (via -moz-user-select).
    isFirefox ??= getComputedStyle(textLayerEnds.keys().next().value as HTMLElement)
      .getPropertyValue('-moz-user-select') === 'none'
    if (isFirefox) return
    // Move the endOfContent right after the moving selection boundary.
    const range = selection.getRangeAt(0)
    const modifyStart = !!prevRange
      && (range.compareBoundaryPoints(Range.END_TO_END, prevRange) === 0
       || range.compareBoundaryPoints(Range.START_TO_END, prevRange) === 0)
    let anchor: Node | null = modifyStart ? range.startContainer : range.endContainer
    if (anchor && anchor.nodeType === Node.TEXT_NODE) anchor = anchor.parentNode
    if (anchor && !modifyStart && range.endOffset === 0) {
      do {
        while (anchor && !anchor.previousSibling) anchor = anchor.parentNode
        anchor = anchor?.previousSibling ?? null
      } while (anchor && !anchor.childNodes.length)
    }
    const anchorEl = anchor instanceof HTMLElement ? anchor : anchor?.parentElement ?? null
    const parentTextLayer = anchorEl?.closest('.textLayer') as HTMLElement | null
    const end = parentTextLayer ? textLayerEnds.get(parentTextLayer) : undefined
    if (end && parentTextLayer && anchor) {
      end.style.width = parentTextLayer.style.width
      end.style.height = parentTextLayer.style.height
      end.style.userSelect = 'text'
      anchorEl?.parentElement?.insertBefore(end, modifyStart ? anchorEl : anchorEl.nextSibling)
    }
    prevRange = range.cloneRange()
  }, { signal })
}

const ZOOM_PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2]
const THUMB_WIDTH  = 104

// ── Single page canvas (lazy-rendered) ───────────────────────────────────────

function PageView({
  doc, pageNum, cssW, cssH, scale, highlights, currentHit, registerEl,
  commentMode, pageComments, draftRect, activeCommentId, onDraftCommit, onSelectComment, onLinkDest,
}: {
  doc:             PDFDocumentProxy
  pageNum:         number
  cssW:            number
  cssH:            number
  scale:           number
  highlights:      SearchHitRect[]
  currentHit:      SearchHitRect | null
  registerEl:      (page: number, el: HTMLDivElement | null) => void
  commentMode:     boolean
  pageComments:    PdfComment[]
  draftRect:       DraftRect | null
  activeCommentId: string | null
  onDraftCommit:   (rect: DraftRect, anchor: Anchor) => void
  onSelectComment: (id: string, anchor: Anchor) => void
  onLinkDest:      (dest: unknown) => void
}) {
  const wrapRef   = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [shouldRender, setShouldRender] = useState(false)
  const [rendered,     setRendered]     = useState(false)
  // Live selection while dragging (normalized, this page).
  const [drag, setDrag] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const dragStart = useRef<{ x: number; y: number } | null>(null)

  const normPoint = (e: React.PointerEvent) => {
    const r = wrapRef.current!.getBoundingClientRect()
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (!commentMode) return
    e.preventDefault()
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    const p = normPoint(e)
    dragStart.current = p
    setDrag({ x: p.x, y: p.y, w: 0, h: 0 })
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragStart.current) return
    const p = normPoint(e)
    const s = dragStart.current
    setDrag({ x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) })
  }
  const onPointerUp = () => {
    const d = drag
    dragStart.current = null
    setDrag(null)
    if (!d || d.w < 0.01 || d.h < 0.01) return
    const r = wrapRef.current!.getBoundingClientRect()
    onDraftCommit(
      { page: pageNum, x: d.x, y: d.y, w: d.w, h: d.h },
      { top: r.top + d.y * r.height, left: r.left + (d.x + d.w) * r.width },
    )
  }

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    registerEl(pageNum, el)
    const io = new IntersectionObserver(
      entries => entries.forEach(e => { if (e.isIntersecting) setShouldRender(true) }),
      { rootMargin: '900px' },
    )
    io.observe(el)
    return () => { io.disconnect(); registerEl(pageNum, null) }
  }, [pageNum, registerEl])

  useEffect(() => {
    if (!shouldRender) return
    let cancelled = false
    let renderTask: { cancel: () => void } | null = null
    doc.getPage(pageNum).then(page => {
      if (cancelled || !canvasRef.current) return
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const vp  = page.getViewport({ scale: scale * dpr })
      const canvas = canvasRef.current
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      canvas.width  = vp.width
      canvas.height = vp.height
      const rt = page.render({ canvas, canvasContext: ctx, viewport: vp })
      renderTask = rt
      rt.promise.then(() => { if (!cancelled) setRendered(true) }).catch(() => {})
    }).catch(() => {})
    return () => { cancelled = true; try { renderTask?.cancel() } catch { /* already done */ } }
  }, [shouldRender, doc, pageNum, scale])

  // Selectable text layer (pdf.js TextLayer): transparent, overlays the canvas.
  const textLayerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!shouldRender) return
    let cancelled = false
    let layer: { cancel?: () => void } | null = null
    const container = textLayerRef.current
    const ac = new AbortController()
    void loadPdfjs().then(async pdfjs => {
      const page = await doc.getPage(pageNum)
      if (cancelled || !container) return
      const vp = page.getViewport({ scale })
      const textContent = await page.getTextContent()
      if (cancelled || !container) return
      container.replaceChildren()
      container.style.setProperty('--scale-factor', String(scale))
      const tl = new pdfjs.TextLayer({ textContentSource: textContent, container, viewport: vp })
      layer = tl
      await tl.render().catch(() => {})
      if (cancelled) return
      // Selection stabilizer (see the module-level port of TextLayerBuilder).
      const end = document.createElement('div')
      end.className = 'endOfContent'
      container.append(end)
      container.addEventListener('mousedown', () => container.classList.add('selecting'), { signal: ac.signal })
      registerTextLayer(container, end)
    })
    return () => {
      cancelled = true
      ac.abort()
      if (container) unregisterTextLayer(container)
      try { layer?.cancel?.() } catch { /* done */ }
    }
  }, [shouldRender, doc, pageNum, scale])

  // Link annotations (clickable). Normalized to [0,1] so they scale with the page.
  const [links, setLinks] = useState<Array<{ x: number; y: number; w: number; h: number; url?: string; dest?: unknown }>>([])
  useEffect(() => {
    if (!shouldRender) return
    let cancelled = false
    void doc.getPage(pageNum).then(async page => {
      const anns = await page.getAnnotations({ intent: 'display' }) as Array<Record<string, unknown>>
      if (cancelled) return
      const vp1 = page.getViewport({ scale: 1 })
      const out = anns
        .filter(a => a.subtype === 'Link' && (a.url || a.dest))
        .map(a => {
          const r = a.rect as number[]
          const [x1, y1] = vp1.convertToViewportPoint(r[0], r[1])
          const [x2, y2] = vp1.convertToViewportPoint(r[2], r[3])
          return {
            x: Math.min(x1, x2) / vp1.width,
            y: Math.min(y1, y2) / vp1.height,
            w: Math.abs(x2 - x1) / vp1.width,
            h: Math.abs(y2 - y1) / vp1.height,
            url:  typeof a.url === 'string' ? a.url : undefined,
            dest: a.dest,
          }
        })
      setLinks(out)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [shouldRender, doc, pageNum])

  return (
    <div
      ref={wrapRef}
      data-page={pageNum}
      className="relative bg-white shadow-2xl shrink-0"
      style={{ width: cssW, height: cssH }}
    >
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />

      {/* Selectable text layer (transparent, over the canvas) */}
      <div ref={textLayerRef} className="textLayer absolute inset-0 z-10" />

      {/* Link annotations (above text so they stay clickable) */}
      {links.map((lk, i) => {
        const style = { left: `${lk.x * 100}%`, top: `${lk.y * 100}%`, width: `${lk.w * 100}%`, height: `${lk.h * 100}%` }
        return lk.url
          ? <a
              key={i}
              href={lk.url}
              target="_blank"
              rel="noopener noreferrer"
              title={lk.url}
              className="absolute z-[11] cursor-pointer"
              style={style}
            />
          : <button
              key={i}
              onClick={() => onLinkDest(lk.dest)}
              className="absolute z-[11] cursor-pointer"
              style={style}
            />
      })}
      {!rendered && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 size={20} className="animate-spin text-neutral-300" />
        </div>
      )}
      {highlights.map((r, i) => {
        const isCurrent = currentHit === r
        return (
          <div
            key={i}
            className={`absolute pointer-events-none rounded-[2px] ${isCurrent ? 'bg-orange-400/60 ring-2 ring-orange-500' : 'bg-yellow-300/50'}`}
            style={{ left: r.x * scale - 1, top: r.y * scale - 1, width: r.w * scale + 2, height: r.h * scale + 2 }}
          />
        )
      })}

      {/* Existing comment anchors (yellow, clickable) */}
      {pageComments.map(c => (
        <button
          key={c.id}
          onClick={e => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
            onSelectComment(c.id, { top: r.top, left: r.right })
          }}
          className={`absolute z-[15] rounded-[2px] transition-colors ${activeCommentId === c.id ? 'bg-amber-400/60 ring-2 ring-amber-500' : 'bg-amber-300/45 hover:bg-amber-300/70 ring-1 ring-amber-400/70'}`}
          style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%`, width: `${c.w * 100}%`, height: `${c.h * 100}%` }}
        />
      ))}

      {/* Committed draft (composer open) */}
      {draftRect && draftRect.page === pageNum && (
        <div
          className="absolute z-[15] pointer-events-none rounded-[2px] bg-amber-300/60 ring-2 ring-amber-500"
          style={{ left: `${draftRect.x * 100}%`, top: `${draftRect.y * 100}%`, width: `${draftRect.w * 100}%`, height: `${draftRect.h * 100}%` }}
        />
      )}

      {/* Selection capture layer (comment mode only) */}
      {commentMode && (
        <div
          className="absolute inset-0 z-20 cursor-crosshair"
          style={{ touchAction: 'none' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          {drag && (
            <div
              className="absolute rounded-[2px] bg-amber-300/50 ring-2 ring-amber-500"
              style={{ left: `${drag.x * 100}%`, top: `${drag.y * 100}%`, width: `${drag.w * 100}%`, height: `${drag.h * 100}%` }}
            />
          )}
        </div>
      )}
    </div>
  )
}

// ── Page thumbnail ───────────────────────────────────────────────────────────

function ThumbView({
  doc, pageNum, baseW, baseH, active, onClick,
}: {
  doc:     PDFDocumentProxy
  pageNum: number
  baseW:   number
  baseH:   number
  active:  boolean
  onClick: () => void
}) {
  const wrapRef   = useRef<HTMLButtonElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [shouldRender, setShouldRender] = useState(false)
  const scale = THUMB_WIDTH / baseW
  const cssH  = Math.round(baseH * scale)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const io = new IntersectionObserver(
      entries => entries.forEach(e => { if (e.isIntersecting) setShouldRender(true) }),
      { rootMargin: '400px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!shouldRender) return
    let cancelled = false
    doc.getPage(pageNum).then(page => {
      if (cancelled || !canvasRef.current) return
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const vp  = page.getViewport({ scale: scale * dpr })
      const canvas = canvasRef.current
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      canvas.width  = vp.width
      canvas.height = vp.height
      page.render({ canvas, canvasContext: ctx, viewport: vp }).promise.catch(() => {})
    }).catch(() => {})
    return () => { cancelled = true }
  }, [shouldRender, doc, pageNum, scale])

  return (
    <div className="flex flex-col items-center gap-1">
      <span className={`text-[11px] ${active ? 'text-white' : 'text-white/50'}`}>{pageNum}</span>
      <button
        ref={wrapRef}
        onClick={onClick}
        className={`bg-white rounded-md overflow-hidden transition-shadow ${active ? 'ring-2 ring-blue-400' : 'ring-1 ring-white/15 hover:ring-white/40'}`}
        style={{ width: THUMB_WIDTH, height: cssH }}
      >
        <canvas ref={canvasRef} className="w-full h-full" />
      </button>
    </div>
  )
}

// ── Document outline (bookmarks) tree ────────────────────────────────────────

/** One outline entry: items with children get a fold/unfold chevron.
 *  Collapsed by default — the user drills down from the top-level titles. */
function OutlineItem({ node, depth, onGo }: {
  node:  OutlineNode
  depth: number
  onGo:  (node: OutlineNode) => void
}) {
  const [open, setOpen] = useState(false)
  const hasKids = !!node.items?.length
  return (
    <div>
      <div className="flex items-start" style={{ paddingLeft: depth * 12 }}>
        {hasKids ? (
          <button
            onClick={() => setOpen(v => !v)}
            className="p-1 mt-0.5 rounded hover:bg-white/10 text-white/60 hover:text-white shrink-0 transition-colors"
          >
            <ChevronRight size={12} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
          </button>
        ) : (
          <span className="w-[22px] shrink-0" />
        )}
        <button
          onClick={() => onGo(node)}
          className="flex-1 min-w-0 text-left text-xs leading-snug text-white/75 hover:text-white hover:bg-white/10 rounded-md px-1.5 py-1 transition-colors"
        >
          {node.title}
        </button>
      </div>
      {hasKids && open && node.items!.map((c, i) => (
        <OutlineItem key={i} node={c} depth={depth + 1} onGo={onGo} />
      ))}
    </div>
  )
}

function OutlineTree({ nodes, depth, onGo }: {
  nodes: OutlineNode[]
  depth: number
  onGo:  (node: OutlineNode) => void
}) {
  return <>{nodes.map((n, i) => <OutlineItem key={i} node={n} depth={depth} onGo={onGo} />)}</>
}

// ── Comment card scaffolding ──────────────────────────────────────────────────

/** A light floating card anchored (viewport px) beside a page region, kept on
 *  screen. Renders on a light surface over the dark overlay. */
function CommentCard({ anchor, onClose, children }: { anchor: Anchor; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: anchor.top, left: anchor.left + 12 })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const M = 12
    let left = anchor.left + 12
    let top  = anchor.top
    if (left + r.width > window.innerWidth - M) left = anchor.left - r.width - 12
    if (left < M) left = M
    if (top + r.height > window.innerHeight - M) top = window.innerHeight - M - r.height
    if (top < M) top = M
    setPos({ top, left })
  }, [anchor])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return (
    <div
      ref={ref}
      className="fixed z-40 w-72 rounded-xl bg-surface-0 shadow-2xl border border-border p-3 select-text"
      style={{ top: pos.top, left: pos.left }}
      onClick={e => e.stopPropagation()}
    >
      {children}
    </div>
  )
}

function CommentAuthorRow({ name, avatar, subtitle }: { name: string; avatar: string | null; subtitle?: string }) {
  const initial = (name || '?').trim().charAt(0).toUpperCase()
  return (
    <div className="flex items-center gap-2 min-w-0">
      {avatar
        ? <img src={avatar} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" />
        : <span className="w-8 h-8 rounded-full bg-primary/15 text-primary text-xs font-medium flex items-center justify-center shrink-0">{initial}</span>}
      <div className="min-w-0">
        <p className="text-xs text-text-primary truncate">{name}</p>
        {subtitle && <p className="text-xs text-text-tertiary truncate">{subtitle}</p>}
      </div>
    </div>
  )
}

// ── PDF previewer (shell consumer) ───────────────────────────────────────────

export default function FilePreviewOverlay({
  file, files, onClose, onNavigate, onRename, onMove, onShare, onEditTags, openWithItems,
}: Props) {
  const { t } = useTranslation('drive')
  const qc = useQueryClient()
  const accessToken = useAuthStore(s => s.accessToken)
  const me = useAuthStore(s => s.user)
  const current = file

  // ── Document state ─────────────────────────────────────────────────────────
  const [doc,      setDoc]      = useState<PDFDocumentProxy | null>(null)
  const [numPages, setNumPages] = useState(0)
  const [baseSize, setBaseSize] = useState<{ w: number; h: number } | null>(null)
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState(false)
  const loadingTaskRef = useRef<PDFDocumentLoadingTask | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)
    setDoc(null)
    setNumPages(0)
    setBaseSize(null)
    setCurrentPage(1)
    setPageInput('1')
    setMatches([])
    setMatchIdx(0)
    setSearchQuery('')
    setCommentMode(false)
    setDraft(null)
    setComposerText('')
    setOpenComment(null)
    setOutline([])
    setRailMode('thumbs')
    textCacheRef.current.clear()
    loadingTaskRef.current?.destroy()
    loadingTaskRef.current = null

    const load = async () => {
      try {
        // Record a view (best-effort) for access stats and the "frequent" list.
        void api.post(`/drive/${current.id}/view`).catch(() => {})
        const pdfjs = await loadPdfjs()
        const resp = await fetch(filesApi.downloadUrl(current.id), {
          headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
        })
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
        const buf = await resp.arrayBuffer()
        if (cancelled) return
        const task = pdfjs.getDocument({ data: buf })
        loadingTaskRef.current = task
        const d = await task.promise
        if (cancelled) { task.destroy(); return }
        const p1 = await d.getPage(1)
        if (cancelled) { task.destroy(); return }
        const vp = p1.getViewport({ scale: 1 })
        setBaseSize({ w: vp.width, h: vp.height })
        setDoc(d)
        setNumPages(d.numPages)
        setLoading(false)
        // Document outline (bookmarks), best-effort.
        const ol = await d.getOutline().catch(() => null)
        if (!cancelled) setOutline((ol as OutlineNode[] | null) ?? [])
      } catch {
        if (!cancelled) { setError(true); setLoading(false) }
      }
    }
    void load()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current.id, accessToken])

  // ── Zoom ───────────────────────────────────────────────────────────────────
  const [zoom, setZoom] = useState<number | 'fit'>('fit')
  const pagesAreaRef = useRef<HTMLDivElement>(null)
  const [areaSize, setAreaSize] = useState<{ w: number; h: number }>({ w: window.innerWidth, h: window.innerHeight })

  useEffect(() => {
    const el = pagesAreaRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setAreaSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setAreaSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [loading])

  const effScale = useMemo(() => {
    if (!baseSize) return 1
    if (zoom !== 'fit') return zoom
    const fw = (areaSize.w - 96) / baseSize.w
    const fh = (areaSize.h - 32) / baseSize.h
    return Math.max(0.2, Math.min(fw, fh, 1.8))
  }, [zoom, baseSize, areaSize])

  const zoomLabel = `${Math.round(effScale * 100)} %`
  const zoomIn  = useCallback(() => setZoom(Math.min(+(effScale + 0.25).toFixed(2), 4)), [effScale])
  const zoomOut = useCallback(() => setZoom(Math.max(+(effScale - 0.25).toFixed(2), 0.25)), [effScale])

  // Ctrl/⌘ + wheel zooms the document (native non-passive listener so we can
  // preventDefault the browser's page zoom). A ref carries the live scale so the
  // listener is attached only once.
  const effScaleRef = useRef(effScale)
  effScaleRef.current = effScale
  useEffect(() => {
    const el = pagesAreaRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const step = e.deltaY < 0 ? 0.1 : -0.1
      setZoom(Math.min(4, Math.max(0.25, +(effScaleRef.current + step).toFixed(2))))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // Local zoom presets dropdown (opened from the toolbar % button).
  const [zoomMenu, setZoomMenu] = useState<{ top: number; left: number } | null>(null)
  const zoomMenuItems = useMemo<MenuItem[]>(() => [
    { type: 'action', label: t('preview.fit', { defaultValue: 'Ajuster à la fenêtre' }), checked: zoom === 'fit', onClick: () => setZoom('fit') },
    { type: 'separator' },
    ...ZOOM_PRESETS.map<MenuItem>(z => ({
      type: 'action', label: `${Math.round(z * 100)} %`, checked: zoom === z, onClick: () => setZoom(z),
    })),
  ], [t, zoom])

  // ── Current page tracking / navigation ─────────────────────────────────────
  const [currentPage, setCurrentPage] = useState(1)
  const [pageInput,   setPageInput]   = useState('1')
  const pageElsRef = useRef<Map<number, HTMLDivElement>>(new Map())
  const currentPageRef = useRef(1)
  currentPageRef.current = currentPage

  const registerPageEl = useCallback((page: number, el: HTMLDivElement | null) => {
    if (el) pageElsRef.current.set(page, el)
    else pageElsRef.current.delete(page)
  }, [])

  const goToPage = useCallback((n: number) => {
    const clamped = Math.max(1, Math.min(n, numPages || 1))
    const el = pageElsRef.current.get(clamped)
    const area = pagesAreaRef.current
    if (el && area) {
      area.scrollTop = el.offsetTop - 16
    }
    setCurrentPage(clamped)
    setPageInput(String(clamped))
  }, [numPages])

  // Scroll spy: the page crossing the upper third of the viewport is "current".
  const spyRaf = useRef(0)
  const onPagesScroll = useCallback(() => {
    setSelMenu(null)
    cancelAnimationFrame(spyRaf.current)
    spyRaf.current = requestAnimationFrame(() => {
      const area = pagesAreaRef.current
      if (!area) return
      const marker = area.getBoundingClientRect().top + area.clientHeight / 3
      let best = currentPageRef.current
      for (const [page, el] of pageElsRef.current) {
        const r = el.getBoundingClientRect()
        if (r.top <= marker && r.bottom >= marker) { best = page; break }
      }
      if (best !== currentPageRef.current) {
        setCurrentPage(best)
        setPageInput(String(best))
      }
    })
  }, [])

  // Keep the current page anchored when zoom changes.
  const prevScaleRef = useRef(effScale)
  useEffect(() => {
    if (prevScaleRef.current !== effScale) {
      prevScaleRef.current = effScale
      const el = pageElsRef.current.get(currentPageRef.current)
      const area = pagesAreaRef.current
      if (el && area) requestAnimationFrame(() => { area.scrollTop = el.offsetTop - 16 })
    }
  }, [effScale])

  // ── Search ─────────────────────────────────────────────────────────────────
  const [searchOpen,  setSearchOpen]  = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searching,   setSearching]   = useState(false)
  const [matches,     setMatches]     = useState<SearchHitRect[]>([])
  const [matchIdx,    setMatchIdx]    = useState(0)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const searchRunRef   = useRef(0)
  // Per-page text items cache: [str, transform, width] in base viewport coords.
  const textCacheRef = useRef<Map<number, Array<{ str: string; x: number; yTop: number; w: number; h: number }>>>(new Map())

  const runSearch = useCallback(async (query: string) => {
    const run = ++searchRunRef.current
    const q = query.trim().toLowerCase()
    setMatches([])
    setMatchIdx(0)
    if (!doc || q.length < 2) { setSearching(false); return }
    setSearching(true)
    const pdfjs = await loadPdfjs()
    const found: SearchHitRect[] = []
    for (let p = 1; p <= doc.numPages; p++) {
      if (searchRunRef.current !== run) return
      let items = textCacheRef.current.get(p)
      if (!items) {
        try {
          const page = await doc.getPage(p)
          const vp1  = page.getViewport({ scale: 1 })
          const tc   = await page.getTextContent()
          items = []
          for (const it of tc.items) {
            if (!('str' in it) || !it.str) continue
            const tx = pdfjs.Util.transform(vp1.transform, it.transform)
            const fontH = Math.hypot(tx[2], tx[3])
            items.push({ str: it.str, x: tx[4], yTop: tx[5] - fontH, w: it.width, h: fontH })
          }
          textCacheRef.current.set(p, items)
        } catch { items = []; textCacheRef.current.set(p, items) }
      }
      for (const it of items) {
        const lower = it.str.toLowerCase()
        let from = 0
        for (;;) {
          const at = lower.indexOf(q, from)
          if (at < 0) break
          const len = it.str.length || 1
          found.push({
            page: p,
            x: it.x + (at / len) * it.w,
            y: it.yTop,
            w: (q.length / len) * it.w,
            h: it.h,
          })
          from = at + q.length
        }
      }
      if (searchRunRef.current === run) setMatches([...found])
    }
    if (searchRunRef.current === run) setSearching(false)
  }, [doc])

  // Debounced live search.
  useEffect(() => {
    if (!searchOpen) return
    const h = setTimeout(() => { void runSearch(searchQuery) }, 300)
    return () => clearTimeout(h)
  }, [searchQuery, searchOpen, runSearch])

  const gotoMatch = useCallback((i: number) => {
    if (!matches.length) return
    const wrapped = ((i % matches.length) + matches.length) % matches.length
    setMatchIdx(wrapped)
    goToPage(matches[wrapped].page)
  }, [matches, goToPage])

  // Jump to the first match when a new search starts yielding results.
  const hadMatchesRef = useRef(false)
  useEffect(() => {
    if (matches.length && !hadMatchesRef.current) goToPage(matches[0].page)
    hadMatchesRef.current = matches.length > 0
  }, [matches, goToPage])

  const openSearch = useCallback(() => {
    setSearchOpen(true)
    requestAnimationFrame(() => searchInputRef.current?.focus())
  }, [])
  const closeSearch = useCallback(() => {
    searchRunRef.current++
    setSearchOpen(false)
    setSearchQuery('')
    setMatches([])
    setSearching(false)
  }, [])

  const matchesByPage = useMemo(() => {
    const m = new Map<number, SearchHitRect[]>()
    for (const hit of matches) {
      const arr = m.get(hit.page) ?? []
      arr.push(hit)
      m.set(hit.page, arr)
    }
    return m
  }, [matches])
  const currentHit = matches[matchIdx] ?? null

  // ── Rail (thumbnails / outline) ────────────────────────────────────────────
  const [showThumbs, setShowThumbs] = useState(true)
  const [railMode, setRailMode] = useState<'thumbs' | 'outline'>('thumbs')
  const [outline,  setOutline]  = useState<OutlineNode[]>([])
  const railWidth = railMode === 'outline' ? 230 : 150
  const railShown = showThumbs && !!doc && !!baseSize && !loading && !error
  const thumbsRailRef = useRef<HTMLDivElement>(null)

  // ── Comments (anchored to page regions) ─────────────────────────────────────
  const { data: commentsData } = useQuery({
    queryKey: ['pdf-comments', current.id],
    queryFn:  () => api.get<{ comments: PdfComment[] }>(`/drive/${current.id}/comments`).then(r => r.data.comments),
  })
  const comments = useMemo(() => (commentsData ?? []).filter(c => !c.resolved), [commentsData])
  const commentsByPage = useMemo(() => {
    const m = new Map<number, PdfComment[]>()
    for (const c of comments) { const a = m.get(c.page) ?? []; a.push(c); m.set(c.page, a) }
    return m
  }, [comments])

  const [commentMode,  setCommentMode]  = useState(false)
  const [draft,        setDraft]        = useState<{ rect: DraftRect; anchor: Anchor } | null>(null)
  const [composerText, setComposerText] = useState('')
  const [openComment,  setOpenComment]  = useState<{ id: string; anchor: Anchor } | null>(null)
  // Show/hide the comment anchors on pages (Afficher > Commentaires).
  const [showComments, setShowComments] = useState(true)

  const exitCommentMode = useCallback(() => {
    setCommentMode(false)
    setDraft(null)
    setComposerText('')
  }, [])

  const onDraftCommit = useCallback((rect: DraftRect, anchor: Anchor) => {
    setDraft({ rect, anchor })
    setOpenComment(null)
  }, [])

  const submitComment = useCallback(() => {
    if (!draft || !composerText.trim()) return
    const { page, x, y, w, h } = draft.rect
    void api.post(`/drive/${current.id}/comments`, { page, x, y, w, h, body: composerText.trim() })
      .then(() => {
        qc.invalidateQueries({ queryKey: ['pdf-comments', current.id] })
        exitCommentMode()
      })
      .catch(() => {})
  }, [draft, composerText, current.id, qc, exitCommentMode])

  const deleteComment = useCallback((id: string) => {
    void api.delete(`/drive/comments/${id}`)
      .then(() => { qc.invalidateQueries({ queryKey: ['pdf-comments', current.id] }); setOpenComment(null) })
      .catch(() => {})
  }, [current.id, qc])

  const resolveComment = useCallback((id: string) => {
    void api.patch(`/drive/comments/${id}/resolve`, { resolved: true })
      .then(() => { qc.invalidateQueries({ queryKey: ['pdf-comments', current.id] }); setOpenComment(null) })
      .catch(() => {})
  }, [current.id, qc])

  const openCommentData = useMemo(
    () => (openComment ? comments.find(c => c.id === openComment.id) ?? null : null),
    [openComment, comments],
  )

  // ── Text selection: copy / add-comment context menu ─────────────────────────
  const [selMenu, setSelMenu] = useState<{ anchor: Anchor; rect: DraftRect; text: string } | null>(null)
  const commentModeRef = useRef(commentMode)
  commentModeRef.current = commentMode

  // Inspects the current selection and, if it falls on a page, returns the menu
  // anchor + normalized rect (for anchoring a comment) + the selected text.
  const selectionInfo = useCallback((): { anchor: Anchor; rect: DraftRect; text: string } | null => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !sel.rangeCount || !sel.toString().trim()) return null
    const range = sel.getRangeAt(0)
    let node: Node | null = range.startContainer
    let pageEl: HTMLElement | null = null
    while (node) {
      if (node instanceof HTMLElement && node.dataset.page) { pageEl = node; break }
      node = node.parentNode
    }
    if (!pageEl) return null
    const pr = pageEl.getBoundingClientRect()
    const sr = range.getBoundingClientRect()
    if (sr.width === 0 && sr.height === 0) return null
    return {
      anchor: { top: sr.bottom + 4, left: sr.left + sr.width / 2 },
      rect: {
        page: Number(pageEl.dataset.page),
        x: (sr.left - pr.left) / pr.width,
        y: (sr.top  - pr.top)  / pr.height,
        w: sr.width  / pr.width,
        h: sr.height / pr.height,
      },
      text: sel.toString(),
    }
  }, [])

  const copyToClipboardText = useCallback(async (text: string) => {
    // The async clipboard API needs a secure context (HTTPS/localhost); fall
    // back to a hidden textarea + execCommand otherwise (or on failure).
    if (navigator.clipboard && window.isSecureContext) {
      try { await navigator.clipboard.writeText(text); return } catch { /* fall through */ }
    }
    const ta = document.createElement('textarea')
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'
    document.body.appendChild(ta); ta.select()
    try { document.execCommand('copy') } finally { document.body.removeChild(ta) }
  }, [])

  const selMenuItems = useMemo<MenuItem[]>(() => selMenu ? [
    { type: 'action', label: t('preview.copy', { defaultValue: 'Copier' }), onClick: () => {
        void copyToClipboardText(selMenu.text); window.getSelection()?.removeAllRanges(); setSelMenu(null)
      } },
    { type: 'action', label: t('preview.add_comment', { defaultValue: 'Ajouter un commentaire' }), onClick: () => {
        setDraft({ rect: selMenu.rect, anchor: selMenu.anchor }); setOpenComment(null)
        window.getSelection()?.removeAllRanges(); setSelMenu(null)
      } },
  ] : [], [selMenu, t, copyToClipboardText])

  // Resolves a link's internal destination to a page and scrolls there.
  const onLinkDest = useCallback(async (dest: unknown) => {
    if (!doc || dest == null) return
    try {
      const explicit = typeof dest === 'string' ? await doc.getDestination(dest) : dest
      if (!Array.isArray(explicit) || !explicit[0]) return
      const pageIndex = await doc.getPageIndex(explicit[0])
      goToPage(pageIndex + 1)
    } catch { /* ignore unresolved dests */ }
  }, [doc, goToPage])

  // ── Print (image-based: Chrome can't script-print a blob-PDF iframe) ───────
  const printingRef = useRef(false)
  const handlePrint = useCallback(async () => {
    if (!doc || printingRef.current) return
    printingRef.current = true
    try {
      const imgs: string[] = []
      for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p)
        const vp = page.getViewport({ scale: 2 })
        const canvas = document.createElement('canvas')
        canvas.width = vp.width
        canvas.height = vp.height
        const ctx = canvas.getContext('2d')
        if (!ctx) continue
        await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise
        imgs.push(canvas.toDataURL('image/jpeg', 0.92))
      }
      const iframe = document.createElement('iframe')
      Object.assign(iframe.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' })
      document.body.appendChild(iframe)
      const idoc = iframe.contentDocument
      if (!idoc) { document.body.removeChild(iframe); return }
      idoc.open()
      idoc.write(`<!doctype html><html><head><style>
        @page { margin: 0; }
        html, body { margin: 0; padding: 0; }
        img { display: block; width: 100%; page-break-after: always; }
        img:last-child { page-break-after: auto; }
      </style></head><body>${imgs.map(s => `<img src="${s}">`).join('')}</body></html>`)
      idoc.close()
      await Promise.all([...idoc.images].map(im =>
        im.complete ? Promise.resolve() : new Promise(r => { im.onload = im.onerror = () => r(null) })))
      iframe.contentWindow?.focus()
      iframe.contentWindow?.print()
      // Keep the iframe alive while the (async) print dialog uses it.
      setTimeout(() => { try { document.body.removeChild(iframe) } catch { /* gone */ } }, 60_000)
    } finally {
      printingRef.current = false
    }
  }, [doc])

  const handleDownload = useCallback(() => {
    window.open(filesApi.downloadUrl(current.id), '_blank', 'noreferrer')
  }, [current.id])

  // ── Shell extensions ───────────────────────────────────────────────────────

  const viewMenu = useMemo<MenuItem[]>(() => [
    {
      type: 'submenu', label: t('preview.view_show', { defaultValue: 'Afficher' }), icon: <Eye size={14} />,
      items: [
        { type: 'action', label: t('preview.view_thumbnail', { defaultValue: 'Vignette' }), checked: showThumbs && railMode === 'thumbs', onClick: () => { setShowThumbs(true); setRailMode('thumbs') } },
        { type: 'action', label: t('preview.view_outline_item', { defaultValue: 'Plan' }), checked: showThumbs && railMode === 'outline', disabled: outline.length === 0, onClick: () => { setShowThumbs(true); setRailMode('outline') } },
      ],
    },
    { type: 'separator' },
    {
      type: 'submenu', label: t('preview.comments', { defaultValue: 'Commentaires' }), icon: <MessageSquare size={14} />,
      items: [
        { type: 'action', label: t('preview.comments_hide', { defaultValue: 'Masquer les commentaires' }), checked: !showComments, onClick: () => setShowComments(false) },
        { type: 'action', label: t('preview.comments_show', { defaultValue: 'Afficher les commentaires' }), checked: showComments, onClick: () => setShowComments(true) },
      ],
    },
    { type: 'separator' },
    { type: 'submenu', label: t('preview.zoom', { defaultValue: 'Zoomer' }), icon: <Search size={14} />, items: zoomMenuItems },
  ], [t, showThumbs, railMode, outline.length, showComments, zoomMenuItems])

  const insertMenu = useMemo(() => [{
    id: 'insert',
    label: t('preview.menu_insert', { defaultValue: 'Insertion' }),
    items: [
      {
        type: 'action', label: t('preview.add_comment', { defaultValue: 'Ajouter un commentaire' }),
        icon: <MessageSquarePlus size={14} />,
        onClick: () => { setCommentMode(true); setOpenComment(null); setDraft(null) },
      } as MenuItem,
    ],
  }], [t])

  const toolsMenu = useMemo<MenuItem[]>(() => [
    { type: 'action', label: t('preview.search', { defaultValue: 'Rechercher' }), shortcut: 'Ctrl+F', icon: <Search size={14} />, onClick: openSearch },
  ], [t, openSearch])

  const shortcutSections = useMemo<ShortcutSection[]>(() => [
    {
      title: t('preview.sc_doc', { defaultValue: 'Commandes du document' }),
      rows: [
        { label: t('preview.zoom_in',      { defaultValue: 'Zoom avant' }),                   keys: ['+', '='] },
        { label: t('preview.zoom_out',     { defaultValue: 'Zoom arrière' }),                 keys: ['-'] },
        { label: t('preview.sc_next_page', { defaultValue: 'Page suivante' }),                keys: ['J'] },
        { label: t('preview.sc_prev_page', { defaultValue: 'Page précédente' }),              keys: ['K'] },
        { label: t('preview.sc_print',     { defaultValue: 'Imprimer le document' }),         keys: ['Ctrl', 'P'] },
        { label: t('preview.sc_find',      { defaultValue: 'Ouvrir la barre de recherche' }), keys: ['Ctrl', 'F'] },
      ],
    },
  ], [t])

  // Viewer-specific key bindings; runs before the shell's base handler.
  const onViewerKey = useCallback((e: KeyboardEvent): boolean => {
    const target = e.target as HTMLElement | null
    const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
    if (e.key === 'Escape') {
      if (selMenu)     { setSelMenu(null); return true }
      if (zoomMenu)    { setZoomMenu(null); return true }
      if (searchOpen)  { closeSearch(); return true }
      if (commentMode) { exitCommentMode(); return true }
      return false
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); openSearch(); return true }
    if (typing) return false
    if (e.key === '+' || e.key === '=') { zoomIn(); return true }
    if (e.key === '-')                  { zoomOut(); return true }
    if (e.key === 'j' || e.key === 'J') { goToPage(currentPageRef.current + 1); return true }
    if (e.key === 'k' || e.key === 'K') { goToPage(currentPageRef.current - 1); return true }
    return false
  }, [selMenu, zoomMenu, searchOpen, commentMode, closeSearch, exitCommentMode, openSearch, zoomIn, zoomOut, goToPage])

  // Right-click over selected text → copy / add-comment menu at the cursor.
  const onViewerContextMenu = useCallback((e: React.MouseEvent) => {
    if (commentModeRef.current) return
    const info = selectionInfo()
    if (info) setSelMenu({ ...info, anchor: { top: e.clientY + 2, left: e.clientX + 92 } })
  }, [selectionInfo])

  // ── Extension nodes ────────────────────────────────────────────────────────

  const toolbar = (!loading && !error && numPages > 0) ? (
    <>
      <span>{t('preview.page', { defaultValue: 'Page' })}</span>
      <input
        value={pageInput}
        onChange={e => setPageInput(e.target.value.replace(/[^0-9]/g, ''))}
        onKeyDown={e => { if (e.key === 'Enter') goToPage(parseInt(pageInput || '1', 10)) }}
        onBlur={() => setPageInput(String(currentPage))}
        className="w-9 mx-1 px-1 py-0.5 text-center bg-transparent border border-white/30 rounded focus:border-white/70 outline-none tabular-nums"
      />
      <span className="tabular-nums">/ {numPages}</span>

      <div className="w-px h-4 bg-white/20 mx-2" />

      <button onClick={handleDownload} title={t('common.download')} className="p-1.5 rounded-full hover:bg-white/15 transition-colors">
        <Download size={15} />
      </button>
      <button onClick={() => { void handlePrint() }} disabled={!doc} title={t('preview.print', { defaultValue: 'Imprimer' })} className="p-1.5 rounded-full hover:bg-white/15 disabled:opacity-40 transition-colors">
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

      <div className="w-px h-4 bg-white/20 mx-2" />

      <button
        onClick={() => (searchOpen ? closeSearch() : openSearch())}
        title={`${t('preview.search', { defaultValue: 'Rechercher' })} (Ctrl+F)`}
        className={`p-1.5 rounded-full transition-colors ${searchOpen ? 'bg-white/20' : 'hover:bg-white/15'}`}
      >
        <Search size={15} />
      </button>

      <div className="w-px h-4 bg-white/20 mx-2" />

      <button
        onClick={() => (commentMode ? exitCommentMode() : (setCommentMode(true), setOpenComment(null)))}
        className={`flex items-center gap-1.5 pl-2 pr-3 py-1 rounded-full transition-colors ${commentMode ? 'bg-white/20 text-white' : 'hover:bg-white/15'}`}
      >
        <MessageSquarePlus size={15} />
        <span className="text-xs">{t('preview.comment', { defaultValue: 'Commenter' })}</span>
        {comments.length > 0 && (
          <span className="ml-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-white/25 text-[11px] leading-[18px] text-center">
            {comments.length}
          </span>
        )}
      </button>
    </>
  ) : null

  const toolbarOverlay = searchOpen ? (
    <div className="absolute right-3 top-0 z-10 flex items-center gap-1 bg-neutral-800 border border-white/15 rounded-full pl-4 pr-1.5 py-1 shadow-xl">
      <input
        ref={searchInputRef}
        value={searchQuery}
        onChange={e => setSearchQuery(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') gotoMatch(matchIdx + (e.shiftKey ? -1 : 1))
        }}
        placeholder={t('preview.search_doc', { defaultValue: 'Rechercher dans le document' })}
        className="w-52 bg-transparent text-white text-xs placeholder-white/40 outline-none"
      />
      <span className="text-white/50 text-xs tabular-nums whitespace-nowrap px-1">
        {searching
          ? <Loader2 size={12} className="animate-spin inline" />
          : searchQuery.trim().length >= 2
            ? (matches.length
                ? t('preview.match_of', { defaultValue: '{{n}} sur {{total}}', n: matchIdx + 1, total: matches.length })
                : t('common.no_results'))
            : null}
      </span>
      <button onClick={() => gotoMatch(matchIdx - 1)} disabled={!matches.length} className="p-1 rounded-full text-white/70 hover:bg-white/10 disabled:opacity-30">
        <ArrowUp size={14} />
      </button>
      <button onClick={() => gotoMatch(matchIdx + 1)} disabled={!matches.length} className="p-1 rounded-full text-white/70 hover:bg-white/10 disabled:opacity-30">
        <ArrowDown size={14} />
      </button>
      <button onClick={closeSearch} className="p-1 rounded-full text-white/70 hover:bg-white/10">
        <X size={14} />
      </button>
    </div>
  ) : null

  const railButtons = (
    <>
      <button
        onClick={() => { setShowThumbs(true); setRailMode('thumbs') }}
        title={t('preview.show_thumbnails', { defaultValue: 'Afficher les vignettes' })}
        className={`p-2 rounded-lg transition-colors ${showThumbs && railMode === 'thumbs' ? 'bg-white/15 text-white' : 'text-white/60 hover:bg-white/10 hover:text-white'}`}
      >
        <ImageIcon size={17} />
      </button>
      <button
        onClick={() => { setShowThumbs(true); setRailMode('outline') }}
        disabled={outline.length === 0}
        title={outline.length === 0
          ? t('preview.no_outline', { defaultValue: 'Ce document n’a pas de plan' })
          : t('preview.show_outline', { defaultValue: 'Afficher le plan' })}
        className={`p-2 rounded-lg transition-colors disabled:opacity-30 ${showThumbs && railMode === 'outline' ? 'bg-white/15 text-white' : 'text-white/60 hover:bg-white/10 hover:text-white'}`}
      >
        <List size={17} />
      </button>
    </>
  )

  const rail = railShown ? (
    <div className="pdf-scroll-wrap relative shrink-0">
      <div
        ref={thumbsRailRef}
        className={`pdf-noscrollbar h-full overflow-y-auto pt-3 pb-16 flex flex-col ${railMode === 'thumbs' ? 'px-2 items-center gap-3' : 'px-2 gap-0.5'}`}
        style={{ width: railWidth }}
      >
        {railMode === 'thumbs'
          ? Array.from({ length: numPages }, (_, i) => (
              <ThumbView
                key={i + 1}
                doc={doc!}
                pageNum={i + 1}
                baseW={baseSize!.w}
                baseH={baseSize!.h}
                active={currentPage === i + 1}
                onClick={() => goToPage(i + 1)}
              />
            ))
          : <OutlineTree
              nodes={outline}
              depth={0}
              onGo={(n) => { if (n.url) window.open(n.url, '_blank', 'noopener,noreferrer'); else void onLinkDest(n.dest) }}
            />}
      </div>
      <ScrollThumbs target={thumbsRailRef} deps={[numPages, showThumbs, railMode]} alwaysTrack />
    </div>
  ) : undefined

  const overlays = (
    <>
      {/* Comment mode — blue banner prompting for a region */}
      {commentMode && !draft && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 pl-4 pr-2 py-2 rounded-lg bg-blue-600 text-white shadow-xl">
          <span className="text-xs">{t('preview.comment_select_zone', { defaultValue: 'Sélectionnez la zone où vous souhaitez ajouter un commentaire.' })}</span>
          <button onClick={exitCommentMode} className="p-1 rounded-full hover:bg-white/20 transition-colors">
            <X size={16} />
          </button>
        </div>
      )}

      {/* Comment composer — anchored next to the drawn region */}
      {draft && (
        <CommentCard anchor={draft.anchor} onClose={exitCommentMode}>
          <CommentAuthorRow name={me?.display_name ?? me?.email ?? ''} avatar={me?.avatar_url ?? null} />
          <textarea
            autoFocus
            value={composerText}
            onChange={e => setComposerText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submitComment() }}
            placeholder={t('preview.comment_placeholder', { defaultValue: 'Tapez un commentaire…' })}
            className="w-full mt-2 h-20 resize-none rounded-lg border border-border px-3 py-2 text-xs text-text-primary outline-none focus:border-primary"
          />
          <p className="text-xs text-text-tertiary mt-2">{t('preview.comment_readers_note', { defaultValue: 'Les lecteurs peuvent voir les commentaires.' })}</p>
          <div className="flex justify-end gap-2 mt-3">
            <button onClick={exitCommentMode} className="px-3 py-1.5 text-xs text-primary rounded-lg hover:bg-primary-light/60 transition-colors">
              {t('common.cancel', { defaultValue: 'Annuler' })}
            </button>
            <button
              onClick={submitComment}
              disabled={!composerText.trim()}
              className="px-4 py-1.5 text-xs rounded-lg bg-primary text-white disabled:opacity-40 hover:bg-primary-hover transition-colors"
            >
              {t('preview.comment', { defaultValue: 'Commenter' })}
            </button>
          </div>
        </CommentCard>
      )}

      {/* Open comment — read + resolve/delete */}
      {openComment && openCommentData && (
        <CommentCard anchor={openComment.anchor} onClose={() => setOpenComment(null)}>
          <div className="flex items-start justify-between gap-2">
            <CommentAuthorRow
              name={openCommentData.author_name ?? ''}
              avatar={null}
              subtitle={new Date(openCommentData.created_at).toLocaleString()}
            />
            <div className="flex items-center gap-0.5 shrink-0">
              {(me?.id === openCommentData.author_id || me?.role === 'admin') && (
                <>
                  <button
                    onClick={() => resolveComment(openCommentData.id)}
                    title={t('preview.comment_resolve', { defaultValue: 'Marquer comme résolu' })}
                    className="p-1.5 rounded-full text-text-secondary hover:bg-surface-2 transition-colors"
                  >
                    <Check size={15} />
                  </button>
                  <button
                    onClick={() => deleteComment(openCommentData.id)}
                    title={t('common.delete', { defaultValue: 'Supprimer' })}
                    className="p-1.5 rounded-full text-danger hover:bg-danger-light transition-colors"
                  >
                    <Trash2 size={15} />
                  </button>
                </>
              )}
            </div>
          </div>
          <p className="text-xs text-text-primary mt-2 whitespace-pre-wrap break-words">{openCommentData.body}</p>
        </CommentCard>
      )}

      {/* Zoom presets dropdown (toolbar % button) */}
      {zoomMenu && (
        <MenuDropdown
          items={zoomMenuItems}
          pos={{ top: zoomMenu.top, left: zoomMenu.left, minWidth: 200 }}
          theme="dark"
          onClose={() => setZoomMenu(null)}
        />
      )}

      {/* Text-selection menu: Copier / Ajouter un commentaire */}
      {selMenu && (
        <MenuDropdown
          items={selMenuItems}
          pos={{ top: selMenu.anchor.top, left: Math.max(8, selMenu.anchor.left - 90), minWidth: 180 }}
          theme="dark"
          onClose={() => setSelMenu(null)}
        />
      )}
    </>
  )

  // ── Viewer content (pages zone) ────────────────────────────────────────────

  const renderContent = (shell: PreviewShellApi) => {
    // Backdrop clicks close the previewer unless a viewer UI is active.
    const onBackdropClick = (e: React.MouseEvent) => {
      if (e.target !== e.currentTarget) return
      if (commentMode || draft || openComment || searchOpen || selMenu || zoomMenu) return
      shell.requestClose()
    }
    return (
      <div className="pdf-scroll-wrap relative flex-1 min-w-0">
        <div
          ref={pagesAreaRef}
          onScroll={onPagesScroll}
          onClick={onBackdropClick}
          className="pdf-noscrollbar relative h-full w-full overflow-auto"
        >
          {loading && (
            <div className="h-full flex items-center justify-center gap-2 text-white/70">
              <Loader2 size={22} className="animate-spin" />
              <span className="text-xs">{t('common.loading')}</span>
            </div>
          )}
          {error && (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-white/60">
              <FileText size={44} className="opacity-40" />
              <p className="text-xs">{t('preview.error_load', { defaultValue: 'Impossible d’afficher ce document' })}</p>
              <button
                onClick={handleDownload}
                className="flex items-center gap-1.5 px-3.5 py-2 text-xs bg-white/10 hover:bg-white/20 text-white rounded-full transition-colors"
              >
                <Download size={14} />
                {t('common.download')}
              </button>
            </div>
          )}
          {!loading && !error && doc && baseSize && (
            <div onClick={onBackdropClick} className="flex flex-col items-center gap-4 py-4 px-8 min-w-fit mx-auto">
              {Array.from({ length: numPages }, (_, i) => (
                <PageView
                  key={i + 1}
                  doc={doc}
                  pageNum={i + 1}
                  cssW={Math.round(baseSize.w * effScale)}
                  cssH={Math.round(baseSize.h * effScale)}
                  scale={effScale}
                  highlights={matchesByPage.get(i + 1) ?? []}
                  currentHit={currentHit}
                  registerEl={registerPageEl}
                  commentMode={commentMode}
                  pageComments={showComments ? (commentsByPage.get(i + 1) ?? []) : []}
                  draftRect={draft?.rect ?? null}
                  activeCommentId={openComment?.id ?? null}
                  onDraftCommit={onDraftCommit}
                  onSelectComment={(id, anchor) => { setOpenComment({ id, anchor }); setCommentMode(false); setDraft(null) }}
                  onLinkDest={onLinkDest}
                />
              ))}
            </div>
          )}
        </div>
        <ScrollThumbs target={pagesAreaRef} deps={[effScale, numPages, loading, showThumbs]} />
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
        menus: insertMenu,
        toolsMenu,
        toolbar,
        toolbarOverlay,
        railButtons,
        rail,
        railWidth: railShown ? railWidth : 0,
        onToggleRail: () => setShowThumbs(v => !v),
        railToggled: showThumbs,
        onPrint: handlePrint,
        shortcutSections,
        onKey: onViewerKey,
        onContextMenu: onViewerContextMenu,
        overlays,
      }}
    >
      {renderContent}
    </FilePreviewShell>
  )
}
