/**
 * Code-behind of `SearchResultsView.kbview` (converted from `SearchResultsView.tsx` by @kubuno/views-migrate).
 */
import { bind, type MouseEventArgs } from '@kubuno/views'
import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { useQuery } from "@tanstack/react-query"
import { filesApi, type FileItem, type FilesSearchFilters } from "@kubuno/drive"
import { prompt } from "@kubuno/sdk"
import { useDriveExtras } from "../driveExtras"
import { isPreviewable } from "./fileKinds"
import SearchResultRow from "./SearchResultRow"

import { ViewBase } from './SearchResultsView.kbview'

export type SearchResultsViewProps = {
  searchQuery: string
  searchFilters: FilesSearchFilters
  onClear: () => void
  onOpen: (file: FileItem) => void
  /** Reports the current previewable results so the previewer can navigate them. */
  onResults?: (files: FileItem[]) => void
}

export class SearchResultsView extends ViewBase {
  @bind accessor tab: 'all' | 'image' | 'video' = 'all'
  @bind accessor page = 0
  tr!: SearchResultsViewStores['t']
  debouncedQ!: SearchResultsViewHooks['debouncedQ']
  effFilters!: FilesSearchFilters
  data!: SearchResultsViewHooks['data']
  isFetching!: boolean

  /** The screen's hooks that read nothing of the view (stores, translations…), as the TSX called them. React's rules apply: `use()` runs them on every render. */
  useStores() {
    const { t } = useTranslation('drive')
    return { t }
  }

