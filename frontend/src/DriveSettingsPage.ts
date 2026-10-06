/**
 * Code-behind of `DriveSettingsPage.kbview` (converted from `DriveSettingsPage.tsx` by @kubuno/views-migrate).
 */
import { bind, type MouseEventArgs } from '@kubuno/views'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from "react-i18next"
import { useIsMobile } from "./openable"

import { ViewBase } from './DriveSettingsPage.kbview'
import * as __parts from './DriveSettingsPage.parts'

type Tab = 'preferences' | 'webdav' | 'about'

export class DriveSettingsPage extends ViewBase {
  @bind accessor tab: Tab = 'preferences'
  tr!: DriveSettingsPageStores['t']
  isMobile!: boolean
  navigate!: ReturnType<typeof useNavigate>

  /** The screen's hooks that read nothing of the view (stores, translations…), as the TSX called them. React's rules apply: `use()` runs them on every render. */
  useStores() {
    const { t } = useTranslation('drive')
    const isMobile = useIsMobile()
    return { t, isMobile }
  }

  /** Runs the hooks and publishes what they give as fields (the bindings, the getters and the methods read them). */
  use(): void {
    const s = this.useStores()
    this.publish({ tr: s.t, isMobile: s.isMobile })
    this.navigate = useNavigate()
  }

  get visibleTabs(): { id: Tab; label: string }[] {
    return this.memo('visibleTabs', [this.tr], () => [
    { id: 'preferences', label: this.tr('drive_tab_preferences', { defaultValue: 'Préférences' }) },
    { id: 'webdav',      label: this.tr('drive_tab_webdav', { defaultValue: 'WebDAV' }) },
    { id: 'about',       label: this.tr('drive_tab_about', { defaultValue: 'À propos' }) },
  ])
  }

  get show_not_is_mobile() {
    return !(this.isMobile)
  }

  get div_class() {
    return `flex items-end border-b border-[#e8eaed] flex-shrink-0 overflow-x-auto ${this.isMobile ? 'px-1' : 'px-4'} [background:#fff]`
  }

  /** The rows of the Repeater over `visibleTabs`. */
  get rows_visible_tabs() {
    return this.memo('rows_visible_tabs', [this.visibleTabs, this.isMobile, this.tab], () => this.visibleTabs.map((tb) => {
      return { tb, button_class: `border-b-2 -mb-px transition-colors whitespace-nowrap ${this.isMobile ? 'px-4 h-12 text-[15px]' : 'px-4 py-3 text-sm'} ${
              this.tab === tb.id ? 'border-[#1a73e8] text-[#1a73e8] font-medium' : 'border-transparent text-[#5f6368] hover:text-[#202124] hover:bg-[#f1f3f4]'}`, key: tb.id }
    }))
  }

  get div_class2() {
    return `max-w-3xl mx-auto ${this.isMobile ? 'px-4 py-4' : 'px-8 py-6'}`
  }

  get show_tab_preferences() {
    return this.tab === 'preferences'
  }

  /** `<PreferencesTab>`, rendered by a ReactHost. */
  get PreferencesTab() {
    return __parts.PreferencesTab
  }

  get show_tab_webdav() {
    return this.tab === 'webdav'
  }

  /** `<WebDavTab>`, rendered by a ReactHost. */
  get WebDavTab() {
    return __parts.WebDavTab
  }

  get show_tab_about() {
    return this.tab === 'about'
  }

  /** `<AboutTab>`, rendered by a ReactHost. */
  get AboutTab() {
    return __parts.AboutTab
  }

  panel_click(_sender: unknown, _args: MouseEventArgs) {
    this.navigate("/drive")
  }

  panel_click2(_sender: unknown, _args: MouseEventArgs) {
    this.navigate("/drive")
  }

  panel_click3(_sender: unknown, args: MouseEventArgs) {
    const { tb } = args.row as RowOf_rows_visible_tabs
    this.tab = tb.id
  }

}

type RowOf_rows_visible_tabs = DriveSettingsPage['rows_visible_tabs'][number]

/** What `useStores()` gives (the types of the fields it fills). */
export type DriveSettingsPageStores = ReturnType<DriveSettingsPage['useStores']>

export default DriveSettingsPage.component()
