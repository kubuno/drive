/**
 * Code-behind of `ImageEditDialog.kbview` (converted from `ImageEditDialog.tsx` by @kubuno/views-migrate).
 */
import { bind, type MouseEventArgs } from '@kubuno/views'
import { useEffect, useCallback } from "react"
import { api, useAuthStore } from "@kubuno/sdk"

import { ViewBase } from './ImageEditDialog.kbview'
import * as __parts from './ImageEditDialog.parts'

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

type PanelId = 'resize' | 'crop' | 'format'

export type { Props }

export class ImageEditDialog extends ViewBase {
  @bind accessor preview: string = ''
  @bind accessor rotate: number = 0
  @bind accessor flipH: boolean = false
  @bind accessor flipV: boolean = false
  @bind accessor grayscale: boolean = false
  @bind accessor resizeOn: boolean = false
  @bind accessor width: number = 800
  @bind accessor height: number = 600
  @bind accessor keepAspect: boolean = true
  @bind accessor cropOn: boolean = false
  @bind accessor cropX: number = 0
  @bind accessor cropY: number = 0
  @bind accessor cropW: number = 100
  @bind accessor cropH: number = 100
  @bind accessor format: '' | OutputFormat = ''
  @bind accessor quality: number = 85
  @bind accessor panel: PanelId | null = null
  @bind accessor saving: boolean = false
  @bind accessor error: string = ''
  rotateLeft!: () => void
  rotateRight!: () => void
  handleApply!: () => Promise<void>

