/**
 * Code-behind of `ArchiveBrowser.kbview` (converted from `ArchiveBrowser.tsx` by @kubuno/views-migrate).
 */
import { bind, type MouseEventArgs } from '@kubuno/views'
import { useTranslation } from "react-i18next"
import { useQuery } from "@tanstack/react-query"
import { filesApi, type FileItem, type ArchiveEntry } from "@kubuno/drive"

import { ViewBase } from './ArchiveBrowser.kbview'
import * as __parts from './ArchiveBrowser.parts'

interface Props {
  file:    FileItem
  onClose: () => void
}

export type { Props }

export class ArchiveBrowser extends ViewBase {
  @bind accessor path = ''
  tr!: ArchiveBrowserStores['t']
  data!: ArchiveBrowserHooks['data']
  isLoading!: boolean

  /** The screen's hooks that read nothing of the view (stores, translations…), as the TSX called them. React's rules apply: `use()` runs them on every render. */
  useStores() {
    const { t } = useTranslation('drive')
    return { t }
  }

  /** The screen's hooks that read its members (run after the fields of `useStores()` are set). React's rules apply: `use()` runs them on every render. */
  useHooks() {
    const { data, isLoading } = useQuery({
      queryKey:  ['archive-list', this.props.file.id, this.path],
      queryFn:   () => filesApi.listArchive(this.props.file.id, this.path),
      staleTime: 30_000,
    })
    this.publish({ data, isLoading })
    return { data, isLoading }
  }

  /** Runs the hooks and publishes what they give as fields (the bindings, the getters and the methods read them). */
  use(): void {
    const s = this.useStores()
    this.publish({ tr: s.t })
    const h = this.useHooks()
    this.publish({ data: h.data, isLoading: h.isLoading })
  }

  get entries(): ArchiveEntry[] {
    return this.memo('entries', [this.data], () => this.data?.entries ?? [])
  }

  get parts(): string[] {
    return this.memo('parts', [this.path], () => this.path ? this.path.split('/') : [])
  }

  /** The rows of the Repeater over `parts`. */
  get rows_parts() {
    return this.memo('rows_parts', [this.parts], () => this.parts.map((part, i) => {
      return { part, i, key: i }
    }))
  }

  get show_path() {
    return !!(this.path)
  }

  get show_not_is_loading() {
    return !(this.isLoading)
  }

  get show_entries() {
    if (!(!(this.isLoading))) return undefined as never
    return this.entries.length === 0
  }

  get show_not_entries() {
    if (!(!(this.isLoading))) return undefined as never
    return !(this.entries.length === 0)
  }

  get part1_props() {
    return this.memo('part1_props', [this.tr, this.entries, this.props, this.memo, this.path, this.isLoading], () => {
      if (!(!(this.isLoading)) || !(!(this.entries.length === 0))) return undefined as never
      return ({ t: this.tr, entries: this.entries, file: this.props.file, navigate: this.memo("navigate:bound", [], () => this.navigate.bind(this)) })
    })
  }

  /** A part of the screen still written in React (<table> has no .kbview element yet). */
  get Part1() {
    if (!(!(this.isLoading)) || !(!(this.entries.length === 0))) return undefined as never
    return __parts.Part1
  }

  get visible() {
    return this.memo('visible', [this.show_entries, this.show_not_is_loading], () => this.show_entries && this.show_not_is_loading)
  }

  get visible2() {
    return this.memo('visible2', [this.show_not_entries, this.show_not_is_loading], () => this.show_not_entries && this.show_not_is_loading)
  }

  get div_text() {
    return this.memo('div_text', [this.data], () => String(this.data?.total ?? 0) + " élément" + String((this.data?.total ?? 0) !== 1 ? 's' : '') + " dans l'archive")
  }

  navigate(newPath: string) {
    this.path = newPath
  }

  goUp() {
    const idx = this.path.lastIndexOf('/')
    this.path = idx >= 0 ? this.path.slice(0, idx) : ''
  }

  stack_click(_sender: unknown, args: MouseEventArgs) {
    const e = args.native as React.MouseEvent<HTMLDivElement, MouseEvent>
 if (e.target === e.currentTarget) this.props.onClose() }

  panel_click(_sender: unknown, _args: MouseEventArgs) {
    this.path = ''
  }

  panel_click2(_sender: unknown, args: MouseEventArgs) {
    const { i } = args.row as RowOf_rows_parts
    this.path = this.parts.slice(0, i + 1).join('/')
  }

  panel_click3(_sender: unknown, _args: MouseEventArgs) {
    this.props.onClose?.()
  }

}

type RowOf_rows_parts = ArchiveBrowser['rows_parts'][number]

/** What `useStores()` gives (the types of the fields it fills). */
export type ArchiveBrowserStores = ReturnType<ArchiveBrowser['useStores']>

/** What `useHooks()` gives (the types of the fields it fills). */
export type ArchiveBrowserHooks = ReturnType<ArchiveBrowser['useHooks']>

export default ArchiveBrowser.component()
