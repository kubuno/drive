/**
 * The parts of `ImageEditDialog.kbview` still written in React (the codemod could not convert them; see the
 * TODO comments in the view). Each is rendered by a `<ReactHost>` with the values it reads as props.
 */
import { RotateCw, RotateCcw, FlipHorizontal, FlipVertical, Crop, Maximize2, Contrast, ChevronDown } from "lucide-react"
import type { ImageEditDialog } from './ImageEditDialog'

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
export { ToolButton }

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
export { NumField }

export function Part1({ preview, file }: { preview: NonNullable<ImageEditDialog['preview']>; file: NonNullable<ImageEditDialog['props']['file']> }) {
  return (
    <img
                  src={preview}
                  alt={file.name}
                  className="max-h-72 object-contain"
                />
  )
}

export function Part2({ rotateLeft }: { rotateLeft: NonNullable<ImageEditDialog['rotateLeft']> }) {
  return (
    <ToolButton onClick={rotateLeft} title="Rotation à gauche (-90°)">
                <RotateCcw size={16} />
              </ToolButton>
  )
}

export function Part3({ rotateRight }: { rotateRight: NonNullable<ImageEditDialog['rotateRight']> }) {
  return (
    <ToolButton onClick={rotateRight} title="Rotation à droite (+90°)">
                <RotateCw size={16} />
              </ToolButton>
  )
}

export function Part4({ flipH, setFlipH }: { flipH: NonNullable<ImageEditDialog['flipH']>; setFlipH: NonNullable<ImageEditDialog['setFlipH']> }) {
  return (
    <ToolButton
                active={flipH}
                onClick={() => setFlipH((v) => !v)}
                title="Miroir horizontal"
              >
                <FlipHorizontal size={16} />
              </ToolButton>
  )
}

export function Part5({ flipV, setFlipV }: { flipV: NonNullable<ImageEditDialog['flipV']>; setFlipV: NonNullable<ImageEditDialog['setFlipV']> }) {
  return (
    <ToolButton
                active={flipV}
                onClick={() => setFlipV((v) => !v)}
                title="Miroir vertical"
              >
                <FlipVertical size={16} />
              </ToolButton>
  )
}

export function Part6({ grayscale, setGrayscale }: { grayscale: NonNullable<ImageEditDialog['grayscale']>; setGrayscale: NonNullable<ImageEditDialog['setGrayscale']> }) {
  return (
    <ToolButton
                active={grayscale}
                onClick={() => setGrayscale((v) => !v)}
                title="Niveaux de gris"
              >
                <Contrast size={16} />
              </ToolButton>
  )
}

export function Part7({ resizeOn, togglePanel }: { resizeOn: NonNullable<ImageEditDialog['resizeOn']>; togglePanel: ImageEditDialog['togglePanel'] }) {
  return (
    <ToolButton
                  active={resizeOn}
                  onClick={() => togglePanel('resize')}
                  title="Redimensionner"
                >
                  <Maximize2 size={16} />
                  Taille
                  <ChevronDown size={12} className="opacity-60" />
                </ToolButton>
  )
}

export function Part8({ resizeOn, setResizeOn }: { resizeOn: NonNullable<ImageEditDialog['resizeOn']>; setResizeOn: NonNullable<ImageEditDialog['setResizeOn']> }) {
  return (
    <label className="flex items-center gap-2 text-sm font-medium text-text-secondary">
                      <input
                        type="checkbox"
                        checked={resizeOn}
                        onChange={(e) => setResizeOn(e.target.checked)}
                      />
                      Redimensionner
                    </label>
  )
}

export function Part9({ keepAspect, setKeepAspect }: { keepAspect: NonNullable<ImageEditDialog['keepAspect']>; setKeepAspect: NonNullable<ImageEditDialog['setKeepAspect']> }) {
  return (
    <label className="mt-3 flex items-center gap-2 text-sm text-text-secondary">
                      <input
                        type="checkbox"
                        checked={keepAspect}
                        onChange={(e) => setKeepAspect(e.target.checked)}
                      />
                      Conserver les proportions
                    </label>
  )
}

export function Part10({ cropOn, togglePanel }: { cropOn: NonNullable<ImageEditDialog['cropOn']>; togglePanel: ImageEditDialog['togglePanel'] }) {
  return (
    <ToolButton
                  active={cropOn}
                  onClick={() => togglePanel('crop')}
                  title="Recadrer"
                >
                  <Crop size={16} />
                  Recadrer
                  <ChevronDown size={12} className="opacity-60" />
                </ToolButton>
  )
}

export function Part11({ cropOn, setCropOn }: { cropOn: NonNullable<ImageEditDialog['cropOn']>; setCropOn: NonNullable<ImageEditDialog['setCropOn']> }) {
  return (
    <label className="flex items-center gap-2 text-sm font-medium text-text-secondary">
                      <input
                        type="checkbox"
                        checked={cropOn}
                        onChange={(e) => setCropOn(e.target.checked)}
                      />
                      Activer le recadrage
                    </label>
  )
}

export function Part12({ format, togglePanel, formatLabel }: { format: NonNullable<ImageEditDialog['format']>; togglePanel: ImageEditDialog['togglePanel']; formatLabel: NonNullable<ImageEditDialog['formatLabel']> }) {
  return (
    <ToolButton
                  active={format !== ''}
                  onClick={() => togglePanel('format')}
                  title="Format de sortie"
                >
                  {formatLabel}
                  <ChevronDown size={12} className="opacity-60" />
                </ToolButton>
  )
}

export function Part13({ format, setFormat }: { format: NonNullable<ImageEditDialog['format']>; setFormat: NonNullable<ImageEditDialog['setFormat']> }) {
  return (
    <>{([['', 'Conserver'], ['jpeg', 'JPEG'], ['png', 'PNG'], ['webp', 'WebP']] as const).map(([val, label]) => (
                      <label key={val} className="flex items-center gap-2 py-1 text-xs text-text-secondary cursor-pointer">
                        <input
                          type="radio"
                          name="img-format"
                          checked={format === val}
                          onChange={() => setFormat(val)}
                        />
                        {label}
                      </label>
                    ))}</>
  )
}
