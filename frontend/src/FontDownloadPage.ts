/**
 * Code-behind of `FontDownloadPage.kbview` (converted from `FontDownloadPage.tsx` by @kubuno/views-migrate).
 */
import { bind, type MouseEventArgs } from '@kubuno/views'

import { ViewBase } from './FontDownloadPage.kbview'
import * as __parts from './FontDownloadPage.parts'

export interface CartVariant { url: string; weight: number; italic: boolean; format: string }

export interface CartFamily {
  name: string
  styleCount: number
  cssFamily: string
  variants: CartVariant[]
}

export type FontDownloadPageProps = {
  families: CartFamily[]
  onRemove: (name: string) => void
  onOpen: (name: string) => void
  onDownloadFamily: (name: string) => void
  onDownloadAll: () => void
  onClearAll: () => void
}

export class FontDownloadPage extends ViewBase {
  @bind accessor embed = false

  get fade(): "linear-gradient(to right, black 88%, transparent 100%)" {
    if (!(!(this.props.families.length === 0)) || !(!(this.embed))) return undefined as never
    return 'linear-gradient(to right, black 88%, transparent 100%)'
  }

  get show_case_1() {
    return !!(this.props.families.length === 0)
  }

  get show_case_2() {
    return !(this.props.families.length === 0) && !!(this.embed)
  }

  /** `<EmbedView>`, rendered by a ReactHost. */
  get EmbedView() {
    if (!(!(this.props.families.length === 0)) || !(this.embed)) return undefined as never
    return __parts.EmbedView
  }

  get embed_view_props() {
    return this.memo('embed_view_props', [this.props, this.embed], () => {
      if (!(!(this.props.families.length === 0)) || !(this.embed)) return undefined as never
      return ({ families: this.props.families, onBack: () => this.embed = false } as React.ComponentProps<typeof __parts.EmbedView>)
    })
  }

  get show_main() {
    return !(this.props.families.length === 0) && !(this.embed)
  }

  get h1_text() {
    return this.memo('h1_text', [this.props, this.embed], () => {
      if (!(!(this.props.families.length === 0)) || !(!(this.embed))) return undefined as never
      return String(this.props.families.length) + " famille" + String(this.props.families.length > 1 ? 's' : '') + " sélectionnée" + String(this.props.families.length > 1 ? 's' : '')
    })
  }

  /** A part of the screen still written in React (<ToolTip> label: no .kbview property). */
  get Part1() {
    if (!(!(this.props.families.length === 0)) || !(!(this.embed))) return undefined as never
    return __parts.Part1
  }

  /** A part of the screen still written in React (<ToolTip> label: no .kbview property). */
  get Part2() {
    if (!(!(this.props.families.length === 0)) || !(!(this.embed))) return undefined as never
    return __parts.Part2
  }

  /** A part of the screen still written in React (<p> with a computed style). */
  get Part3() {
    if (!(!(this.props.families.length === 0)) || !(!(this.embed))) return undefined as never
    return __parts.Part3
  }

  /** The rows of the Repeater over `families`. */
  get rows_families() {
    return this.memo('rows_families', [this.props, this.embed, this.fade], () => {
      if (!(!(this.props.families.length === 0)) || !(!(this.embed))) return undefined as never
      return this.props.families.map((f) => {
      return { f, span_text: ((!(this.props.families.length === 0)) && (!(this.embed))) ? (String(f.styleCount) + " style" + String(f.styleCount > 1 ? 's' : '')) : undefined, part1_props: ((!(this.props.families.length === 0)) && (!(this.embed))) ? ({ onRemove: this.props.onRemove, f: f }) : undefined, part2_props: ((!(this.props.families.length === 0)) && (!(this.embed))) ? ({ onDownloadFamily: this.props.onDownloadFamily, f: f }) : undefined, part3_props: ((!(this.props.families.length === 0)) && (!(this.embed))) ? ({ f: f, fade: this.fade }) : undefined, key: f.name }
    })
    })
  }

  get button_text() {
    return this.memo('button_text', [this.props, this.embed], () => {
      if (!(!(this.props.families.length === 0)) || !(!(this.embed))) return undefined as never
      return "Tout télécharger (" + String(this.props.families.length) + ")"
    })
  }

  panel_click(_sender: unknown, _args: MouseEventArgs) {
    if (!(!(this.props.families.length === 0)) || !(!(this.embed))) return undefined as never
    this.props.onClearAll?.()
  }

  panel_click2(_sender: unknown, args: MouseEventArgs) {
    const { f } = args.row as RowOf_rows_families
    if (!(!(this.props.families.length === 0)) || !(!(this.embed))) return undefined as never
    this.props.onOpen(f.name)
  }

  button_click(_sender: unknown, _args: MouseEventArgs) {
    if (!(!(this.props.families.length === 0)) || !(!(this.embed))) return undefined as never
    this.embed = true
  }

  button_click2(_sender: unknown, _args: MouseEventArgs) {
    if (!(!(this.props.families.length === 0)) || !(!(this.embed))) return undefined as never
    this.props.onDownloadAll?.()
  }

}

type RowOf_rows_families = FontDownloadPage['rows_families'][number]

export default FontDownloadPage.component()
