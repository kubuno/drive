/**
 * Code-behind of `ImageSearchResultsView.kbview` (converted from `ImageSearchResultsView.tsx` by @kubuno/views-migrate).
 */
import { type MouseEventArgs } from '@kubuno/views'
import { useTranslation } from "react-i18next"
import type { FileItem, SearchHit } from "@kubuno/drive"
import SearchResultRow from "./SearchResultRow"

import { ViewBase } from './ImageSearchResultsView.kbview'

export type ImageSearchResultsViewProps = {
  state: { name: string; loading: boolean; results: SearchHit[]; total: number }
  onClear: () => void
  onOpen: (file: FileItem) => void
}

export class ImageSearchResultsView extends ViewBase {
  tr!: ImageSearchResultsViewStores['t']

  /** The screen's hooks that read nothing of the view (stores, translations…), as the TSX called them. React's rules apply: `use()` runs them on every render. */
  useStores() {
    const { t } = useTranslation('drive')
    return { t }
  }

  /** Runs the hooks and publishes what they give as fields (the bindings, the getters and the methods read them). */
  use(): void {
    const s = this.useStores()
    this.publish({ tr: s.t })
  }

  get p_text() {
    return this.props.state.loading ? this.tr('app.searching') : this.tr('app.result_count', { count: this.props.state.total })
  }

  get text() {
    return this.memo('text', [this.tr], () => [" ", this.tr('app.clear_search')] as unknown as string)
  }

  get show_not_state_loading() {
    return !(this.props.state.loading)
  }

  get show_state_results() {
    if (!(!(this.props.state.loading))) return undefined as never
    return this.props.state.results.length === 0
  }

  get show_not_state_results() {
    if (!(!(this.props.state.loading))) return undefined as never
    return !(this.props.state.results.length === 0)
  }

  /** `<SearchResultRow>`, rendered by a ReactHost. */
  get SearchResultRow() {
    if (!(!(this.props.state.loading)) || !(!(this.props.state.results.length === 0))) return undefined as never
    return SearchResultRow
  }

  /** The rows of the Repeater over `state.results`. */
  get rows_results() {
    return this.memo('rows_results', [this.props], () => {
      if (!(!(this.props.state.loading)) || !(!(this.props.state.results.length === 0))) return undefined as never
      return this.props.state.results.map((file) => {
      return { file, search_result_row_props: ((!(this.props.state.loading)) && (!(this.props.state.results.length === 0))) ? ({ file: file, onOpen: this.props.onOpen }) : undefined, key: file.id }
    })
    })
  }

  get visible() {
    return this.memo('visible', [this.show_state_results, this.show_not_state_loading], () => this.show_state_results && this.show_not_state_loading)
  }

  get visible2() {
    return this.memo('visible2', [this.show_not_state_results, this.show_not_state_loading], () => this.show_not_state_results && this.show_not_state_loading)
  }

  panel_click(_sender: unknown, _args: MouseEventArgs) {
    this.props.onClear?.()
  }

}

/** What `useStores()` gives (the types of the fields it fills). */
export type ImageSearchResultsViewStores = ReturnType<ImageSearchResultsView['useStores']>

export default ImageSearchResultsView.component()
