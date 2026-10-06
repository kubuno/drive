/**
 * Code-behind of `FilesToolbar.kbview` (converted from `FilesToolbar.tsx` by @kubuno/views-migrate).
 */
import { useLocation } from "react-router-dom"
import { useTranslation } from "react-i18next"

import { ViewBase } from './FilesToolbar.kbview'

const VIEW_KEYS: Record<string, string> = {
  '/drive':          'nav.my_files',
  '/drive/recent':   'nav.recent',
  '/drive/starred':  'nav.favorites',
  '/drive/shared':   'nav.shared',
  '/drive/trash':    'nav.trash',
  '/drive/settings': 'nav.storage_settings',
}

export class FilesToolbar extends ViewBase {
  tr!: FilesToolbarStores['t']
  pathname!: string

  /** The screen's hooks that read nothing of the view (stores, translations…), as the TSX called them. React's rules apply: `use()` runs them on every render. */
  useStores() {
    const { t } = useTranslation('drive')
    const { pathname } = useLocation()
    return { t, pathname }
  }

  /** Runs the hooks and publishes what they give as fields (the bindings, the getters and the methods read them). */
  use(): void {
    const s = this.useStores()
    this.publish({ tr: s.t, pathname: s.pathname })
  }

  get title(): string {
    return this.tr(VIEW_KEYS[this.pathname] ?? 'nav.files')
  }

}

/** What `useStores()` gives (the types of the fields it fills). */
export type FilesToolbarStores = ReturnType<FilesToolbar['useStores']>

export default FilesToolbar.component()
