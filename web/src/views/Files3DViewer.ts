/**
 * Code-behind of `Files3DViewer.kbview` (converted from `Files3DViewer.tsx` by @kubuno/views-migrate).
 */
import { bind, type MouseEventArgs } from '@kubuno/views'
import { useState, useEffect } from "react"
import { useTranslation } from "react-i18next"
import type { FileItem } from "@kubuno/drive"
import { fetchFileBuffer } from "../services/externalPreview"

import { ViewBase } from './Files3DViewer.kbview'
import * as __parts from './Files3DViewer.parts.tsx'

const MODEL_EXTENSIONS = ['glb', 'gltf', 'obj', 'stl', 'ply']

const MODEL_MIMES = ['model/gltf-binary', 'model/gltf+json', 'model/obj', 'model/stl', 'model/ply']

export function is3dFile(file: FileItem): boolean {
  if (MODEL_MIMES.includes(file.mime_type)) return true
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  return MODEL_EXTENSIONS.includes(ext)
}

function getFormat(file: FileItem): 'glb' | 'gltf' | 'obj' | 'stl' | 'ply' | null {
  const mime = file.mime_type
  const ext  = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (mime === 'model/gltf-binary' || ext === 'glb')  return 'glb'
  if (mime === 'model/gltf+json'   || ext === 'gltf') return 'gltf'
  if (mime === 'model/obj'         || ext === 'obj')  return 'obj'
  if (mime === 'model/stl'         || ext === 'stl')  return 'stl'
  if (mime === 'model/ply'         || ext === 'ply')  return 'ply'
  return null
}

function useFileData(file: FileItem) {
  const [data,    setData]    = useState<ArrayBuffer | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setData(null)

    fetchFileBuffer(file)
      .then(buf => {
        if (!cancelled) setData(buf)
      })
      .catch(() => {
        if (!cancelled) setError('Impossible de charger le fichier 3D.')
      })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.id])

  return { data, loading, error }
}

export type Files3DViewerProps = { file: FileItem; onClose: () => void }

export class Files3DViewer extends ViewBase {
  @bind accessor autoRotate = false
  @bind accessor modelError = false
  tr!: Files3DViewerStores['t']
  data!: Files3DViewerHooks['data']
  loading!: boolean
  error!: string | null

  /** The screen's hooks that read nothing of the view (stores, translations…), as the TSX called them. React's rules apply: `use()` runs them on every render. */
  useStores() {
    const { t } = useTranslation('drive')
    return { t }
  }

  /** The screen's hooks that read its members (run after the fields of `useStores()` are set). React's rules apply: `use()` runs them on every render. */
  useHooks() {
    const { data, loading, error } = useFileData(this.props.file)
    this.publish({ data, loading, error })
    useEffect(() => {
      const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') this.props.onClose() }
      window.addEventListener('keydown', handler)
      return () => window.removeEventListener('keydown', handler)
    }, [this.props.onClose])
    return { data, loading, error }
  }

  /** Runs the hooks and publishes what they give as fields (the bindings, the getters and the methods read them). */
  use(): void {
    const s = this.useStores()
    this.publish({ tr: s.t })
    const h = this.useHooks()
    this.publish({ data: h.data, loading: h.loading, error: h.error })
  }

  get format(): "glb" | "gltf" | "obj" | "stl" | "ply" | null {
    return getFormat(this.props.file)
  }

  get ext(): string {
    return this.props.file.name.split('.').pop()?.toUpperCase() ?? '3D'
  }

  get button_class() {
    return `px-3 py-1.5 rounded text-xs transition-colors ${
              this.autoRotate
                ? 'bg-primary text-white'
                : 'text-white/60 hover:text-white hover:bg-white/10'
            }`
  }

  get part1_props() {
    return this.memo('part1_props', [this.props, this.tr], () => ({ file: this.props.file, t: this.tr }))
  }

  /** A part of the screen still written in React (<a download>: attribute(s) without a .kbview property). */
  get Part1() {
    return __parts.Part1
  }

  get show_error_model_error() {
    return !!(this.error || this.modelError)
  }

  get span_text() {
    if (!((this.error || this.modelError))) return undefined as never
    return this.error ?? 'Impossible de charger ou d\'analyser ce fichier 3D.'
  }

  get show_format_data_model_error() {
    return !!(!this.format && this.data && !this.modelError)
  }

  get p_text() {
    return this.memo('p_text', [this.ext, this.format, this.data, this.modelError], () => {
      if (!(!this.format && this.data && !this.modelError)) return undefined as never
      return ["Format 3D non supporté : ", ((v: unknown) => (v == null || typeof v === 'boolean' ? null : String(v)))(this.ext)] as unknown as string
    })
  }

  get show_data_format_model_error() {
    return !!(this.data && this.format && !this.modelError)
  }

  get part2_props() {
    return this.memo('part2_props', [this.data, this.format, this.autoRotate, this.memo, this.modelError], () => {
      if (!(this.data && this.format && !this.modelError)) return undefined as never
      return ({ data: this.data, format: this.format, autoRotate: this.autoRotate, setModelError: this.memo("setModelError:bound", [], () => this.setModelError.bind(this)) })
    })
  }

  /** A part of the screen still written in React (<Canvas> is no .kbview element (@react-three/fiber#Canvas)). */
  get Part2() {
    if (!(this.data && this.format && !this.modelError)) return undefined as never
    return __parts.Part2
  }

  panel_click(_sender: unknown, _args: MouseEventArgs) {
    this.autoRotate = !this.autoRotate
  }

  panel_click2(_sender: unknown, _args: MouseEventArgs) {
    this.props.onClose?.()
  }

  /** `setModelError` of the TSX: a value, or an update of the previous one. */
  setModelError(value: Files3DViewer['modelError'] | ((prev: Files3DViewer['modelError']) => Files3DViewer['modelError'])) {
    this.modelError = typeof value === 'function' ? (value as (prev: Files3DViewer['modelError']) => Files3DViewer['modelError'])(this.modelError) : value
  }

}

/** What `useStores()` gives (the types of the fields it fills). */
export type Files3DViewerStores = ReturnType<Files3DViewer['useStores']>

/** What `useHooks()` gives (the types of the fields it fills). */
export type Files3DViewerHooks = ReturnType<Files3DViewer['useHooks']>

export default Files3DViewer.component()
