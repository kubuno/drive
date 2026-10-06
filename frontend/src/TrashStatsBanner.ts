/**
 * Code-behind of `TrashStatsBanner.kbview` (converted from `TrashStatsBanner.tsx` by @kubuno/views-migrate).
 */
import { bind } from '@kubuno/views'
import { useEffect } from "react"
import { api } from "@kubuno/sdk"
import { formatSize } from "@kubuno/drive"

import { ViewBase } from './TrashStatsBanner.kbview'

interface TrashStats {
  file_count:     number
  size_bytes:     number
  folder_count:   number
  retention_days: number
}

export class TrashStatsBanner extends ViewBase {
  @bind accessor stats: TrashStats | null = null

  /** The screen's hooks that read its members (run after the fields of `useStores()` are set). React's rules apply: `use()` runs them on every render. */
  useHooks() {
    useEffect(() => {
      let alive = true
      api.get<TrashStats>('/drive/trash/stats')
        .then((r) => { if (alive) this.stats = r.data })
        .catch(() => {})
      return () => { alive = false }
    }, [])
    return {  }
  }

  /** Runs the hooks and publishes what they give as fields (the bindings, the getters and the methods read them). */
  use(): void {
    this.useHooks()
  }

  get files(): string {
    if (!(!(!this.stats || (this.stats.file_count === 0 && this.stats.folder_count === 0)))) return undefined as never
    return `${this.stats.file_count} fichier${this.stats.file_count > 1 ? 's' : ''}`
  }

  get folders(): string {
    if (!(!(!this.stats || (this.stats.file_count === 0 && this.stats.folder_count === 0)))) return undefined as never
    return this.stats.folder_count > 0
    ? ` · ${this.stats.folder_count} dossier${this.stats.folder_count > 1 ? 's' : ''}`
    : ''
  }

  get show_case_1() {
    return !!(!this.stats || (this.stats.file_count === 0 && this.stats.folder_count === 0))
  }

  get show_main() {
    return !(!this.stats || (this.stats.file_count === 0 && this.stats.folder_count === 0))
  }

  get span_text() {
    return this.memo('span_text', [this.files, this.folders, this.stats], () => {
      if (!(!(!this.stats || (this.stats.file_count === 0 && this.stats.folder_count === 0)))) return undefined as never
      return String(this.files) + String(this.folders) + " · " + String(formatSize(this.stats.size_bytes))
    })
  }

  get text() {
    return this.memo('text', [this.stats], () => {
      if (!(!(!this.stats || (this.stats.file_count === 0 && this.stats.folder_count === 0)))) return undefined as never
      return "Suppression définitive après " + String(this.stats.retention_days) + " jours"
    })
  }

}

/** What `useHooks()` gives (the types of the fields it fills). */
export type TrashStatsBannerHooks = ReturnType<TrashStatsBanner['useHooks']>

export default TrashStatsBanner.component()