  /** The screen's hooks that read its members (run after the fields of `useStores()` are set). React's rules apply: `use()` runs them on every render. */
  useHooks() {
    const [debouncedQ, setDebouncedQ] = useState<string>(this.props.searchQuery)
    this.publish({ debouncedQ })
    useEffect(() => {
      const id = setTimeout(() => setDebouncedQ(this.props.searchQuery), 250)
      return () => clearTimeout(id)
    }, [this.props.searchQuery])
    const effFilters: FilesSearchFilters = useMemo(
      () => ({ ...this.props.searchFilters, type: this.tab === 'all' ? this.props.searchFilters.type : this.tab }),
      [this.props.searchFilters, this.tab],
    )
    this.publish({ effFilters })
    useEffect(() => { this.page = 0 }, [debouncedQ, effFilters])
    const { data, isFetching } = useQuery({
      queryKey: ['files-search', debouncedQ.trim(), effFilters, this.page],
      queryFn:  () => filesApi.searchFiles(debouncedQ.trim(), effFilters, { limit: this.PAGE_SIZE, offset: this.page * this.PAGE_SIZE }),
      enabled:  this.hasCriteria,
      placeholderData: prev => prev, // keep the previous page while loading
    })
    this.publish({ data, isFetching })
    const onResults = this.props.onResults
    useEffect(() => {
      onResults?.((this.results as unknown as FileItem[]).filter(isPreviewable))
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [this.results])
    return { debouncedQ, setDebouncedQ, effFilters, data, isFetching }
  }

  /** Runs the hooks and publishes what they give as fields (the bindings, the getters and the methods read them). */
  use(): void {
    const s = this.useStores()
    this.publish({ tr: s.t })
    const h = this.useHooks()
    this.publish({ debouncedQ: h.debouncedQ, effFilters: h.effFilters, data: h.data, isFetching: h.isFetching })
  }

  get PAGE_SIZE(): 20 {
    return 20
  }

  get hasCriteria(): boolean {
    return this.debouncedQ.trim().length > 0 ||
    this.props.searchFilters.itemName.trim().length > 0 ||
    this.props.searchFilters.containsWords.trim().length > 0
  }

  get results() {
    return this.memo('results', [this.data], () => this.data?.results ?? [])
  }

  get total(): number {
    return this.data?.total ?? 0
  }

  get semantic(): boolean {
    return this.data?.semantic ?? false
  }

  get isLoading(): boolean {
    return this.hasCriteria && this.isFetching && !this.data
  }

  get pageCount(): number {
    return Math.max(1, Math.ceil(this.total / this.PAGE_SIZE))
  }

  get label(): string {
    return this.props.searchQuery ? this.tr('app.search_for', { query: this.props.searchQuery }) : this.tr('app.search_results')
  }

  get TABS(): Array<{ id: 'all' | 'image' | 'video'; label: string }> {
    return this.memo('TABS', [this.tr], () => [
    { id: 'all',   label: this.tr('search.tab_all', { defaultValue: 'Tous' }) },
    { id: 'image', label: this.tr('search.tab_images', { defaultValue: 'Images' }) },
    { id: 'video', label: this.tr('search.tab_videos', { defaultValue: 'Vidéos' }) },
  ])
  }

  get p_text() {
    return this.isLoading ? this.tr('app.searching') : this.tr('app.result_count', { count: this.total })
  }

  /** The rows of the Repeater over `TABS`. */
  get rows_tabs() {
    return this.memo('rows_tabs', [this.TABS, this.tab], () => this.TABS.map((tb) => {
      return { tb, button_class: `px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-colors ${
              this.tab === tb.id
                ? 'border-primary text-primary'
                : 'border-transparent text-text-secondary hover:text-text-primary'
            }`, key: tb.id }
    }))
  }

  get show_not_is_loading() {
    return !(this.isLoading)
  }

  get show_results() {
    if (!(!(this.isLoading))) return undefined as never
    return this.results.length === 0
  }

  get show_not_results() {
    if (!(!(this.isLoading))) return undefined as never
    return !(this.results.length === 0)
  }

  get div_class() {
    if (!(!(this.isLoading)) || !(!(this.results.length === 0))) return undefined as never
    return `divide-y divide-border ${this.isFetching ? 'opacity-60' : ''}`
  }

  /** `<SearchResultRow>`, rendered by a ReactHost. */
  get SearchResultRow() {
    if (!(!(this.isLoading)) || !(!(this.results.length === 0))) return undefined as never
    return SearchResultRow
  }

  /** The rows of the Repeater over `results`. */
  get rows_results() {
    return this.memo('rows_results', [this.results, this.isLoading, this.props], () => {
      if (!(!(this.isLoading)) || !(!(this.results.length === 0))) return undefined as never
      return this.results.map((file) => {
      return { file, search_result_row_props: ((!(this.isLoading)) && (!(this.results.length === 0))) ? ({ file: file, onOpen: this.props.onOpen }) : undefined, key: file.id }
    })
    })
  }

  get show_page_count() {
    if (!(!(this.isLoading)) || !(!(this.results.length === 0))) return undefined as never
    return this.pageCount > 1
  }

  get enabled_unless_page() {
    if (!(!(this.isLoading)) || !(!(this.results.length === 0)) || !(this.pageCount > 1)) return undefined as never
    return !(this.page === 0)
  }

  get text() {
    return this.memo('text', [this.tr, this.isLoading, this.results, this.pageCount], () => {
      if (!(!(this.isLoading)) || !(!(this.results.length === 0)) || !(this.pageCount > 1)) return undefined as never
      return " " + this.tr('app.prev', { defaultValue: 'Précédent' })
    })
  }

  get page_of_page() {
    if (!(!(this.isLoading)) || !(!(this.results.length === 0)) || !(this.pageCount > 1)) return undefined as never
    return this.page + 1
  }

  get enabled_unless_page_page_count() {
    if (!(!(this.isLoading)) || !(!(this.results.length === 0)) || !(this.pageCount > 1)) return undefined as never
    return !(this.page >= this.pageCount - 1)
  }

  get text2() {
    return this.memo('text2', [this.tr, this.isLoading, this.results, this.pageCount], () => {
      if (!(!(this.isLoading)) || !(!(this.results.length === 0)) || !(this.pageCount > 1)) return undefined as never
      return this.tr('app.next', { defaultValue: 'Suivant' }) + " "
    })
  }

  get visible() {
    return this.memo('visible', [this.show_page_count, this.show_not_results, this.isLoading], () => {
      if (!(!(this.isLoading))) return undefined as never
      return this.show_page_count && this.show_not_results
    })
  }

  get visible2() {
    return this.memo('visible2', [this.show_results, this.show_not_is_loading], () => this.show_results && this.show_not_is_loading)
  }

  get visible3() {
    return this.memo('visible3', [this.show_not_results, this.show_not_is_loading], () => this.show_not_results && this.show_not_is_loading)
  }

  get visible4() {
    return this.memo('visible4', [this.visible, this.show_not_is_loading], () => this.visible && this.show_not_is_loading)
  }

  async panel_click(_sender: unknown, _args: MouseEventArgs) {
              const name = await prompt({
                title: 'Sauvegarder la recherche',
                message: 'Donnez un nom à cette recherche pour la retrouver dans la barre latérale.',
                defaultValue: this.props.searchQuery || 'Ma recherche',
                confirmLabel: 'Sauvegarder',
              })
              if (name && name.trim()) {
                try {
                  await useDriveExtras.getState().createSavedSearch({
                    name: name.trim(),
                    query: this.props.searchQuery,
                    filters: this.effFilters as unknown as Record<string, unknown>,
                  })
                } catch { /* ignore */ }
              }
            }

  panel_click2(_sender: unknown, _args: MouseEventArgs) {
    this.props.onClear?.()
  }

  panel_click3(_sender: unknown, args: MouseEventArgs) {
    const { tb } = args.row as RowOf_rows_tabs
    this.tab = tb.id
  }

  panel_click4(_sender: unknown, _args: MouseEventArgs) {
    if (!(!(this.isLoading)) || !(!(this.results.length === 0)) || !(this.pageCount > 1)) return undefined as never
    this.page = Math.max(0, this.page - 1)
  }

  panel_click5(_sender: unknown, _args: MouseEventArgs) {
    if (!(!(this.isLoading)) || !(!(this.results.length === 0)) || !(this.pageCount > 1)) return undefined as never
    this.page = Math.min(this.pageCount - 1, this.page + 1)
  }

}

type RowOf_rows_tabs = SearchResultsView['rows_tabs'][number]

/** What `useStores()` gives (the types of the fields it fills). */
export type SearchResultsViewStores = ReturnType<SearchResultsView['useStores']>

/** What `useHooks()` gives (the types of the fields it fills). */
export type SearchResultsViewHooks = ReturnType<SearchResultsView['useHooks']>

export default SearchResultsView.component()
