/**
 * Code-behind of `DriveImageSource.kbview` (converted from `DriveImageSource.tsx` by @kubuno/views-migrate).
 */
import { bind, type MouseEventArgs } from '@kubuno/views'
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useQuery } from "@tanstack/react-query"
import { Folder } from "lucide-react"
import { filesApi, type FileItem, type FilesSearchFilters } from "@kubuno/drive"
import { type ImageSourceProps } from "@kubuno/sdk"

import { ViewBase } from './DriveImageSource.kbview'
import * as __parts from './DriveImageSource.parts'

type Scope = 'mine' | 'recent' | 'starred'

const SCOPES: Array<{ id: Scope; labelKey: string; fallback: string }> = [
  { id: 'mine',    labelKey: 'nav.my_files', fallback: 'My Drive' },
  { id: 'recent',  labelKey: 'nav.recent',   fallback: 'Recent' },
  { id: 'starred', labelKey: 'nav.favorites', fallback: 'Starred' },
]

const isImage = (f: FileItem) => f.mime_type.startsWith('image/')

const SEARCH_FILTERS: FilesSearchFilters = {
  type: 'image', owner: 'anyone', containsWords: '', itemName: '',
  location: 'everywhere', inTrash: false, isStarred: false,
  modifiedDate: 'anytime', sharedWith: '',
}

export type { ImageSourceProps }

export class DriveImageSource extends ViewBase {
  @bind accessor scope: Scope = 'mine'
  @bind accessor folder: string | null = null
  @bind accessor grid = true
  tr!: DriveImageSourceStores['t']
  crumbs!: Array<{ id: string | null; name: string }>
  setCrumbs!: DriveImageSourceHooks['setCrumbs']
  foldersQ!: DriveImageSourceHooks['foldersQ']
  filesQ!: DriveImageSourceHooks['filesQ']

  /** The screen's hooks that read nothing of the view (stores, translations…), as the TSX called them. React's rules apply: `use()` runs them on every render. */
  useStores() {
    const { t } = useTranslation()
    return { t }
  }

  /** The screen's hooks that read its members (run after the fields of `useStores()` are set). React's rules apply: `use()` runs them on every render. */
  useHooks() {
    const [crumbs, setCrumbs] = useState<Array<{ id: string | null; name: string }>>([{ id: null, name: this.myDrive }])
    this.publish({ crumbs, setCrumbs })
    const folder = this.folder
    const foldersQ = useQuery({
      queryKey: ['picker-folders', folder],
      queryFn:  () => filesApi.listFolders(folder),
      enabled:  this.browsing,
      staleTime: 10_000,
    })
    this.publish({ foldersQ })
    const filesQ = useQuery({
      queryKey: ['picker-files', this.scope, folder, this.props.query.trim()],
      queryFn:  () => this.searching
        ? filesApi.searchFiles(this.props.query.trim(), SEARCH_FILTERS).then(r => ({ files: r.results as FileItem[] }))
        : filesApi.listFiles(
            this.scope === 'mine' ? folder : null,
            this.scope === 'starred' || undefined,
            false,
            this.scope === 'recent' || undefined,
          ),
      staleTime: 10_000,
    })
    this.publish({ filesQ })
    return { crumbs, setCrumbs, foldersQ, filesQ }
  }

  /** Runs the hooks and publishes what they give as fields (the bindings, the getters and the methods read them). */
  use(): void {
    const s = this.useStores()
    this.publish({ tr: s.t })
    const h = this.useHooks()
    this.publish({ crumbs: h.crumbs, setCrumbs: h.setCrumbs, foldersQ: h.foldersQ, filesQ: h.filesQ })
  }

  get myDrive(): string {
    return this.tr('nav.my_files', { defaultValue: 'My Drive' })
  }

  get searching(): boolean {
    return this.props.query.trim().length > 0
  }

  get browsing(): boolean {
    return this.scope === 'mine' && !this.searching
  }

