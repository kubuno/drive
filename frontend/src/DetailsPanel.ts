/**
 * Code-behind of `DetailsPanel.kbview` (converted from `DetailsPanel.tsx` by @kubuno/views-migrate).
 */
import { bind, type MouseEventArgs } from '@kubuno/views'
import { useEffect } from "react"
import { useTranslation } from "react-i18next"
import { api, useAuthStore } from "@kubuno/sdk"
import { VersionHistoryModal, type FileItem } from "@kubuno/drive"
import { type FileVersionStats } from "./fileVersions"
import TagDots from "./TagDots"

import { ViewBase } from './DetailsPanel.kbview'
import * as __parts from './DetailsPanel.parts'

interface DetailFile extends FileVersionStats {
  id:            string
  name:          string
  mime_type:     string
  size_bytes:    number
  created_at:    string
  updated_at:    string
  has_thumbnail: boolean
  metadata?:     Record<string, unknown>
}

interface Props {
  file:       DetailFile | null
  onClose:    () => void
  onEditTags: (file: DetailFile) => void
}

interface AccessStats {
  view_count:          number
  download_count:      number
  last_viewed_at:      string | null
  last_downloaded_at:  string | null
}

interface GpsPoint {
  lat: number
  lon: number
}

interface MetaExtra {
  exif:   Record<string, string | GpsPoint>
  width:  number | null
  height: number | null
}

const EXIF_LABELS: Array<[string, string]> = [
  ['camera_make',   'Appareil'],
  ['camera_model',  'Modèle'],
  ['taken_at',      'Pris le'],
  ['exposure_time', 'Exposition'],
  ['f_number',      'Ouverture'],
  ['iso',           'ISO'],
  ['focal_length',  'Focale'],
]

function isGps(v: string | GpsPoint | undefined): v is GpsPoint {
  return !!v && typeof v === 'object' && 'lat' in v && 'lon' in v
}

export type { Props }

export class DetailsPanel extends ViewBase {
  @bind accessor thumb: string = ''
  @bind accessor historyFile: FileItem | null = null
  @bind accessor access: AccessStats | null = null
  @bind accessor accessLoaded = false
  @bind accessor meta: MetaExtra | null = null
  @bind accessor desc: string = ''
  @bind accessor saving = false
  @bind accessor saved = false
  tr!: DetailsPanelStores['t']

  /** The screen's hooks that read nothing of the view (stores, translations…), as the TSX called them. React's rules apply: `use()` runs them on every render. */
  useStores() {
    const { t } = useTranslation('drive')
    return { t }
  }

