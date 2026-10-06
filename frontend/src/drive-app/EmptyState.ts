/**
 * Code-behind of `EmptyState.kbview` (converted from `EmptyState.tsx` by @kubuno/views-migrate).
 */
import { useTranslation } from "react-i18next"

import { ViewBase } from './EmptyState.kbview'

export type EmptyStateProps = { trashed: boolean; starred: boolean; shared: boolean; recent: boolean }

export class EmptyState extends ViewBase {
  tr!: EmptyStateStores['t']

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

  get show_case_1() {
    return !!(this.props.trashed)
  }

  get show_case_2() {
    return !(this.props.trashed) && !!(this.props.starred)
  }

  get show_case_3() {
    return !(this.props.trashed) && !(this.props.starred) && !!(this.props.shared)
  }

  get show_case_4() {
    return !(this.props.trashed) && !(this.props.starred) && !(this.props.shared) && !!(this.props.recent)
  }

  get show_main() {
    return !(this.props.trashed) && !(this.props.starred) && !(this.props.shared) && !(this.props.recent)
  }

  get dnd_hint_import() {
    if (!(!(this.props.trashed)) || !(!(this.props.starred)) || !(!(this.props.shared)) || !(!(this.props.recent))) return undefined as never
    return this.tr('common.import')
  }

  get dnd_hint_folder() {
    if (!(!(this.props.trashed)) || !(!(this.props.starred)) || !(!(this.props.shared)) || !(!(this.props.recent))) return undefined as never
    return this.tr('app.folder_btn')
  }

}

/** What `useStores()` gives (the types of the fields it fills). */
export type EmptyStateStores = ReturnType<EmptyState['useStores']>

export default EmptyState.component()
