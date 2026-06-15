import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { FloatingWindow } from '@ui'
import { ColorPicker, useAppPickerTheme } from '@ui'
import { useFilesPaintStore } from '@kubuno/drive'
import { filesApi } from '@kubuno/drive'
import { useQueryClient } from '@tanstack/react-query'
import { useModulesStore } from '@kubuno/sdk'
import {
  Pencil, Eraser, PaintBucket, Type, Pipette, ZoomIn,
  Minus, Plus, Undo2, Redo2, Save,
  MousePointer, Minus as Line,
  Square, Circle,
  Sparkles, ImagePlus, Wand2, Scissors, ChevronDown,
  Share,
} from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

type Tool = 'select' | 'pencil' | 'fill' | 'text' | 'eyedropper' | 'eraser'
          | 'line' | 'rect' | 'rect-fill' | 'ellipse' | 'ellipse-fill'

type DrawState = {
  drawing: boolean
  startX:  number
  startY:  number
  snapshot: ImageData | null
}

// ── Standard MS Paint colour palette ─────────────────────────────────────────

// Palette MS Paint authentique (rangée vive + rangée pastel, mêmes colonnes).
const PALETTE_VIVID = [
  '#000000','#7f7f7f','#880015','#ed1c24','#ff7f27','#fff200',
  '#22b14c','#00a2e8','#3f48cc','#a349a4','#b83dba',
]
const PALETTE_PASTEL = [
  '#ffffff','#c3c3c3','#b97a57','#ffaec9','#ffc90e','#efe4b0',
  '#b5e61d','#99d9ea','#7092be','#c8bfe7','#e5b8e0',
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function canvasPos(canvas: HTMLCanvasElement, e: React.MouseEvent, zoom: number) {
  const rect = canvas.getBoundingClientRect()
  return {
    x: Math.round((e.clientX - rect.left) / zoom),
    y: Math.round((e.clientY - rect.top)  / zoom),
  }
}

function floodFill(ctx: CanvasRenderingContext2D, sx: number, sy: number, fillColor: string) {
  const w = ctx.canvas.width
  const h = ctx.canvas.height
  const img = ctx.getImageData(0, 0, w, h)
  const data = img.data

  const idx = (sx + sy * w) * 4
  const tr = data[idx], tg = data[idx+1], tb = data[idx+2], ta = data[idx+3]

  const tmp = document.createElement('canvas')
  tmp.width = 1; tmp.height = 1
  const tctx = tmp.getContext('2d')!
  tctx.fillStyle = fillColor
  tctx.fillRect(0, 0, 1, 1)
  const fc = tctx.getImageData(0, 0, 1, 1).data
  const fr = fc[0], fg = fc[1], fb = fc[2], fa = fc[3]

  if (tr === fr && tg === fg && tb === fb && ta === fa) return

  const stack: number[] = [sx + sy * w]
  const visited = new Uint8Array(w * h)

  while (stack.length) {
    const pos = stack.pop()!
    if (visited[pos]) continue
    visited[pos] = 1
    const p = pos * 4
    if (data[p] !== tr || data[p+1] !== tg || data[p+2] !== tb || data[p+3] !== ta) continue
    data[p] = fr; data[p+1] = fg; data[p+2] = fb; data[p+3] = fa

    const x = pos % w, y = Math.floor(pos / w)
    if (x > 0)   stack.push(pos - 1)
    if (x < w-1) stack.push(pos + 1)
    if (y > 0)   stack.push(pos - w)
    if (y < h-1) stack.push(pos + w)
  }

  ctx.putImageData(img, 0, 0)
}

// ── Tool button ───────────────────────────────────────────────────────────────

function ToolBtn({ active, onClick, title, children }: {
  tool?: Tool; active: boolean; onClick: () => void; title: string; children: React.ReactNode
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`w-8 h-8 flex items-center justify-center rounded transition-colors
        ${active ? 'bg-primary/15 border border-primary/40' : 'hover:bg-surface-2 border border-transparent'}`}
    >
      {children}
    </button>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function FilesPaintEditor() {
  const { t } = useTranslation('drive')
  const { open, file, closeEditor } = useFilesPaintStore()
  const qc = useQueryClient()
  // Le groupe « Jarvis » (IA) n'apparaît QUE si le module jarvis est installé et actif.
  // Les actions sont des placeholders pour l'instant (fonctionnalités à venir).
  const jarvisActive = useModulesStore(s => s.activeModules.some(m => m.module_id === 'jarvis'))

  const canvasRef   = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const [tool,     setTool]     = useState<Tool>('pencil')
  const [color1,   setColor1]   = useState('#000000')
  const [color2,   setColor2]   = useState('#ffffff')
  const [which,    setWhich]    = useState<1 | 2>(1)    // which slot is "selected"
  const [brushSz,  setBrushSz]  = useState(3)
  const [zoom,     setZoom]     = useState(1)
  const [saving,   setSaving]   = useState(false)
  const [textInput, setTextInput] = useState('')
  const [textPos,   setTextPos]   = useState<{x:number;y:number}|null>(null)
  const textRef = useRef<HTMLInputElement>(null)
  // ColorPicker @ui — popover propre (z-index AU-DESSUS de la FloatingWindow, qui est
  // à ~1000+, alors que ColorField se limite à z-200 → invisible derrière la fenêtre).
  const pickerTheme = useAppPickerTheme()
  const wheelRef = useRef<HTMLButtonElement>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerPos, setPickerPos]   = useState<{ left: number; top: number } | null>(null)
  const [colorHistory, setColorHistory] = useState<string[]>([])

  // undo/redo
  const historyRef = useRef<ImageData[]>([])
  const hIdxRef    = useRef(-1)
  const [hist, setHist] = useState({ canUndo: false, canRedo: false })
  const syncHist = () => setHist({
    canUndo: hIdxRef.current > 0,
    canRedo: hIdxRef.current < historyRef.current.length - 1,
  })

  const drawState = useRef<DrawState>({ drawing: false, startX: 0, startY: 0, snapshot: null })

  // ── Canvas init & image load ─────────────────────────────────────────────

  useEffect(() => {
    if (!open || !file) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!

    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      canvas.width  = img.naturalWidth
      canvas.height = img.naturalHeight
      ctx.drawImage(img, 0, 0)
      pushHistory(canvas, ctx)
      // fit zoom
      if (containerRef.current) {
        const cw = containerRef.current.clientWidth  - 40
        const ch = containerRef.current.clientHeight - 40
        const zx = cw / img.naturalWidth
        const zy = ch / img.naturalHeight
        setZoom(Math.min(1, Math.min(zx, zy)))
      }
    }
    img.onerror = () => {
      canvas.width = 800; canvas.height = 600
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      pushHistory(canvas, ctx)
    }
    img.src = filesApi.downloadUrl(file.id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, file?.id])

  const pushHistory = (canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) => {
    const snap = ctx.getImageData(0, 0, canvas.width, canvas.height)
    historyRef.current = historyRef.current.slice(0, hIdxRef.current + 1)
    historyRef.current.push(snap)
    if (historyRef.current.length > 30) historyRef.current.shift()
    hIdxRef.current = historyRef.current.length - 1
    syncHist()
  }

  const undo = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return
    const ctx = canvas.getContext('2d')!
    if (hIdxRef.current > 0) {
      hIdxRef.current--
      ctx.putImageData(historyRef.current[hIdxRef.current], 0, 0)
      syncHist()
    }
  }, [])

  const redo = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return
    const ctx = canvas.getContext('2d')!
    if (hIdxRef.current < historyRef.current.length - 1) {
      hIdxRef.current++
      ctx.putImageData(historyRef.current[hIdxRef.current], 0, 0)
      syncHist()
    }
  }, [])

  // ── Keyboard shortcuts ───────────────────────────────────────────────────

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement
      if (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA') return

      if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo() }
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault(); redo() }
      if (e.key === 'p') setTool('pencil')
      if (e.key === 'e') setTool('eraser')
      if (e.key === 'f') setTool('fill')
      if (e.key === 't') setTool('text')
      if (e.key === 'i') setTool('eyedropper')
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, undo, redo])

  // ── Drawing ──────────────────────────────────────────────────────────────

  const activeColor = () => which === 1 ? color1 : color2

  const setupCtx = (ctx: CanvasRenderingContext2D, c?: string) => {
    ctx.lineJoin    = 'round'
    ctx.lineCap     = 'round'
    ctx.strokeStyle = c ?? activeColor()
    ctx.fillStyle   = c ?? activeColor()
    ctx.lineWidth   = brushSz
  }

  const onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current; if (!canvas) return
    const ctx    = canvas.getContext('2d')!
    const pos    = canvasPos(canvas, e, zoom)
    const col    = e.button === 2 ? color2 : color1

    if (tool === 'eyedropper') {
      const px = ctx.getImageData(pos.x, pos.y, 1, 1).data
      const hex = '#' + [px[0],px[1],px[2]].map(v => v.toString(16).padStart(2,'0')).join('')
      if (which === 1) setColor1(hex); else setColor2(hex)
      return
    }

    if (tool === 'fill') {
      pushHistory(canvas, ctx)
      floodFill(ctx, pos.x, pos.y, col)
      pushHistory(canvas, ctx)
      return
    }

    if (tool === 'text') {
      setTextPos(pos)
      setTextInput('')
      setTimeout(() => textRef.current?.focus(), 50)
      return
    }

    drawState.current = {
      drawing:  true,
      startX:   pos.x,
      startY:   pos.y,
      snapshot: ctx.getImageData(0, 0, canvas.width, canvas.height),
    }

    if (tool === 'pencil' || tool === 'eraser') {
      setupCtx(ctx, tool === 'eraser' ? color2 : col)
      ctx.beginPath()
      ctx.moveTo(pos.x, pos.y)
    }
  }

  const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const ds = drawState.current; if (!ds.drawing) return
    const canvas = canvasRef.current; if (!canvas) return
    const ctx    = canvas.getContext('2d')!
    const pos    = canvasPos(canvas, e, zoom)
    const col    = e.buttons === 2 ? color2 : color1

    if (tool === 'pencil' || tool === 'eraser') {
      setupCtx(ctx, tool === 'eraser' ? color2 : col)
      ctx.lineTo(pos.x, pos.y)
      ctx.stroke()
      return
    }

    // Shape preview: restore snapshot then draw
    if (ds.snapshot) ctx.putImageData(ds.snapshot, 0, 0)
    setupCtx(ctx, col)

    const x = Math.min(ds.startX, pos.x), y = Math.min(ds.startY, pos.y)
    const w = Math.abs(pos.x - ds.startX), h = Math.abs(pos.y - ds.startY)

    if (tool === 'line') {
      ctx.beginPath(); ctx.moveTo(ds.startX, ds.startY); ctx.lineTo(pos.x, pos.y); ctx.stroke()
    } else if (tool === 'rect') {
      ctx.strokeRect(x, y, w, h)
    } else if (tool === 'rect-fill') {
      ctx.fillRect(x, y, w, h)
      ctx.strokeRect(x, y, w, h)
    } else if (tool === 'ellipse') {
      ctx.beginPath(); ctx.ellipse(ds.startX + (pos.x-ds.startX)/2, ds.startY + (pos.y-ds.startY)/2, w/2, h/2, 0, 0, Math.PI*2); ctx.stroke()
    } else if (tool === 'ellipse-fill') {
      ctx.beginPath(); ctx.ellipse(ds.startX + (pos.x-ds.startX)/2, ds.startY + (pos.y-ds.startY)/2, w/2, h/2, 0, 0, Math.PI*2); ctx.fill(); ctx.stroke()
    }
  }

  const onMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const ds = drawState.current; if (!ds.drawing) return
    drawState.current.drawing = false
    const canvas = canvasRef.current; if (!canvas) return
    const ctx    = canvas.getContext('2d')!
    const pos    = canvasPos(canvas, e, zoom)

    if (tool === 'pencil' || tool === 'eraser') {
      ctx.closePath()
    } else {
      const col = e.button === 2 ? color2 : color1
      if (ds.snapshot) ctx.putImageData(ds.snapshot, 0, 0)
      setupCtx(ctx, col)
      const x = Math.min(ds.startX, pos.x), y = Math.min(ds.startY, pos.y)
      const w = Math.abs(pos.x - ds.startX), h = Math.abs(pos.y - ds.startY)

      if (tool === 'line') {
        ctx.beginPath(); ctx.moveTo(ds.startX, ds.startY); ctx.lineTo(pos.x, pos.y); ctx.stroke()
      } else if (tool === 'rect') {
        ctx.strokeRect(x, y, w, h)
      } else if (tool === 'rect-fill') {
        ctx.fillRect(x, y, w, h); ctx.strokeRect(x, y, w, h)
      } else if (tool === 'ellipse') {
        ctx.beginPath(); ctx.ellipse(ds.startX + (pos.x-ds.startX)/2, ds.startY + (pos.y-ds.startY)/2, w/2, h/2, 0, 0, Math.PI*2); ctx.stroke()
      } else if (tool === 'ellipse-fill') {
        ctx.beginPath(); ctx.ellipse(ds.startX + (pos.x-ds.startX)/2, ds.startY + (pos.y-ds.startY)/2, w/2, h/2, 0, 0, Math.PI*2); ctx.fill(); ctx.stroke()
      }
    }

    pushHistory(canvas, ctx)
    drawState.current.snapshot = null
  }

  // ── Text commit ──────────────────────────────────────────────────────────

  const commitText = () => {
    if (!textInput || !textPos) { setTextPos(null); return }
    const canvas = canvasRef.current; if (!canvas) return
    const ctx = canvas.getContext('2d')!
    setupCtx(ctx)
    ctx.font = `${brushSz * 6}px sans-serif`
    ctx.fillText(textInput, textPos.x, textPos.y)
    pushHistory(canvas, ctx)
    setTextPos(null)
    setTextInput('')
  }

  // ── Save ─────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    const canvas = canvasRef.current; if (!canvas || !file) return
    setSaving(true)
    try {
      const blob = await new Promise<Blob>((res, rej) =>
        canvas.toBlob(b => b ? res(b) : rej(new Error('toBlob failed')), 'image/png')
      )
      const fd = new FormData()
      fd.append('file', blob, file.name)
      await fetch(`/api/v1/drive/${file.id}/content`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${localStorage.getItem('access_token') ?? ''}` },
        body: fd,
      })
      qc.invalidateQueries({ queryKey: ['files'] })
      closeEditor()
    } catch {
      alert(t('paint.save_error'))
    } finally {
      setSaving(false)
    }
  }

  const handleDownload = () => {
    const canvas = canvasRef.current; if (!canvas) return
    canvas.toBlob(blob => {
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = file?.name ?? 'image.png'; a.click()
      URL.revokeObjectURL(url)
    }, 'image/png')
  }

  const changeZoom = (delta: number) =>
    setZoom(z => Math.max(0.1, Math.min(8, parseFloat((z + delta).toFixed(2)))))

  if (!open || !file) return null

  const cursorMap: Record<Tool, string> = {
    pencil:       'crosshair',
    eraser:       'cell',
    fill:         'cell',
    text:         'text',
    eyedropper:   'crosshair',
    select:       'default',
    line:         'crosshair',
    rect:         'crosshair',
    'rect-fill':  'crosshair',
    ellipse:      'crosshair',
    'ellipse-fill': 'crosshair',
  }

  return (
    <FloatingWindow
      title={`Paint — ${file.name}`}
      onClose={closeEditor}
      defaultWidth={1080}
      defaultHeight={720}
      minWidth={640}
      minHeight={440}
      resizable
    >
      <div className="flex flex-col h-full bg-[#f0f0f0] select-none">

        {/* ── Barre de menus (style Paint Windows 11) ───────────────────────── */}
        <div className="flex items-center gap-0.5 px-2 h-10 bg-white border-b border-[#e5e5e5] shrink-0 text-[13px] text-[#1f1f1f]">
          <PaintMenu label={t('paint.menu_file', { defaultValue: 'Fichier' })} items={[
            { label: t('common.save', { defaultValue: 'Enregistrer' }), shortcut: 'Ctrl+S', onClick: handleSave },
            { label: t('common.download', { defaultValue: 'Télécharger' }), onClick: handleDownload },
            'sep',
            { label: t('common.close', { defaultValue: 'Fermer' }), onClick: closeEditor },
          ]} />
          <PaintMenu label={t('paint.menu_edit', { defaultValue: 'Modifier' })} items={[
            { label: t('paint.undo', { defaultValue: 'Annuler' }), shortcut: 'Ctrl+Z', onClick: undo, disabled: !hist.canUndo },
            { label: t('paint.redo', { defaultValue: 'Rétablir' }), shortcut: 'Ctrl+Y', onClick: redo, disabled: !hist.canRedo },
          ]} />
          <PaintMenu label={t('paint.menu_view', { defaultValue: 'Affichage' })} items={[
            { label: t('paint.zoom_in', { defaultValue: 'Zoom avant' }), onClick: () => changeZoom(0.1) },
            { label: t('paint.zoom_out', { defaultValue: 'Zoom arrière' }), onClick: () => changeZoom(-0.1) },
            { label: t('paint.reset_zoom', { defaultValue: 'Zoom 100 %' }), onClick: () => setZoom(1) },
          ]} />
          <div className="w-px h-5 bg-[#e0e0e0] mx-1.5" />
          <TopIconBtn title={t('common.save', { defaultValue: 'Enregistrer' })} onClick={handleSave} disabled={saving}><Save size={17} /></TopIconBtn>
          <TopIconBtn title={t('common.download', { defaultValue: 'Exporter' })} onClick={handleDownload}><Share size={17} /></TopIconBtn>
          <div className="w-px h-5 bg-[#e0e0e0] mx-1" />
          <TopIconBtn title={t('paint.undo', { defaultValue: 'Annuler' })} onClick={undo} disabled={!hist.canUndo}><Undo2 size={17} /></TopIconBtn>
          <TopIconBtn title={t('paint.redo', { defaultValue: 'Rétablir' })} onClick={redo} disabled={!hist.canRedo}><Redo2 size={17} /></TopIconBtn>
        </div>

        {/* ── Ribbon ────────────────────────────────────────────────────────── */}
        <div className="flex items-stretch gap-0 border-b border-[#c0c0c0] bg-white px-2 py-1 shrink-0 overflow-x-auto">

          {/* Outils */}
          <RibbonGroup label={t('paint.tools')}>
            <ToolBtn tool="pencil"     active={tool==='pencil'}     onClick={() => setTool('pencil')}     title={t('paint.pencil')}><Pencil size={16} /></ToolBtn>
            <ToolBtn tool="fill"       active={tool==='fill'}       onClick={() => setTool('fill')}       title={t('paint.fill')}><PaintBucket size={16} /></ToolBtn>
            <ToolBtn tool="text"       active={tool==='text'}       onClick={() => setTool('text')}       title={t('paint.text')}><Type size={16} /></ToolBtn>
            <ToolBtn tool="eraser"     active={tool==='eraser'}     onClick={() => setTool('eraser')}     title={t('paint.eraser')}><Eraser size={16} /></ToolBtn>
            <ToolBtn tool="eyedropper" active={tool==='eyedropper'} onClick={() => setTool('eyedropper')} title={t('paint.eyedropper')}><Pipette size={16} /></ToolBtn>
            <ToolBtn tool="select"     active={tool==='select'}     onClick={() => setTool('select')}     title={t('paint.select')}><MousePointer size={16} /></ToolBtn>
          </RibbonGroup>

          {/* Formes */}
          <RibbonGroup label={t('paint.shapes')}>
            <ToolBtn tool="line"         active={tool==='line'}         onClick={() => setTool('line')}         title={t('paint.line')}><Line size={16} /></ToolBtn>
            <ToolBtn tool="rect"         active={tool==='rect'}         onClick={() => setTool('rect')}         title={t('paint.rect')}><Square size={16} /></ToolBtn>
            <ToolBtn tool="rect-fill"    active={tool==='rect-fill'}    onClick={() => setTool('rect-fill')}    title={t('paint.rect_fill')}>
              <span className="w-4 h-4 bg-current rounded-sm" />
            </ToolBtn>
            <ToolBtn tool="ellipse"      active={tool==='ellipse'}      onClick={() => setTool('ellipse')}      title={t('paint.ellipse')}><Circle size={16} /></ToolBtn>
            <ToolBtn tool="ellipse-fill" active={tool==='ellipse-fill'} onClick={() => setTool('ellipse-fill')} title={t('paint.ellipse_fill')}>
              <span className="w-4 h-4 bg-current rounded-full" />
            </ToolBtn>
          </RibbonGroup>

          {/* Taille */}
          <RibbonGroup label={t('paint.thickness')}>
            <div className="flex flex-col items-center gap-1 px-1">
              {[1,3,5,8].map(s => (
                <button
                  key={s}
                  title={t('paint.size_px', { n: s })}
                  onClick={() => setBrushSz(s)}
                  className={`flex items-center justify-center w-10 rounded transition-colors
                    ${brushSz === s ? 'bg-primary/15 border border-primary/30' : 'hover:bg-surface-2'}`}
                  style={{ height: `${Math.max(10, s * 3)}px` }}
                >
                  <div
                    className="rounded-full bg-current"
                    style={{ width: `${Math.min(36, s * 4)}px`, height: `${s}px` }}
                  />
                </button>
              ))}
            </div>
          </RibbonGroup>

          {/* Couleurs — palette ronde façon Paint Windows 11 */}
          <RibbonGroup label={t('paint.colors')}>
            {(() => {
              const activeCol = which === 1 ? color1 : color2
              const pickColor = (c: string) => { if (which === 1) setColor1(c); else setColor2(c) }
              return (
                <div className="flex items-center gap-2.5">
                  {/* Indicateurs couleur 1 (primaire, haut) + couleur 2 (secondaire, bas) */}
                  <div className="flex flex-col justify-between self-stretch py-0.5">
                    <button
                      title={t('paint.color1')}
                      onClick={() => setWhich(1)}
                      className={`w-8 h-8 rounded-full border border-[#bdbdbd] transition-shadow
                        ${which === 1 ? 'ring-2 ring-[#1a73e8] ring-offset-1' : ''}`}
                      style={{ background: color1 }}
                    />
                    <button
                      title={t('paint.color2')}
                      onClick={() => setWhich(2)}
                      className={`w-8 h-8 rounded-full border border-[#bdbdbd] transition-shadow
                        ${which === 2 ? 'ring-2 ring-[#1a73e8] ring-offset-1' : ''}`}
                      style={{ background: color2 }}
                    />
                  </div>

                  {/* Grille : rangée vive · rangée pastel · rangée personnalisée (vide) */}
                  <div className="grid grid-cols-11 gap-1.5">
                    {PALETTE_VIVID.map((c, i) => (
                      <button key={'v'+i} title={c} onClick={() => pickColor(c)}
                        className={`w-[22px] h-[22px] rounded-full border transition-transform hover:scale-110
                          ${activeCol.toLowerCase() === c.toLowerCase() ? 'border-[#1a73e8] border-2' : 'border-black/15'}`}
                        style={{ background: c }} />
                    ))}
                    {PALETTE_PASTEL.map((c, i) => (
                      <button key={'p'+i} title={c} onClick={() => pickColor(c)}
                        className={`w-[22px] h-[22px] rounded-full border transition-transform hover:scale-110
                          ${activeCol.toLowerCase() === c.toLowerCase() ? 'border-[#1a73e8] border-2' : 'border-black/15'}`}
                        style={{ background: c }} />
                    ))}
                    {PALETTE_VIVID.map((_, i) => (
                      <span key={'c'+i}
                        className="w-[22px] h-[22px] rounded-full border border-[#d6d6d6] bg-white" />
                    ))}
                  </div>

                  {/* Roue chromatique + → ouvre le ColorPicker @ui (popover haut z-index) */}
                  <div className="relative flex-shrink-0">
                    <button
                      ref={wheelRef}
                      title={t('paint.pick_color')}
                      onClick={() => {
                        const r = wheelRef.current?.getBoundingClientRect()
                        if (r) {
                          const PW = 232, PH = 512, M = 8
                          let left = r.left - PW - M
                          if (left < M) left = r.right + M
                          if (left + PW > window.innerWidth - M) left = window.innerWidth - PW - M
                          if (left < M) left = M
                          let top = r.top
                          if (top + PH > window.innerHeight - M) top = window.innerHeight - PH - M
                          if (top < M) top = M
                          setPickerPos({ left, top })
                        }
                        setPickerOpen(o => !o)
                      }}
                      className="w-8 h-8 rounded-full border border-[#bdbdbd] block"
                      style={{ background: 'conic-gradient(#ff0000,#ffff00,#00ff00,#00ffff,#0000ff,#ff00ff,#ff0000)' }}
                    />
                    <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-white border border-[#bdbdbd] flex items-center justify-center pointer-events-none">
                      <Plus size={9} className="text-[#444]" />
                    </span>
                  </div>

                  {/* Le ColorPicker est porté dans body AVEC un z-index supérieur à la
                      FloatingWindow (≈1000+), sinon il reste caché derrière la fenêtre. */}
                  {pickerOpen && pickerPos && createPortal(
                    <>
                      <div className="fixed inset-0" style={{ zIndex: 99998 }} onPointerDown={() => setPickerOpen(false)} />
                      <div className="fixed" style={{ left: pickerPos.left, top: pickerPos.top, zIndex: 99999 }}>
                        <ColorPicker
                          C={pickerTheme}
                          color={activeCol}
                          history={colorHistory}
                          onPickHistory={pickColor}
                          onChange={pickColor}
                          onClose={() => {
                            setColorHistory(h => [activeCol, ...h.filter(x => x !== activeCol)].slice(0, 12))
                            setPickerOpen(false)
                          }}
                        />
                      </div>
                    </>,
                    document.body,
                  )}
                </div>
              )
            })()}
          </RibbonGroup>

          {/* Jarvis (IA) — uniquement si le module jarvis est actif */}
          {jarvisActive && (
            <RibbonGroup label={t('paint.jarvis', { defaultValue: 'Jarvis' })}>
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <button
                    title={t('paint.jarvis', { defaultValue: 'Jarvis' })}
                    className="h-8 px-1.5 flex items-center gap-0.5 rounded hover:bg-surface-2 border border-transparent transition-colors outline-none"
                  >
                    <Sparkles size={18} className="text-[#7c5cff]" />
                    <ChevronDown size={12} className="text-text-tertiary" />
                  </button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content
                    align="start" sideOffset={4}
                    className="min-w-[230px] bg-white rounded-xl border border-border shadow-xl py-1.5 z-[9999]"
                  >
                    <div className="px-3 pt-1 pb-1 text-[11px] font-semibold text-text-tertiary">
                      {t('paint.jarvis_generate', { defaultValue: 'Générer' })}
                    </div>
                    <JarvisItem icon={<ImagePlus size={17} />} label={t('paint.jarvis_image_creator', { defaultValue: "Créateur d'image" })} onSelect={() => {}} />
                    <div className="px-3 pt-2 pb-1 text-[11px] font-semibold text-text-tertiary">
                      {t('paint.jarvis_modify', { defaultValue: 'Modifier' })}
                    </div>
                    <JarvisItem icon={<Wand2 size={17} />} label={t('paint.jarvis_gen_eraser', { defaultValue: 'Gomme générative' })} onSelect={() => {}} />
                    <JarvisItem icon={<Scissors size={17} />} label={t('paint.jarvis_remove_bg', { defaultValue: "Supprimer l'arrière-plan" })} onSelect={() => {}} />
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            </RibbonGroup>
          )}

        </div>

        {/* ── Canvas area ───────────────────────────────────────────────────── */}
        <div ref={containerRef} className="flex-1 overflow-auto bg-[#888] relative p-5">
          <div
            className="relative inline-block shadow-xl"
            style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }}
          >
            <canvas
              ref={canvasRef}
              style={{ cursor: cursorMap[tool], display: 'block', imageRendering: zoom > 2 ? 'pixelated' : 'auto' }}
              onMouseDown={onMouseDown}
              onMouseMove={onMouseMove}
              onMouseUp={onMouseUp}
              onMouseLeave={onMouseUp}
              onContextMenu={e => { e.preventDefault(); e.stopPropagation() }}
            />
            {/* Text input overlay */}
            {textPos && (
              <input
                ref={textRef}
                value={textInput}
                onChange={e => setTextInput(e.target.value)}
                onBlur={commitText}
                onKeyDown={e => { if (e.key === 'Enter') commitText() }}
                style={{
                  position: 'absolute',
                  left: textPos.x,
                  top:  textPos.y - brushSz * 4,
                  background: 'transparent',
                  border: '1px dashed #1a73e8',
                  outline: 'none',
                  color: color1,
                  fontSize: `${brushSz * 6}px`,
                  fontFamily: 'sans-serif',
                  minWidth: '80px',
                }}
              />
            )}
          </div>
        </div>

        {/* ── Status bar ────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-3 py-0.5 text-xs text-text-secondary
                        border-t border-[#c0c0c0] bg-white shrink-0">
          <span>{canvasRef.current ? `${canvasRef.current.width} × ${canvasRef.current.height} px` : ''}</span>
          <div className="flex items-center gap-2">
            <button onClick={() => changeZoom(-0.1)} className="hover:bg-surface-2 rounded p-0.5"><Minus size={12} /></button>
            <button onClick={() => changeZoom(0.1)}  className="hover:bg-surface-2 rounded p-0.5"><Plus  size={12} /></button>
            <button
              className="hover:bg-surface-2 rounded px-1"
              onClick={() => setZoom(1)}
              title={t('paint.reset_zoom')}
            >
              {Math.round(zoom * 100)} %
            </button>
            <button className="hover:bg-surface-2 rounded p-0.5" onClick={() => setZoom(z => Math.max(0.1, z - 0.25))} title={t('paint.zoom_out')}>
              <ZoomIn size={13} className="rotate-180" />
            </button>
            <input
              type="range" min="10" max="800" value={Math.round(zoom * 100)}
              onChange={e => setZoom(Number(e.target.value) / 100)}
              className="w-20 accent-primary"
            />
            <button className="hover:bg-surface-2 rounded p-0.5" onClick={() => setZoom(z => Math.min(8, z + 0.25))} title={t('paint.zoom_in')}>
              <ZoomIn size={13} />
            </button>
          </div>
        </div>
      </div>
    </FloatingWindow>
  )
}

// ── Ribbon helpers ────────────────────────────────────────────────────────────

function JarvisItem({ icon, label, onSelect }: { icon: React.ReactNode; label: string; onSelect: () => void }) {
  return (
    <DropdownMenu.Item
      onSelect={onSelect}
      className="flex items-center gap-3 px-3 py-2 text-sm text-text-primary hover:bg-surface-1
                 cursor-pointer outline-none data-[highlighted]:bg-surface-1"
    >
      <span className="text-[#7c5cff] flex-shrink-0">{icon}</span>
      {label}
    </DropdownMenu.Item>
  )
}

function RibbonGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center border-r border-[#d0d0d0] px-2 shrink-0">
      <div className="flex items-start gap-1 flex-wrap flex-1">{children}</div>
      <span className="text-[9px] text-text-tertiary mt-0.5 whitespace-nowrap">{label}</span>
    </div>
  )
}

type PaintMenuItem = { label: string; shortcut?: string; onClick: () => void; disabled?: boolean }

// Menu texte de la barre de menus haute (Fichier / Modifier / Affichage), style Paint.
function PaintMenu({ label, items }: { label: string; items: (PaintMenuItem | 'sep')[] }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button className="px-3 h-7 rounded hover:bg-[#f0f0f0] data-[state=open]:bg-[#eaeaea] outline-none transition-colors">
          {label}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="start" sideOffset={2}
          className="min-w-[220px] bg-white rounded-lg border border-border shadow-xl py-1 z-[9999]">
          {items.map((it, i) => it === 'sep' ? (
            <DropdownMenu.Separator key={i} className="my-1 h-px bg-border mx-2" />
          ) : (
            <DropdownMenu.Item key={i} disabled={it.disabled} onSelect={it.onClick}
              className="flex items-center justify-between gap-6 px-3 py-1.5 text-[13px] text-text-primary
                         data-[highlighted]:bg-surface-1 cursor-pointer outline-none
                         data-[disabled]:opacity-40 data-[disabled]:pointer-events-none">
              <span>{it.label}</span>
              {it.shortcut && <span className="text-[11px] text-text-tertiary">{it.shortcut}</span>}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

// Bouton icône de la barre de menus haute (enregistrer, exporter, annuler, rétablir).
function TopIconBtn({ title, onClick, disabled, children }: {
  title: string; onClick: () => void; disabled?: boolean; children: React.ReactNode
}) {
  return (
    <button title={title} onClick={onClick} disabled={disabled}
      className="w-8 h-8 flex items-center justify-center rounded hover:bg-[#f0f0f0] text-[#444]
                 disabled:opacity-30 disabled:hover:bg-transparent transition-colors">
      {children}
    </button>
  )
}
