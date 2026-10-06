/**
 * Code-behind of `FontSpecimenPage.kbcontrol` (converted from `FontSpecimenPage.tsx` by @kubuno/views-migrate).
 */
import { bind, type MouseEventArgs } from '@kubuno/views'

import { ViewBase } from './FontSpecimenPage.kbcontrol'
import * as __parts from './FontSpecimenPage.parts.tsx'

export interface SpecimenVariant {
  id: string
  cssFamily: string
  weight: number
  italic: boolean
}

export interface FontSpecimenData {
  name: string
  designer: string
  designerUrl?: string
  vendorUrl?: string
  category: string
  scripts: string[]
  version?: string
  copyright?: string
  description?: string
  license?: string
  licenseUrl?: string
  embeddable?: string
  /** Platform font shipped with the module — undeletable, flagged in the UI. */
  isProtected?: boolean
  variants: SpecimenVariant[]
}

type Tab = 'specimen' | 'about' | 'license' | 'glyphs'

export type FontSpecimenPageProps = { data: FontSpecimenData; onDelete?: () => void; onDownload?: () => void }

export class FontSpecimenPage extends ViewBase {
  @bind accessor tab: Tab = 'specimen'

  get rep(): SpecimenVariant {
    return this.memo('rep', [this.props], () => [...this.props.data.variants].sort((a, b) => a.weight - b.weight)[0])
  }

  get link(): string | undefined {
    return this.props.data.vendorUrl || this.props.data.designerUrl
  }

  get part1_props() {
    return this.memo('part1_props', [this.tab, this.memo], () => ({ tab: this.tab, setTab: this.memo("setTab:bound", [], () => this.setTab.bind(this)) }))
  }

  /** A part of the screen still written in React (<Tabs> tabs: no .kbview property). */
  get Part1() {
    return __parts.Part1
  }

  get show_on_download() {
    return this.memo('show_on_download', [this.props], () => !!(this.props.onDownload))
  }

  get part2_props() {
    return this.memo('part2_props', [this.rep, this.props], () => ({ rep: this.rep, data: this.props.data }))
  }

  /** A part of the screen still written in React (<h1> with a computed style). */
  get Part2() {
    return __parts.Part2
  }

  get show_on_delete() {
    return this.memo('show_on_delete', [this.props], () => !!(this.props.onDelete))
  }

  get show_data_designer() {
    return !!(this.props.data.designer)
  }

  get show_link() {
    return !!(this.link)
  }

  get part3_props() {
    return this.memo('part3_props', [this.link], () => {
      if (!(this.link)) return undefined as never
      return ({ link: this.link })
    })
  }

  /** A part of the screen still written in React (<a target rel>: attribute(s) without a .kbview property). */
  get Part3() {
    if (!(this.link)) return undefined as never
    return __parts.Part3
  }

  get show_tab_specimen() {
    return this.tab === 'specimen'
  }

  /** `<SpecimenTab>`, rendered by a ReactHost. */
  get SpecimenTab() {
    if (!(this.tab === 'specimen')) return undefined as never
    return __parts.SpecimenTab
  }

  get specimen_tab_props() {
    return this.memo('specimen_tab_props', [this.props, this.tab], () => {
      if (!(this.tab === 'specimen')) return undefined as never
      return ({ data: this.props.data })
    })
  }

  get show_tab_about() {
    return this.tab === 'about'
  }

  /** `<AboutTab>`, rendered by a ReactHost. */
  get AboutTab() {
    if (!(this.tab === 'about')) return undefined as never
    return __parts.AboutTab
  }

  get about_tab_props() {
    return this.memo('about_tab_props', [this.props, this.tab], () => {
      if (!(this.tab === 'about')) return undefined as never
      return ({ data: this.props.data })
    })
  }

  get show_tab_license() {
    return this.tab === 'license'
  }

  /** `<LicenseTab>`, rendered by a ReactHost. */
  get LicenseTab() {
    if (!(this.tab === 'license')) return undefined as never
    return __parts.LicenseTab
  }

  get license_tab_props() {
    return this.memo('license_tab_props', [this.props, this.tab], () => {
      if (!(this.tab === 'license')) return undefined as never
      return ({ data: this.props.data })
    })
  }

  get show_tab_glyphs() {
    return this.tab === 'glyphs'
  }

  /** `<GlyphsTab>`, rendered by a ReactHost. */
  get GlyphsTab() {
    if (!(this.tab === 'glyphs')) return undefined as never
    return __parts.GlyphsTab
  }

  get glyphs_tab_props() {
    return this.memo('glyphs_tab_props', [this.props, this.tab], () => {
      if (!(this.tab === 'glyphs')) return undefined as never
      return ({ data: this.props.data })
    })
  }

  button_click(_sender: unknown, _args: MouseEventArgs) {
    if (!(this.props.onDownload)) return undefined as never
    this.props.onDownload?.()
  }

  button_click2(_sender: unknown, _args: MouseEventArgs) {
    if (!(this.props.onDelete)) return undefined as never
    this.props.onDelete?.()
  }

  /** `setTab` of the TSX: a value, or an update of the previous one. */
  setTab(value: Tab | ((prev: Tab) => Tab)) {
    this.tab = typeof value === 'function' ? (value as (prev: Tab) => Tab)(this.tab) : value
  }

}

export default FontSpecimenPage.component()