  get folders(): import('@kubuno/drive').Folder[] {
    return this.memo('folders', [this.browsing, this.foldersQ], () => this.browsing ? (this.foldersQ.data?.folders ?? []) : [])
  }

  get files(): FileItem[] {
    return this.memo('files', [this.filesQ], () => (this.filesQ.data?.files ?? []).filter(isImage))
  }

  get loading(): boolean {
    return this.filesQ.isLoading || (this.browsing && this.foldersQ.isLoading)
  }

  /** A part of the screen still written in React (<button> with a computed style). */
  get Part1() {
    return __parts.Part1
  }

  /** The rows of the Repeater over `SCOPES`. */
  get rows_scopes() {
    return this.memo('rows_scopes', [this.scope, this.memo, this.folder, this.setCrumbs, this.myDrive, this.tr], () => SCOPES.map((s) => {
      const on = s.id === this.scope
      return { s, on, part1_props: { s: s, switchScope: this.memo("switchScope:bound", [], () => this.switchScope.bind(this)), on: on, t: this.tr }, key: s.id }
    }))
  }

  get part2_props() {
    return this.memo('part2_props', [this.memo, this.grid], () => ({ setGrid: this.memo("setGrid:bound", [], () => this.setGrid.bind(this)), grid: this.grid }))
  }

  /** A part of the screen still written in React (<button> with a computed style). */
  get Part2() {
    return __parts.Part2
  }

  /** A part of the screen still written in React (<button> with a computed style). */
  get Part3() {
    return __parts.Part3
  }

  get show_browsing_crumbs() {
    return this.browsing && this.crumbs.length > 1
  }

  /** The rows of the Repeater over `crumbs`. */
  get rows_crumbs() {
    return this.memo('rows_crumbs', [this.crumbs, this.browsing], () => {
      if (!(this.browsing && this.crumbs.length > 1)) return undefined as never
      return this.crumbs.map((c, i) => {
      return { c, i, show_i: ((this.browsing && this.crumbs.length > 1)) ? (i > 0) : undefined, key: i }
    })
    })
  }

  get show_loading_folders_files() {
    return !this.loading && this.folders.length === 0 && this.files.length === 0
  }

  get show_folders() {
    return this.folders.length > 0
  }

  get div_class() {
    if (!(this.folders.length > 0)) return undefined as never
    return this.grid ? 'grid grid-cols-4 gap-2 mb-4' : 'space-y-1 mb-4'
  }

  /** The rows of the Repeater over `folders`. */
  get rows_folders() {
    return this.memo('rows_folders', [this.folders], () => {
      if (!(this.folders.length > 0)) return undefined as never
      return this.folders.map((f) => {
      return { f, key: f.id }
    })
    })
  }

  get show_files() {
    return this.files.length > 0
  }

  get show_folders2() {
    if (!(this.files.length > 0)) return undefined as never
    return this.folders.length > 0
  }

  get show_not_grid() {
    if (!(this.files.length > 0)) return undefined as never
    return !(this.grid)
  }

  /** `<SignedImg>`, rendered by a ReactHost. */
  get SignedImg() {
    if (!(this.files.length > 0) || !(this.grid)) return undefined as never
    return __parts.SignedImg
  }

  /** The rows of the Repeater over `files`. */
  get rows_files() {
    return this.memo('rows_files', [this.files, this.grid], () => {
      if (!(this.files.length > 0) || !(this.grid)) return undefined as never
      return this.files.map((f) => {
      return { f, show_not_f_has_thumbnail: ((this.files.length > 0) && (this.grid)) ? (!(f.has_thumbnail)) : undefined, signed_img_props: ((this.files.length > 0) && (this.grid) && (f.has_thumbnail)) ? ({ src: filesApi.thumbnailUrl(f.id), alt: f.name, loading: "lazy", className: "w-full aspect-square object-cover" }) : undefined, key: f.id }
    })
    })
  }

