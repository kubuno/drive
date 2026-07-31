import { useState, useEffect, useCallback } from 'react'
import { api, useAuthStore } from '@kubuno/sdk'
import { Button, RangeSlider } from '@ui'
import {
  RotateCw,
  RotateCcw,
  FlipHorizontal,
  FlipVertical,
  X,
  Crop,
  Maximize2,
  Contrast,
  ChevronDown,
  Image as ImageIcon,
} from 'lucide-react'

interface Props {
  file: { id: string; name: string; mime_type: string }
  onClose: () => void
  onSaved: () => void
}

type OutputFormat = 'jpeg' | 'png' | 'webp'

interface ResizePayload {
  width: number
  height: number
  keep_aspect: boolean
}

interface CropPayload {
  x: number
  y: number
  width: number
  height: number
}

interface TransformBody {
  rotate?: number
  flip_h?: boolean
  flip_v?: boolean
  grayscale?: boolean
  resize?: ResizePayload
  crop?: CropPayload
  format?: OutputFormat
  quality?: number
}

// Small styled tool button used in the compact toolbar (icon-only or icon+label).
function ToolButton({
  active,
  onClick,
  title,
  children,
}: {
  active?: boolean
  onClick: () => void
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-lg border p-2 text-sm transition-colors hover:bg-surface-2 ${
        active
          ? 'bg-primary/10 text-primary border-primary'
          : 'border-border text-text-secondary'
      }`}
    >
      {children}
    </button>
  )
}

// Compact labelled number input used inside the dropdown panels.
function NumField({
  label,
  min,
  value,
  onChange,
}: {
  label: string
  min: number
  value: number
  onChange: (v: number) => void
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-text-tertiary">
      {label}
      <input
        type="number"
        min={min}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-24 rounded-lg border border-border bg-surface-1 px-2 py-1 text-sm text-text-primary"
      />
    </label>
  )
}

type PanelId = 'resize' | 'crop' | 'format'

export default function ImageEditDialog({ file, onClose, onSaved }: Props) {
  const [preview, setPreview] = useState<string>('')

  // Transform state.
  const [rotate, setRotate] = useState<number>(0)
  const [flipH, setFlipH] = useState<boolean>(false)
  const [flipV, setFlipV] = useState<boolean>(false)
  const [grayscale, setGrayscale] = useState<boolean>(false)

  const [resizeOn, setResizeOn] = useState<boolean>(false)
  const [width, setWidth] = useState<number>(800)
  const [height, setHeight] = useState<number>(600)
  const [keepAspect, setKeepAspect] = useState<boolean>(true)

  const [cropOn, setCropOn] = useState<boolean>(false)
  const [cropX, setCropX] = useState<number>(0)
  const [cropY, setCropY] = useState<number>(0)
  const [cropW, setCropW] = useState<number>(100)
  const [cropH, setCropH] = useState<number>(100)

  const [format, setFormat] = useState<'' | OutputFormat>('')
  const [quality, setQuality] = useState<number>(85)

  // Which dropdown panel is open (the toolbar stays on a single line; the
  // detailed controls live in these small anchored panels).
  const [panel, setPanel] = useState<PanelId | null>(null)
  const togglePanel = (id: PanelId) => setPanel((p) => (p === id ? null : id))

  const [saving, setSaving] = useState<boolean>(false)
  const [error, setError] = useState<string>('')

  // Load an authenticated preview of the image as an object URL.
  useEffect(() => {
    let url = ''
    const token = useAuthStore.getState().accessToken
    fetch(`/api/v1/drive/${file.id}/download?inline=1`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.blob())
      .then((b) => {
        url = URL.createObjectURL(b)
        setPreview(url)
      })
      .catch(() => {})
    return () => {
      if (url) URL.revokeObjectURL(url)
    }
  }, [file.id])

  const rotateLeft = useCallback(() => {
    setRotate((r) => (r + 270) % 360)
  }, [])

  const rotateRight = useCallback(() => {
    setRotate((r) => (r + 90) % 360)
  }, [])

  const isJpegSource = file.mime_type === 'image/jpeg'
  const showQuality = format === 'jpeg' || isJpegSource

  const handleApply = useCallback(async () => {
    setError('')
    setSaving(true)
    const body: TransformBody = {}
    if (rotate) body.rotate = rotate
    if (flipH) body.flip_h = true
    if (flipV) body.flip_v = true
    if (grayscale) body.grayscale = true
    if (resizeOn) body.resize = { width, height, keep_aspect: keepAspect }
    if (cropOn) body.crop = { x: cropX, y: cropY, width: cropW, height: cropH }
    if (format) body.format = format
    if (format === 'jpeg' || isJpegSource) body.quality = quality
    try {
      await api.post(`/drive/${file.id}/transform`, body)
      onSaved()
      onClose()
    } catch (err) {
      setError(
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? 'Échec de la transformation',
      )
    } finally {
      setSaving(false)
    }
  }, [
    rotate,
    flipH,
    flipV,
    grayscale,
    resizeOn,
    width,
    height,
    keepAspect,
    cropOn,
    cropX,
    cropY,
    cropW,
    cropH,
    format,
    quality,
    isJpegSource,
    file.id,
    onSaved,
    onClose,
  ])

  const formatLabel = format === '' ? 'Conserver' : format.toUpperCase()
  const panelCls =
    'absolute left-0 top-full mt-1 z-20 w-64 rounded-lg border border-border bg-white shadow-xl p-3'

  return (
    // z-[60]: must sit ABOVE the fullscreen previewer (z-50).
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-2xl mx-4 p-6 max-h-[90vh] overflow-visible">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <ImageIcon size={20} />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-text-primary">
                Modifier l&apos;image
              </h2>
              <p className="text-sm text-text-tertiary truncate max-w-[20rem]">
                {file.name}
              </p>
            </div>
          </div>
          <button
            type="button"
            title="Fermer"
            onClick={onClose}
            className="rounded-lg p-2 text-text-tertiary transition-colors hover:bg-surface-2 hover:text-text-secondary"
          >
            <X size={18} />
          </button>
        </div>

        {/* Preview */}
        <div className="mt-4 flex items-center justify-center rounded-lg border border-border bg-surface-1 p-3">
          {preview ? (
            <img
              src={preview}
              alt={file.name}
              className="max-h-72 object-contain"
            />
          ) : (
            <div className="flex h-72 w-full items-center justify-center text-sm text-text-tertiary">
              Chargement de l&apos;aperçu…
            </div>
          )}
        </div>

        {/* Click-away layer for the dropdown panels */}
        {panel && (
          <div className="fixed inset-0 z-10" onClick={() => setPanel(null)} />
        )}

        {/* Compact toolbar — every control on ONE line; the detailed options
            (dimensions, crop box, format/quality) open in dropdown panels.
            z-20 keeps the buttons clickable above the click-away layer so a
            click on another dropdown switches panels directly. */}
        <div className="relative z-20 mt-4 flex items-center gap-1.5">
          <ToolButton onClick={rotateLeft} title="Rotation à gauche (-90°)">
            <RotateCcw size={16} />
          </ToolButton>
          <ToolButton onClick={rotateRight} title="Rotation à droite (+90°)">
            <RotateCw size={16} />
          </ToolButton>
          <ToolButton
            active={flipH}
            onClick={() => setFlipH((v) => !v)}
            title="Miroir horizontal"
          >
            <FlipHorizontal size={16} />
          </ToolButton>
          <ToolButton
            active={flipV}
            onClick={() => setFlipV((v) => !v)}
            title="Miroir vertical"
          >
            <FlipVertical size={16} />
          </ToolButton>
          <ToolButton
            active={grayscale}
            onClick={() => setGrayscale((v) => !v)}
            title="Niveaux de gris"
          >
            <Contrast size={16} />
          </ToolButton>

          <div className="mx-1 h-6 w-px bg-border" />

          {/* Resize (dropdown) */}
          <div className="relative">
            <ToolButton
              active={resizeOn}
              onClick={() => togglePanel('resize')}
              title="Redimensionner"
            >
              <Maximize2 size={16} />
              Taille
              <ChevronDown size={12} className="opacity-60" />
            </ToolButton>
            {panel === 'resize' && (
              <div className={panelCls}>
                <label className="flex items-center gap-2 text-sm font-medium text-text-secondary">
                  <input
                    type="checkbox"
                    checked={resizeOn}
                    onChange={(e) => setResizeOn(e.target.checked)}
                  />
                  Redimensionner
                </label>
                <div className="mt-3 flex items-end gap-3">
                  <NumField label="Largeur (px)" min={1} value={width}
                    onChange={(v) => { setWidth(v); setResizeOn(true) }} />
                  <NumField label="Hauteur (px)" min={1} value={height}
                    onChange={(v) => { setHeight(v); setResizeOn(true) }} />
                </div>
                <label className="mt-3 flex items-center gap-2 text-sm text-text-secondary">
                  <input
                    type="checkbox"
                    checked={keepAspect}
                    onChange={(e) => setKeepAspect(e.target.checked)}
                  />
                  Conserver les proportions
                </label>
              </div>
            )}
          </div>

          {/* Crop (dropdown) */}
          <div className="relative">
            <ToolButton
              active={cropOn}
              onClick={() => togglePanel('crop')}
              title="Recadrer"
            >
              <Crop size={16} />
              Recadrer
              <ChevronDown size={12} className="opacity-60" />
            </ToolButton>
            {panel === 'crop' && (
              <div className={panelCls}>
                <label className="flex items-center gap-2 text-sm font-medium text-text-secondary">
                  <input
                    type="checkbox"
                    checked={cropOn}
                    onChange={(e) => setCropOn(e.target.checked)}
                  />
                  Activer le recadrage
                </label>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <NumField label="X" min={0} value={cropX}
                    onChange={(v) => { setCropX(v); setCropOn(true) }} />
                  <NumField label="Y" min={0} value={cropY}
                    onChange={(v) => { setCropY(v); setCropOn(true) }} />
                  <NumField label="Largeur" min={1} value={cropW}
                    onChange={(v) => { setCropW(v); setCropOn(true) }} />
                  <NumField label="Hauteur" min={1} value={cropH}
                    onChange={(v) => { setCropH(v); setCropOn(true) }} />
                </div>
              </div>
            )}
          </div>

          <div className="mx-1 h-6 w-px bg-border" />

          {/* Output format & quality (dropdown) */}
          <div className="relative">
            <ToolButton
              active={format !== ''}
              onClick={() => togglePanel('format')}
              title="Format de sortie"
            >
              {formatLabel}
              <ChevronDown size={12} className="opacity-60" />
            </ToolButton>
            {panel === 'format' && (
              <div className={panelCls}>
                <p className="mb-2 text-sm font-medium text-text-secondary">
                  Format de sortie
                </p>
                {([['', 'Conserver'], ['jpeg', 'JPEG'], ['png', 'PNG'], ['webp', 'WebP']] as const).map(([val, label]) => (
                  <label key={val} className="flex items-center gap-2 py-1 text-xs text-text-secondary cursor-pointer">
                    <input
                      type="radio"
                      name="img-format"
                      checked={format === val}
                      onChange={() => setFormat(val)}
                    />
                    {label}
                  </label>
                ))}
                {showQuality && (
                  <div className="mt-3 border-t border-border pt-3">
                    <div className="mb-1 flex items-center justify-between text-xs text-text-tertiary">
                      <span>Qualité</span>
                      <span className="text-text-secondary">{quality}</span>
                    </div>
                    <RangeSlider
                      min={1}
                      max={100}
                      value={quality}
                      onChange={(v) => setQuality(v)}
                      className="w-full"
                      aria-label="Qualité"
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          {rotate !== 0 && (
            <span className="ml-auto text-xs text-text-tertiary">{rotate}°</span>
          )}
        </div>

        {error && (
          <p className="mt-4 rounded-lg bg-surface-2 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        {/* Actions */}
        <div className="mt-5 flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Annuler
          </Button>
          <Button onClick={handleApply} loading={saving}>
            Appliquer
          </Button>
        </div>
      </div>
    </div>
  )
}