  /** The screen's hooks that read its members (run after the fields of `useStores()` are set). React's rules apply: `use()` runs them on every render. */
  useHooks() {
    const file = this.props.file
    useEffect(() => {
      this.thumb = ''
      if (!file?.has_thumbnail) return
      let url = ''
      const token = useAuthStore.getState().accessToken
      fetch(`/api/v1/drive/${file.id}/thumbnail`, { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => (r.ok ? r.blob() : Promise.reject()))
        .then((b) => {
          url = URL.createObjectURL(b)
          this.thumb = url
        })
        .catch(() => {})
      return () => {
        if (url) URL.revokeObjectURL(url)
      }
    }, [file?.id])
    useEffect(() => {
      this.desc = (file?.metadata?.description as string) ?? ''
      this.saved = false
    }, [file?.id])
    useEffect(() => {
      if (!file) return
      let alive = true
      this.access = null
      this.accessLoaded = false
      api
        .get<{ access: AccessStats | null }>(`/drive/${file.id}/access`)
        .then((res) => {
          if (!alive) return
          this.access = res.data.access
          this.accessLoaded = true
        })
        .catch(() => {
          if (alive) this.accessLoaded = true
        })
      return () => {
        alive = false
      }
    }, [file?.id])
    useEffect(() => {
      if (!file || !this.isImage) {
        this.meta = null
        return
      }
      let alive = true
      this.meta = null
      api
        .get<MetaExtra>(`/drive/${file.id}/metadata-extra`)
        .then((res) => {
          if (alive) this.meta = res.data
        })
        .catch(() => {})
      return () => {
        alive = false
      }
    }, [file?.id, this.isImage])
    return {  }
  }

  /** Runs the hooks and publishes what they give as fields (the bindings, the getters and the methods read them). */
  use(): void {
    const s = this.useStores()
    this.publish({ tr: s.t })
    this.useHooks()
  }

  get isImage(): boolean {
    return !!this.props.file && this.props.file.mime_type.startsWith('image/')
  }

  get gps(): GpsPoint | undefined {
    return this.memo('gps', [this.meta, this.props], () => {
      if (!(!(!this.props.file))) return undefined as never
      return isGps(this.meta?.exif.gps) ? this.meta?.exif.gps : undefined
    })
  }

  get hasDims(): boolean {
    if (!(!(!this.props.file))) return undefined as never
    return !!this.meta && this.meta.width != null && this.meta.height != null
  }

  get exifRows(): [string, string][] {
    return this.memo('exifRows', [this.props, this.meta], () => {
      if (!(!(!this.props.file))) return undefined as never
      const meta = this.meta
      return EXIF_LABELS.filter(([key]) => typeof meta?.exif[key] === 'string')
    })
  }

  get show_case_1() {
    return !!(!this.props.file)
  }

  get show_main() {
    return !(!this.props.file)
  }

  get show_file_has_thumbnail() {
    if (!(!(!this.props.file))) return undefined as never
    return !!(this.props.file.has_thumbnail && this.thumb)
  }

  get show_not_file_has_thumbnail() {
    if (!(!(!this.props.file))) return undefined as never
    return !(this.props.file.has_thumbnail && this.thumb)
  }

  get part1_props() {
    return this.memo('part1_props', [this.thumb, this.props], () => {
      if (!(!(!this.props.file)) || !(this.props.file.has_thumbnail && this.thumb)) return undefined as never
      return ({ thumb: this.thumb, file: this.props.file })
    })
  }

  /** A part of the screen still written in React (<img> has no .kbview element yet). */
  get Part1() {
    if (!(!(!this.props.file)) || !(this.props.file.has_thumbnail && this.thumb)) return undefined as never
    return __parts.Part1
  }

  get p_text() {
    if (!(!(!this.props.file))) return undefined as never
    return this.props.file.name
  }

  get p_text2() {
    if (!(!(!this.props.file))) return undefined as never
    return this.props.file.mime_type
  }

  /** `<TagDots>`, rendered by a ReactHost. */
  get TagDots() {
    if (!(!(!this.props.file))) return undefined as never
    return TagDots
  }

  get tag_dots_props() {
    return this.memo('tag_dots_props', [this.props], () => {
      if (!(!(!this.props.file))) return undefined as never
      return ({ itemId: this.props.file.id })
    })
  }

  get part2_props() {
    return this.memo('part2_props', [this.props, this.memo, this.historyFile, this.tr], () => {
      if (!(!(!this.props.file))) return undefined as never
      return ({ file: this.props.file, openHistory: this.memo("openHistory:bound", [], () => this.openHistory.bind(this)), t: this.tr })
    })
  }

  /** A part of the screen still written in React (<Section> is no .kbview element (a local or dynamic component)). */
  get Part2() {
    if (!(!(!this.props.file))) return undefined as never
    return __parts.Part2
  }

  get part3_props() {
    return this.memo('part3_props', [this.access, this.accessLoaded, this.props], () => {
      if (!(!(!this.props.file))) return undefined as never
      return ({ access: this.access, access_last_viewed_at: this.access?.last_viewed_at, accessLoaded: this.accessLoaded })
    })
  }

  /** A part of the screen still written in React (<Section> is no .kbview element (a local or dynamic component)). */
  get Part3() {
    if (!(!(!this.props.file))) return undefined as never
    return __parts.Part3
  }

  get show_is_image_has_dims_exif_rows() {
    return this.memo('show_is_image_has_dims_exif_rows', [this.isImage, this.hasDims, this.exifRows, this.gps, this.props], () => {
      if (!(!(!this.props.file))) return undefined as never
      return !!(this.isImage && (this.hasDims || this.exifRows.length > 0 || this.gps))
    })
  }

  get part4_props() {
    return this.memo('part4_props', [this.hasDims, this.meta, this.exifRows, this.gps, this.props, this.isImage], () => {
      if (!(!(!this.props.file)) || !(this.isImage && (this.hasDims || this.exifRows.length > 0 || this.gps))) return undefined as never
      return ({ hasDims: this.hasDims, meta: this.meta, exifRows: this.exifRows, gps: this.gps })
    })
  }

  /** A part of the screen still written in React (<Section> is no .kbview element (a local or dynamic component)). */
  get Part4() {
    if (!(!(!this.props.file)) || !(this.isImage && (this.hasDims || this.exifRows.length > 0 || this.gps))) return undefined as never
    return __parts.Part4
  }

  get part5_props() {
    return this.memo('part5_props', [this.desc, this.memo, this.props, this.saving, this.saved], () => {
      if (!(!(!this.props.file))) return undefined as never
      return ({ desc: this.desc, setDesc: this.memo("setDesc:bound", [], () => this.setDesc.bind(this)), saveDescription: this.memo("saveDescription:bound", [], () => this.saveDescription.bind(this)), saving: this.saving, saved: this.saved })
    })
  }

  /** A part of the screen still written in React (<Section> is no .kbview element (a local or dynamic component)). */
  get Part5() {
    if (!(!(!this.props.file))) return undefined as never
    return __parts.Part5
  }

  /** `<VersionHistoryModal>`, rendered by a ReactHost. */
  get VersionHistoryModal() {
    if (!(!(!this.props.file))) return undefined as never
    return VersionHistoryModal
  }

  get version_history_modal_props() {
    return this.memo('version_history_modal_props', [this.historyFile, this.props], () => {
      if (!(!(!this.props.file))) return undefined as never
      return ({ file: this.historyFile, onClose: () => this.historyFile = null } as React.ComponentProps<typeof VersionHistoryModal>)
    })
  }

  async openHistory() {
    if (!(!(!this.props.file))) return undefined as never
    try {
      const { data } = await api.get<{ file: FileItem }>(`/drive/${this.props.file.id}`)
      this.historyFile = data.file
    } catch {
      // Best-effort, like every other fetch in this panel.
    }
  }

  async saveDescription() {
    if (!(!(!this.props.file))) return undefined as never
    this.saving = true
    this.saved = false
    try {
      await api.patch(`/drive/${this.props.file.id}/user-metadata`, { description: this.desc })
      this.saved = true
      setTimeout(() => this.saved = false, 2500)
    } catch {
      // Best-effort: keep the edited text on screen on failure.
    } finally {
      this.saving = false
    }
  }

  panel_click(_sender: unknown, _args: MouseEventArgs) {
    if (!(!(!this.props.file))) return undefined as never
    this.props.onClose?.()
  }

  panel_click2(_sender: unknown, _args: MouseEventArgs) {
    if (!(!(!this.props.file))) return undefined as never
    this.props.onEditTags(this.props.file)
  }

  /** `setDesc` of the TSX: a value, or an update of the previous one. */
  setDesc(value: string | ((prev: string) => string)) {
    this.desc = typeof value === 'function' ? (value as (prev: string) => string)(this.desc) : value
  }

}

/** What `useStores()` gives (the types of the fields it fills). */
export type DetailsPanelStores = ReturnType<DetailsPanel['useStores']>

/** What `useHooks()` gives (the types of the fields it fills). */
export type DetailsPanelHooks = ReturnType<DetailsPanel['useHooks']>

export default DetailsPanel.component()