  /** The screen's hooks that read its members (run after the fields of `useStores()` are set). React's rules apply: `use()` runs them on every render. */
  useHooks() {
    useEffect(() => {
      let url = ''
      const token = useAuthStore.getState().accessToken
      fetch(`/api/v1/drive/${this.props.file.id}/download?inline=1`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((r) => r.blob())
        .then((b) => {
          url = URL.createObjectURL(b)
          this.preview = url
        })
        .catch(() => {})
      return () => {
        if (url) URL.revokeObjectURL(url)
      }
    }, [this.props.file.id])
    const rotateLeft = useCallback(() => {
      this.rotate = (this.rotate + 270) % 360
    }, [])
    this.publish({ rotateLeft })
    const rotateRight = useCallback(() => {
      this.rotate = (this.rotate + 90) % 360
    }, [])
    this.publish({ rotateRight })
    const handleApply = useCallback(async () => {
      this.error = ''
      this.saving = true
      const body: TransformBody = {}
      if (this.rotate) body.rotate = this.rotate
      if (this.flipH) body.flip_h = true
      if (this.flipV) body.flip_v = true
      if (this.grayscale) body.grayscale = true
      if (this.resizeOn) body.resize = { width: this.width, height: this.height, keep_aspect: this.keepAspect }
      if (this.cropOn) body.crop = { x: this.cropX, y: this.cropY, width: this.cropW, height: this.cropH }
      if (this.format) body.format = this.format
      if (this.format === 'jpeg' || this.isJpegSource) body.quality = this.quality
      try {
        await api.post(`/drive/${this.props.file.id}/transform`, body)
        this.props.onSaved()
        this.props.onClose()
      } catch (err) {
        this.error = (err as { response?: { data?: { message?: string } } })?.response?.data
            ?.message ?? 'Échec de la transformation'
      } finally {
        this.saving = false
      }
    }, [
      this.rotate,
      this.flipH,
      this.flipV,
      this.grayscale,
      this.resizeOn,
      this.width,
      this.height,
      this.keepAspect,
      this.cropOn,
      this.cropX,
      this.cropY,
      this.cropW,
      this.cropH,
      this.format,
      this.quality,
      this.isJpegSource,
      this.props.file.id,
      this.props.onSaved,
      this.props.onClose,
    ])
    this.publish({ handleApply })
    return { rotateLeft, rotateRight, handleApply }
  }

  /** Runs the hooks and publishes what they give as fields (the bindings, the getters and the methods read them). */
  use(): void {
    const h = this.useHooks()
    this.publish({ rotateLeft: h.rotateLeft, rotateRight: h.rotateRight, handleApply: h.handleApply })
  }

  get isJpegSource(): boolean {
    return this.props.file.mime_type === 'image/jpeg'
  }

  get showQuality(): boolean {
    return this.format === 'jpeg' || this.isJpegSource
  }

  get formatLabel(): string {
    return this.format === '' ? 'Conserver' : this.format.toUpperCase()
  }

  get panelCls(): "absolute left-0 top-full mt-1 z-20 w-64 rounded-lg border border-border bg-white shadow-xl p-3" {
    return 'absolute left-0 top-full mt-1 z-20 w-64 rounded-lg border border-border bg-white shadow-xl p-3'
  }

  get show_preview() {
    return !!(this.preview)
  }

  get show_not_preview() {
    return !(this.preview)
  }

  get part1_props() {
    return this.memo('part1_props', [this.preview, this.props], () => {
      if (!(this.preview)) return undefined as never
      return ({ preview: this.preview, file: this.props.file })
    })
  }

  /** A part of the screen still written in React (<img> has no .kbview element yet). */
  get Part1() {
    if (!(this.preview)) return undefined as never
    return __parts.Part1
  }

  get show_panel() {
    return !!(this.panel)
  }

  get part2_props() {
    return this.memo('part2_props', [this.rotateLeft], () => ({ rotateLeft: this.rotateLeft }))
  }

  /** A part of the screen still written in React (<ToolButton> is no .kbview element (a local or dynamic component)). */
  get Part2() {
    return __parts.Part2
  }

  get part3_props() {
    return this.memo('part3_props', [this.rotateRight], () => ({ rotateRight: this.rotateRight }))
  }

  /** A part of the screen still written in React (<ToolButton> is no .kbview element (a local or dynamic component)). */
  get Part3() {
    return __parts.Part3
  }

  get part4_props() {
    return this.memo('part4_props', [this.flipH, this.memo], () => ({ flipH: this.flipH, setFlipH: this.memo("setFlipH:bound", [], () => this.setFlipH.bind(this)) }))
  }

  /** A part of the screen still written in React (<ToolButton> is no .kbview element (a local or dynamic component)). */
  get Part4() {
    return __parts.Part4
  }

  get part5_props() {
    return this.memo('part5_props', [this.flipV, this.memo], () => ({ flipV: this.flipV, setFlipV: this.memo("setFlipV:bound", [], () => this.setFlipV.bind(this)) }))
  }

  /** A part of the screen still written in React (<ToolButton> is no .kbview element (a local or dynamic component)). */
  get Part5() {
    return __parts.Part5
  }

  get part6_props() {
    return this.memo('part6_props', [this.grayscale, this.memo], () => ({ grayscale: this.grayscale, setGrayscale: this.memo("setGrayscale:bound", [], () => this.setGrayscale.bind(this)) }))
  }

  /** A part of the screen still written in React (<ToolButton> is no .kbview element (a local or dynamic component)). */
  get Part6() {
    return __parts.Part6
  }

  get part7_props() {
    return this.memo('part7_props', [this.resizeOn, this.memo, this.panel], () => ({ resizeOn: this.resizeOn, togglePanel: this.memo("togglePanel:bound", [], () => this.togglePanel.bind(this)) }))
  }

  /** A part of the screen still written in React (<ToolButton> is no .kbview element (a local or dynamic component)). */
  get Part7() {
    return __parts.Part7
  }

  get show_panel_resize() {
    return this.panel === 'resize'
  }

  get part8_props() {
    return this.memo('part8_props', [this.resizeOn, this.memo, this.panel], () => {
      if (!(this.panel === 'resize')) return undefined as never
      return ({ resizeOn: this.resizeOn, setResizeOn: this.memo("setResizeOn:bound", [], () => this.setResizeOn.bind(this)) })
    })
  }

  /** A part of the screen still written in React (<input> has no .kbview element yet). */
  get Part8() {
    if (!(this.panel === 'resize')) return undefined as never
    return __parts.Part8
  }

  /** `<NumField>`, rendered by a ReactHost. */
  get NumField() {
    if (!(this.panel === 'resize')) return undefined as never
    return __parts.NumField
  }

  get num_field_props() {
    return this.memo('num_field_props', [this.width, this.resizeOn, this.panel], () => {
      if (!(this.panel === 'resize')) return undefined as never
      return ({ label: "Largeur (px)", min: 1, value: this.width, onChange: (v) => { this.width = v; this.resizeOn = true } } as React.ComponentProps<typeof __parts.NumField>)
    })
  }

  get num_field_props2() {
    return this.memo('num_field_props2', [this.height, this.resizeOn, this.panel], () => {
      if (!(this.panel === 'resize')) return undefined as never
      return ({ label: "Hauteur (px)", min: 1, value: this.height, onChange: (v) => { this.height = v; this.resizeOn = true } } as React.ComponentProps<typeof __parts.NumField>)
    })
  }

  get part9_props() {
    return this.memo('part9_props', [this.keepAspect, this.memo, this.panel], () => {
      if (!(this.panel === 'resize')) return undefined as never
      return ({ keepAspect: this.keepAspect, setKeepAspect: this.memo("setKeepAspect:bound", [], () => this.setKeepAspect.bind(this)) })
    })
  }

  /** A part of the screen still written in React (<input> has no .kbview element yet). */
  get Part9() {
    if (!(this.panel === 'resize')) return undefined as never
    return __parts.Part9
  }

  get part10_props() {
    return this.memo('part10_props', [this.cropOn, this.memo, this.panel], () => ({ cropOn: this.cropOn, togglePanel: this.memo("togglePanel:bound", [], () => this.togglePanel.bind(this)) }))
  }

  /** A part of the screen still written in React (<ToolButton> is no .kbview element (a local or dynamic component)). */
  get Part10() {
    return __parts.Part10
  }

  get show_panel_crop() {
    return this.panel === 'crop'
  }

  get part11_props() {
    return this.memo('part11_props', [this.cropOn, this.memo, this.panel], () => {
      if (!(this.panel === 'crop')) return undefined as never
      return ({ cropOn: this.cropOn, setCropOn: this.memo("setCropOn:bound", [], () => this.setCropOn.bind(this)) })
    })
  }

  /** A part of the screen still written in React (<input> has no .kbview element yet). */
  get Part11() {
    if (!(this.panel === 'crop')) return undefined as never
    return __parts.Part11
  }

  /** `<NumField>`, rendered by a ReactHost. */
  get NumField2() {
    if (!(this.panel === 'crop')) return undefined as never
    return __parts.NumField
  }

  get num_field_props3() {
    return this.memo('num_field_props3', [this.cropX, this.cropOn, this.panel], () => {
      if (!(this.panel === 'crop')) return undefined as never
      return ({ label: "X", min: 0, value: this.cropX, onChange: (v) => { this.cropX = v; this.cropOn = true } } as React.ComponentProps<typeof __parts.NumField>)
    })
  }

  get num_field_props4() {
    return this.memo('num_field_props4', [this.cropY, this.cropOn, this.panel], () => {
      if (!(this.panel === 'crop')) return undefined as never
      return ({ label: "Y", min: 0, value: this.cropY, onChange: (v) => { this.cropY = v; this.cropOn = true } } as React.ComponentProps<typeof __parts.NumField>)
    })
  }

  get num_field_props5() {
    return this.memo('num_field_props5', [this.cropW, this.cropOn, this.panel], () => {
      if (!(this.panel === 'crop')) return undefined as never
      return ({ label: "Largeur", min: 1, value: this.cropW, onChange: (v) => { this.cropW = v; this.cropOn = true } } as React.ComponentProps<typeof __parts.NumField>)
    })
  }

  get num_field_props6() {
    return this.memo('num_field_props6', [this.cropH, this.cropOn, this.panel], () => {
      if (!(this.panel === 'crop')) return undefined as never
      return ({ label: "Hauteur", min: 1, value: this.cropH, onChange: (v) => { this.cropH = v; this.cropOn = true } } as React.ComponentProps<typeof __parts.NumField>)
    })
  }

  get part12_props() {
    return this.memo('part12_props', [this.format, this.memo, this.panel, this.formatLabel], () => ({ format: this.format, togglePanel: this.memo("togglePanel:bound", [], () => this.togglePanel.bind(this)), formatLabel: this.formatLabel }))
  }

  /** A part of the screen still written in React (<ToolButton> is no .kbview element (a local or dynamic component)). */
  get Part12() {
    return __parts.Part12
  }

  get show_panel_format() {
    return this.panel === 'format'
  }

  get part13_props() {
    return this.memo('part13_props', [this.format, this.memo, this.panel], () => {
      if (!(this.panel === 'format')) return undefined as never
      return ({ format: this.format, setFormat: this.memo("setFormat:bound", [], () => this.setFormat.bind(this)) })
    })
  }

  /** A part of the screen still written in React (a list callback destructuring its item). */
  get Part13() {
    if (!(this.panel === 'format')) return undefined as never
    return __parts.Part13
  }

  get show_rotate() {
    return this.rotate !== 0
  }

  get span_text() {
    return this.memo('span_text', [this.rotate], () => {
      if (!(this.rotate !== 0)) return undefined as never
      return String(this.rotate) + "°"
    })
  }

  get show_error() {
    return !!(this.error)
  }

  get enabled_unless_saving() {
    return !(this.saving)
  }

  togglePanel(id: PanelId) {
    this.panel = (this.panel === id ? null : id)
  }

  panel_click(_sender: unknown, _args: MouseEventArgs) {
    this.props.onClose?.()
  }

  panel_click2(_sender: unknown, _args: MouseEventArgs) {
    this.props.onClose?.()
  }

  panel_click3(_sender: unknown, _args: MouseEventArgs) {
    if (!(this.panel)) return undefined as never
    this.panel = null
  }

  button_click(_sender: unknown, _args: MouseEventArgs) {
    this.props.onClose?.()
  }

  button_click2(_sender: unknown, _args: MouseEventArgs) {
    this.handleApply()
  }

  /** `setFlipH` of the TSX: a value, or an update of the previous one. */
  setFlipH(value: boolean | ((prev: boolean) => boolean)) {
    this.flipH = typeof value === 'function' ? (value as (prev: boolean) => boolean)(this.flipH) : value
  }

  /** `setFlipV` of the TSX: a value, or an update of the previous one. */
  setFlipV(value: boolean | ((prev: boolean) => boolean)) {
    this.flipV = typeof value === 'function' ? (value as (prev: boolean) => boolean)(this.flipV) : value
  }

  /** `setGrayscale` of the TSX: a value, or an update of the previous one. */
  setGrayscale(value: boolean | ((prev: boolean) => boolean)) {
    this.grayscale = typeof value === 'function' ? (value as (prev: boolean) => boolean)(this.grayscale) : value
  }

  /** `setResizeOn` of the TSX: a value, or an update of the previous one. */
  setResizeOn(value: boolean | ((prev: boolean) => boolean)) {
    this.resizeOn = typeof value === 'function' ? (value as (prev: boolean) => boolean)(this.resizeOn) : value
  }

  /** `setKeepAspect` of the TSX: a value, or an update of the previous one. */
  setKeepAspect(value: boolean | ((prev: boolean) => boolean)) {
    this.keepAspect = typeof value === 'function' ? (value as (prev: boolean) => boolean)(this.keepAspect) : value
  }

  /** `setCropOn` of the TSX: a value, or an update of the previous one. */
  setCropOn(value: boolean | ((prev: boolean) => boolean)) {
    this.cropOn = typeof value === 'function' ? (value as (prev: boolean) => boolean)(this.cropOn) : value
  }

  /** `setFormat` of the TSX: a value, or an update of the previous one. */
  setFormat(value: '' | OutputFormat | ((prev: '' | OutputFormat) => '' | OutputFormat)) {
    this.format = typeof value === 'function' ? (value as (prev: '' | OutputFormat) => '' | OutputFormat)(this.format) : value
  }

}

/** What `useHooks()` gives (the types of the fields it fills). */
export type ImageEditDialogHooks = ReturnType<ImageEditDialog['useHooks']>

export default ImageEditDialog.component()
