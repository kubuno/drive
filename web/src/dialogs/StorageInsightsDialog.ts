/**
 * Code-behind of `StorageInsightsDialog.kbview` (converted from `StorageInsightsDialog.tsx` by @kubuno/views-migrate).
 */
import { bind, type MouseEventArgs } from '@kubuno/views'
import { useEffect } from "react"
import { Image, Video, Music, FileText, Archive, File } from "lucide-react"
import { api } from "@kubuno/sdk"
import { formatSize } from "@kubuno/drive"

import { ViewBase } from './StorageInsightsDialog.kbview'
import * as __parts from './StorageInsightsDialog.parts.tsx'

interface Props {
  onClose: () => void
  onOpenFile?: (id: string) => void
}

interface CategoryStat {
  category: string
  count: number
  size: number
}

interface BigFile {
  id: string
  name: string
  size_bytes: number
  mime_type: string
}

interface Overview {
  categories: CategoryStat[]
  total_files: number
  total_folders: number
  trashed_files: number
  largest: BigFile[]
}

const CATEGORY_ORDER = ['image', 'video', 'audio', 'document', 'archive', 'other'] as const

type KnownCategory = (typeof CATEGORY_ORDER)[number]

const CATEGORY_LABELS: Record<KnownCategory, string> = {
  image: 'Images',
  video: 'Vidéos',
  audio: 'Audio',
  document: 'Documents',
  archive: 'Archives',
  other: 'Autres',
}

const CATEGORY_ICONS: Record<KnownCategory, typeof Image> = {
  image: Image,
  video: Video,
  audio: Music,
  document: FileText,
  archive: Archive,
  other: File,
}

function labelFor(category: string): string {
  return (CATEGORY_LABELS as Record<string, string | undefined>)[category] ?? 'Autres'
}

function iconFor(category: string): typeof Image {
  return (CATEGORY_ICONS as Record<string, typeof Image | undefined>)[category] ?? File
}

export type { Props }

export class StorageInsightsDialog extends ViewBase {
  @bind accessor loading = true
  @bind accessor overview: Overview | null = null

  /** The screen's hooks that read its members (run after the fields of `useStores()` are set). React's rules apply: `use()` runs them on every render. */
  useHooks() {
    useEffect(() => {
      let active = true
      this.loading = true
      api
        .get<Overview>('/drive/stats/overview')
        .then(({ data }) => {
          if (active) this.overview = data
        })
        .finally(() => {
          if (active) this.loading = false
        })
      return () => {
        active = false
      }
    }, [])
    return {  }
  }

  /** Runs the hooks and publishes what they give as fields (the bindings, the getters and the methods read them). */
  use(): void {
    this.useHooks()
  }

  get sortedCategories(): CategoryStat[] {
    return this.memo('sortedCategories', [this.overview], () => this.overview
    ? [...this.overview.categories].sort((a, b) => b.size - a.size)
    : [])
  }

  get maxSize(): number {
    return Math.max(...this.sortedCategories.map((c) => c.size), 1)
  }

  get show_loading_overview() {
    return this.loading || !this.overview
  }

  get show_not_loading_overview() {
    return !(this.loading || !this.overview)
  }

  get div_text() {
    if (!(!(this.loading || !this.overview))) return undefined as never
    return this.overview.total_files
  }

  get div_text2() {
    if (!(!(this.loading || !this.overview))) return undefined as never
    return this.overview.total_folders
  }

  get div_text3() {
    if (!(!(this.loading || !this.overview))) return undefined as never
    return this.overview.trashed_files
  }

  /** A part of the screen still written in React (<Icon> is no .kbview element (a local or dynamic component)). */
  get Part1() {
    if (!(!(this.loading || !this.overview))) return undefined as never
    return __parts.Part1
  }

  /** A part of the screen still written in React (<div> with a computed style). */
  get Part2() {
    if (!(!(this.loading || !this.overview))) return undefined as never
    return __parts.Part2
  }

  /** The rows of the Repeater over `sortedCategories`. */
  get rows_sorted_categories() {
    return this.memo('rows_sorted_categories', [this.sortedCategories, this.maxSize, this.loading, this.overview], () => {
      if (!(!(this.loading || !this.overview))) return undefined as never
      return this.sortedCategories.map((cat) => {
      const Icon = iconFor(cat.category)
      const pct = (cat.size / this.maxSize) * 100
      return { cat, Icon, pct, part1_props: ((!(this.loading || !this.overview))) ? ({ Icon: Icon }) : undefined, span_text: ((!(this.loading || !this.overview))) ? (labelFor(cat.category)) : undefined, span_text2: ((!(this.loading || !this.overview))) ? ([((v: unknown) => (v == null || typeof v === 'boolean' ? null : String(v)))(cat.count), " · ", ((v: unknown) => (v == null || typeof v === 'boolean' ? null : String(v)))(formatSize(cat.size))] as unknown as string) : undefined, part2_props: ((!(this.loading || !this.overview))) ? ({ pct: pct }) : undefined, key: cat.category }
    })
    })
  }

  get div_class() {
    if (!(!(this.loading || !this.overview))) return undefined as never
    return `flex items-center justify-between gap-3 px-2 py-1.5 rounded-lg ${
                      this.props.onOpenFile ? 'cursor-pointer hover:bg-surface-1' : ''
                    }`
  }

  /** The rows of the Repeater over `overview.largest`. */
  get rows_largest() {
    return this.memo('rows_largest', [this.overview, this.loading], () => {
      if (!(!(this.loading || !this.overview))) return undefined as never
      return this.overview.largest.map((f) => {
      return { f, span_text: ((!(this.loading || !this.overview))) ? (formatSize(f.size_bytes)) : undefined, key: f.id }
    })
    })
  }

  panel_click(_sender: unknown, _args: MouseEventArgs) {
    this.props.onClose?.()
  }

  panel_click2(_sender: unknown, _args: MouseEventArgs) {
    this.props.onClose?.()
  }

  panel_click3(_sender: unknown, args: MouseEventArgs) {
    const { f } = args.row as RowOf_rows_largest
    if (!(!(this.loading || !this.overview))) return undefined as never
    if (!(this.props.onOpenFile)) return undefined as never
    this.props.onOpenFile(f.id)
  }

  button_click(_sender: unknown, _args: MouseEventArgs) {
    this.props.onClose?.()
  }

}

type RowOf_rows_largest = StorageInsightsDialog['rows_largest'][number]

/** What `useHooks()` gives (the types of the fields it fills). */
export type StorageInsightsDialogHooks = ReturnType<StorageInsightsDialog['useHooks']>

export default StorageInsightsDialog.component()
