import { useState, useEffect, useCallback } from 'react'
import { api, useAuthStore } from '@kubuno/sdk'
import { Button } from '@ui'
import {
  RotateCw,
  RotateCcw,
  FlipHorizontal,
  FlipVertical,
  X,
  Crop,
  Maximize2,
  Download,
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

// Small styled tool button used for rotation / mirror / grayscale toggles.
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
      className={`flex items-center gap-2 rounded-lg border p-2 text-sm transition-colors hover:bg-surface-2 ${
        active
          ? 'bg-primary/10 text-primary border-primary'
          : 'border-border text-text-secondary'
      }`}
    >
      {children}
    </button>
  )
}

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

  const [saving, setSaving] = useState<boolean>(false)
  const [error, setError] = useState<string>('')

  // Load an authenticated preview of the image as an object URL.
  useEffect(() => {
    let url = ''
    const token = useAuthStore.getState().accessToken
    fetch(`/api/v1/drive/${file.id}/download`, {
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-2xl mx-4 p-6 max-h-[90vh] overflow-auto">
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
              className="max-h-64 object-contain"
            />
          ) : (
            <div className="flex h-64 w-full items-center justify-center text-sm text-text-tertiary">
              Chargement de l&apos;aperçu…
            </div>
          )}
        </div>

        {/* Rotation & mirror */}
        <div className="mt-5">
          <p className="mb-2 text-sm font-medium text-text-secondary">
            Orientation
          </p>
          <div className="flex flex-wrap gap-2">
            <ToolButton
              active={rotate !== 0}
              onClick={rotateLeft}
              title="Rotation à gauche (-90°)"
            >
              <RotateCcw size={16} />
              Gauche
            </ToolButton>
            <ToolButton
              active={rotate !== 0}
              onClick={rotateRight}
              title="Rotation à droite (+90°)"
            >
              <RotateCw size={16} />
              Droite
            </ToolButton>
            <ToolButton
              active={flipH}
              onClick={() => setFlipH((v) => !v)}
              title="Miroir horizontal"
            >
              <FlipHorizontal size={16} />
              Miroir H
            </ToolButton>
            <ToolButton
              active={flipV}
              onClick={() => setFlipV((v) => !v)}
              title="Miroir vertical"
            >
              <FlipVertical size={16} />
              Miroir V
            </ToolButton>
            <ToolButton
              active={grayscale}
              onClick={() => setGrayscale((v) => !v)}
              title="Niveaux de gris"
            >
              <Download size={16} />
              Niveaux de gris
            </ToolButton>
          </div>
          {rotate !== 0 && (
            <p className="mt-2 text-xs text-text-tertiary">
              Rotation appliquée : {rotate}°
            </p>
          )}
        </div>

        {/* Resize */}
        <div className="mt-5 rounded-lg border border-border p-3">
          <label className="flex items-center gap-2 text-sm font-medium text-text-secondary">
            <input
              type="checkbox"
              checked={resizeOn}
              onChange={(e) => setResizeOn(e.target.checked)}
            />
            <Maximize2 size={16} className="text-text-tertiary" />
            Redimensionner
          </label>
          {resizeOn && (
            <div className="mt-3 space-y-3">
              <div className="flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1 text-xs text-text-tertiary">
                  Largeur (px)
                  <input
                    type="number"
                    min={1}
                    value={width}
                    onChange={(e) => setWidth(Number(e.target.value))}
                    className="w-28 rounded-lg border border-border bg-surface-1 px-2 py-1 text-sm text-text-primary"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-text-tertiary">
                  Hauteur (px)
                  <input
                    type="number"
                    min={1}
                    value={height}
                    onChange={(e) => setHeight(Number(e.target.value))}
                    className="w-28 rounded-lg border border-border bg-surface-1 px-2 py-1 text-sm text-text-primary"
                  />
                </label>
              </div>
              <label className="flex items-center gap-2 text-sm text-text-secondary">
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

        {/* Crop */}
        <div className="mt-4 rounded-lg border border-border p-3">
          <label className="flex items-center gap-2 text-sm font-medium text-text-secondary">
            <input
              type="checkbox"
              checked={cropOn}
              onChange={(e) => setCropOn(e.target.checked)}
            />
            <Crop size={16} className="text-text-tertiary" />
            Activer le recadrage
          </label>
          {cropOn && (
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-xs text-text-tertiary">
                X
                <input
                  type="number"
                  min={0}
                  value={cropX}
                  onChange={(e) => setCropX(Number(e.target.value))}
                  className="w-24 rounded-lg border border-border bg-surface-1 px-2 py-1 text-sm text-text-primary"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-text-tertiary">
                Y
                <input
                  type="number"
                  min={0}
                  value={cropY}
                  onChange={(e) => setCropY(Number(e.target.value))}
                  className="w-24 rounded-lg border border-border bg-surface-1 px-2 py-1 text-sm text-text-primary"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-text-tertiary">
                Largeur
                <input
                  type="number"
                  min={1}
                  value={cropW}
                  onChange={(e) => setCropW(Number(e.target.value))}
                  className="w-24 rounded-lg border border-border bg-surface-1 px-2 py-1 text-sm text-text-primary"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-text-tertiary">
                Hauteur
                <input
                  type="number"
                  min={1}
                  value={cropH}
                  onChange={(e) => setCropH(Number(e.target.value))}
                  className="w-24 rounded-lg border border-border bg-surface-1 px-2 py-1 text-sm text-text-primary"
                />
              </label>
            </div>
          )}
        </div>

        {/* Output format & quality */}
        <div className="mt-5">
          <p className="mb-2 text-sm font-medium text-text-secondary">
            Format de sortie
          </p>
          <select
            value={format}
            onChange={(e) => setFormat(e.target.value as '' | OutputFormat)}
            className="w-full rounded-lg border border-border bg-surface-1 px-3 py-2 text-sm text-text-primary"
          >
            <option value="">Conserver</option>
            <option value="jpeg">JPEG</option>
            <option value="png">PNG</option>
            <option value="webp">WebP</option>
          </select>
          {showQuality && (
            <div className="mt-3">
              <div className="mb-1 flex items-center justify-between text-xs text-text-tertiary">
                <span>Qualité</span>
                <span className="text-text-secondary">{quality}</span>
              </div>
              <input
                type="range"
                min={1}
                max={100}
                value={quality}
                onChange={(e) => setQuality(Number(e.target.value))}
                className="w-full"
              />
            </div>
          )}
        </div>

        {error && (
          <p className="mt-4 rounded-lg bg-surface-2 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        {/* Actions */}
        <div className="mt-6 flex justify-end gap-3">
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