  /** `<SignedImg>`, rendered by a ReactHost. */
  get SignedImg2() {
    if (!(this.files.length > 0) || !(!(this.grid))) return undefined as never
    return __parts.SignedImg
  }

  /** The rows of the Repeater over `files`. */
  get rows_files2() {
    return this.memo('rows_files2', [this.files, this.grid], () => {
      if (!(this.files.length > 0) || !(!(this.grid))) return undefined as never
      return this.files.map((f) => {
      return { f, show_not_f_has_thumbnail: ((this.files.length > 0) && (!(this.grid))) ? (!(f.has_thumbnail)) : undefined, signed_img_props: ((this.files.length > 0) && (!(this.grid)) && (f.has_thumbnail)) ? ({ src: filesApi.thumbnailUrl(f.id), alt: "", className: "w-8 h-8 rounded object-cover shrink-0" }) : undefined, key: f.id }
    })
    })
  }

  get visible() {
    return this.memo('visible', [this.show_folders2, this.show_files], () => this.show_folders2 && this.show_files)
  }

  get visible2() {
    return this.memo('visible2', [this.grid, this.show_files], () => this.grid && this.show_files)
  }

  get visible3() {
    return this.memo('visible3', [this.show_not_grid, this.show_files], () => this.show_not_grid && this.show_files)
  }

  enter(id: string, name: string) {
    this.folder = id
    this.setCrumbs(c => [...c, { id, name }])
  }

  goTo(i: number) {
    this.folder = this.crumbs[i].id
    this.setCrumbs(c => c.slice(0, i + 1))
  }

  switchScope(s: Scope) {
    this.scope = s; this.folder = null; this.setCrumbs([{ id: null, name: this.myDrive }])
  }

  panel_click(_sender: unknown, args: MouseEventArgs) {
    const { i } = args.row as RowOf_rows_crumbs
    if (!(this.browsing && this.crumbs.length > 1)) return undefined as never
    this.goTo(i)
  }

  panel_double_click(_sender: unknown, args: MouseEventArgs) {
    const { f } = args.row as RowOf_rows_folders
    if (!(this.folders.length > 0)) return undefined as never
    this.enter(f.id, f.name)
  }

  panel_click2(_sender: unknown, args: MouseEventArgs) {
    const { f } = args.row as RowOf_rows_folders
    if (!(this.folders.length > 0)) return undefined as never
    this.enter(f.id, f.name)
  }

  panel_click3(_sender: unknown, args: MouseEventArgs) {
    const { f } = args.row as RowOf_rows_files
    if (!(this.files.length > 0) || !(this.grid)) return undefined as never
    this.props.onPick({ kind: 'url', url: filesApi.downloadUrl(f.id) })
  }

  panel_click4(_sender: unknown, args: MouseEventArgs) {
    const { f } = args.row as RowOf_rows_files2
    if (!(this.files.length > 0) || !(!(this.grid))) return undefined as never
    this.props.onPick({ kind: 'url', url: filesApi.downloadUrl(f.id) })
  }

  /** `setGrid` of the TSX: a value, or an update of the previous one. */
  setGrid(value: DriveImageSource['grid'] | ((prev: DriveImageSource['grid']) => DriveImageSource['grid'])) {
    this.grid = typeof value === 'function' ? (value as (prev: DriveImageSource['grid']) => DriveImageSource['grid'])(this.grid) : value
  }

}

type RowOf_rows_crumbs = DriveImageSource['rows_crumbs'][number]
type RowOf_rows_folders = DriveImageSource['rows_folders'][number]
type RowOf_rows_files = DriveImageSource['rows_files'][number]
type RowOf_rows_files2 = DriveImageSource['rows_files2'][number]

/** What `useStores()` gives (the types of the fields it fills). */
export type DriveImageSourceStores = ReturnType<DriveImageSource['useStores']>

/** What `useHooks()` gives (the types of the fields it fills). */
export type DriveImageSourceHooks = ReturnType<DriveImageSource['useHooks']>

export default DriveImageSource.component()
