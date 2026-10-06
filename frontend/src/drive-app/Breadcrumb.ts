/**
 * Code-behind of `Breadcrumb.kbview` (converted from `Breadcrumb.tsx` by @kubuno/views-migrate).
 */
import { type MouseEventArgs } from '@kubuno/views'
import { useTranslation } from "react-i18next"
import type { Folder, FolderAncestor } from "@kubuno/drive"

import { ViewBase } from './Breadcrumb.kbview'

interface BreadcrumbProps {
  folder:      Folder | null
  ancestors:   FolderAncestor[]
  pageTitle:   string
  onNavigate:  (id: string | null) => void
}

export type { BreadcrumbProps }

export class Breadcrumb extends ViewBase {
  /** The screen's hooks that read nothing of the view (stores, translations…), as the TSX called them. React's rules apply: `use()` runs them on every render. */
  useStores() {
    const { t } = useTranslation('drive')
    return { t }
  }

  /** Runs the hooks and publishes what they give as fields (the bindings, the getters and the methods read them). */
  use(): void {
    this.useStores()
  }

  get show_case_1() {
    return !!(!this.props.folder)
  }

  get show_main() {
    return !(!this.props.folder)
  }

  /** The rows of the Repeater over `ancestors`. */
  get rows_ancestors() {
    return this.memo('rows_ancestors', [this.props], () => {
      if (!(!(!this.props.folder))) return undefined as never
      return this.props.ancestors.map((anc) => {
      return { anc, key: anc.id }
    })
    })
  }

  get span_text() {
    if (!(!(!this.props.folder))) return undefined as never
    return this.props.folder.name
  }

  panel_click(_sender: unknown, _args: MouseEventArgs) {
    if (!(!(!this.props.folder))) return undefined as never
    this.props.onNavigate(null)
  }

  panel_click2(_sender: unknown, args: MouseEventArgs) {
    const { anc } = args.row as RowOf_rows_ancestors
    if (!(!(!this.props.folder))) return undefined as never
    this.props.onNavigate(anc.id)
  }

}

type RowOf_rows_ancestors = Breadcrumb['rows_ancestors'][number]

/** What `useStores()` gives (the types of the fields it fills). */
export type BreadcrumbStores = ReturnType<Breadcrumb['useStores']>

export default Breadcrumb.component()
