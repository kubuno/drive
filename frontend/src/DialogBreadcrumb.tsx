/**
 * Code-behind of `DialogBreadcrumb.kbview` (converted from `DialogBreadcrumb.tsx` by @kubuno/views-migrate).
 */
import { type MouseEventArgs } from '@kubuno/views'
import { HardDrive, Server } from "lucide-react"
import { useMenuDropdown, type MenuItem } from "@ui"

import { ViewBase } from './DialogBreadcrumb.kbview'
import * as __parts from './DialogBreadcrumb.parts'

export interface StorageOpt {
  id:      string | null
  name:    string
  remote?: boolean
}

export interface PathCrumb { name: string }

interface Props {
  sources:         StorageOpt[]
  currentSourceId: string | null
  onSelectSource:  (id: string | null) => void
  /** Path segments inside the current storage (excludes the storage root itself). */
  pathCrumbs:      PathCrumb[]
  onNavigatePath:  (idx: number) => void
}

export type { Props }

export class DialogBreadcrumb extends ViewBase {
  menu!: DialogBreadcrumbStores['menu']

  /** The screen's hooks that read nothing of the view (stores, translations…), as the TSX called them. React's rules apply: `use()` runs them on every render. */
  useStores() {
    const menu    = useMenuDropdown()
    return { menu }
  }

  /** Runs the hooks and publishes what they give as fields (the bindings, the getters and the methods read them). */
  use(): void {
    const s = this.useStores()
    this.publish({ menu: s.menu })
  }

  get current(): StorageOpt {
    return this.memo('current', [this.props], () => {
      const currentSourceId = this.props.currentSourceId
      return this.props.sources.find(s => s.id === currentSourceId) ?? this.props.sources[0]
    })
  }

  get multi(): boolean {
    return this.props.sources.length > 1
  }

  get items(): MenuItem[] {
    return this.memo('items', [this.props], () => {
      const currentSourceId = this.props.currentSourceId
      return this.props.sources.map(s => ({
    type:    'action',
    label:   s.name,
    icon:    s.remote ? <Server size={14} /> : <HardDrive size={14} />,
    checked: s.id === currentSourceId,
    onClick: () => this.props.onSelectSource(s.id),
  }))
    })
  }

  get button_class() {
    return `flex items-center gap-1 text-sm font-medium text-text-primary rounded px-1.5 py-1 flex-shrink-0 ${
          this.multi ? 'hover:bg-surface-2' : 'cursor-default'
        }`
  }

  get enabled_unless_multi() {
    return !(!this.multi)
  }

  get show_current_remote() {
    return !!(this.current?.remote)
  }

  get show_not_current_remote() {
    return !(this.current?.remote)
  }

  get span_text() {
    return this.current?.name
  }

  get show_menu_is_open_menu() {
    return this.memo('show_menu_is_open_menu', [this.menu], () => !!(this.menu.isOpen && this.menu.pos))
  }

  get part1_props() {
    return this.memo('part1_props', [this.items, this.menu], () => {
      if (!(this.menu.isOpen && this.menu.pos)) return undefined as never
      return ({ items: this.items, menu_pos: this.menu?.pos, menu: this.menu })
    })
  }

  /** A part of the screen still written in React (<ContextMenu> pos, onClose, minWidth: no .kbview property). */
  get Part1() {
    if (!(this.menu.isOpen && this.menu.pos)) return undefined as never
    return __parts.Part1
  }

  /** The rows of the Repeater over `pathCrumbs`. */
  get rows_path_crumbs() {
    return this.memo('rows_path_crumbs', [this.props], () => this.props.pathCrumbs.map((c, idx) => {
      const isLast = idx === this.props.pathCrumbs.length - 1
      return { c, idx, isLast, button_class: `text-sm font-medium leading-tight rounded px-0.5 transition-colors ${
                isLast ? 'text-text-primary cursor-default' : 'text-text-secondary hover:text-primary'
              }`, enabled_unless_is_last: !(isLast), key: idx }
    }))
  }

  panel_click(_sender: unknown, args: MouseEventArgs) {
    return (this.multi ? this.menu.open : undefined)?.(args.native as never)
  }

  panel_click2(_sender: unknown, args: MouseEventArgs) {
    const { idx } = args.row as RowOf_rows_path_crumbs
    this.props.onNavigatePath(idx)
  }

}

type RowOf_rows_path_crumbs = DialogBreadcrumb['rows_path_crumbs'][number]

/** What `useStores()` gives (the types of the fields it fills). */
export type DialogBreadcrumbStores = ReturnType<DialogBreadcrumb['useStores']>

export default DialogBreadcrumb.component()
