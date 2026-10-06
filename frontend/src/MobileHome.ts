/**
 * Code-behind of `MobileHome.kbview` (converted from `MobileHome.tsx` by @kubuno/views-migrate).
 */
import { bind, type MouseEventArgs } from '@kubuno/views'
import { useTranslation } from "react-i18next"

import { ViewBase } from './MobileHome.kbview'
import * as __parts from './MobileHome.parts'

export class MobileHome extends ViewBase {
  @bind accessor tab: 'suggestions' | 'activity' = 'suggestions'
  tr!: MobileHomeStores['t']

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

  get tabs(): { id: MobileHome['tab']; label: string }[] {
    return this.memo('tabs', [this.tr], () => [
    { id: 'suggestions', label: this.tr('home.suggestions', { defaultValue: 'Suggestions' }) },
    { id: 'activity',    label: this.tr('home.activity',    { defaultValue: 'Activité' }) },
  ])
  }

  /** The rows of the Repeater over `tabs`. */
  get rows_tabs() {
    return this.memo('rows_tabs', [this.tabs, this.tab], () => this.tabs.map((x) => {
      const active = this.tab === x.id
      return { x, active, button_class: `flex-1 h-12 text-[15px] transition-colors relative
                          ${active ? 'text-primary font-medium' : 'text-text-secondary'}`, key: x.id }
    }))
  }

  get show_tab_suggestions() {
    return this.tab === 'suggestions'
  }

  get show_not_tab_suggestions() {
    return !(this.tab === 'suggestions')
  }

  get part1_props() {
    return this.memo('part1_props', [this.tr, this.tab], () => {
      if (!(this.tab === 'suggestions')) return undefined as never
      return ({ t: this.tr })
    })
  }

  /** A part of the screen still written in React (<Suspense> is no .kbview element (react#Suspense)). */
  get Part1() {
    if (!(this.tab === 'suggestions')) return undefined as never
    return __parts.Part1
  }

  /** `<ActivityTab>`, rendered by a ReactHost. */
  get ActivityTab() {
    return __parts.ActivityTab
  }

  panel_click(_sender: unknown, args: MouseEventArgs) {
    const { x } = args.row as RowOf_rows_tabs
    this.tab = x.id
  }

}

type RowOf_rows_tabs = MobileHome['rows_tabs'][number]

/** What `useStores()` gives (the types of the fields it fills). */
export type MobileHomeStores = ReturnType<MobileHome['useStores']>

export default MobileHome.component()
