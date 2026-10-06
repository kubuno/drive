/**
 * Code-behind of `SortFilterBar.kbcontrol` (converted from `SortFilterBar.tsx` by @kubuno/views-migrate).
 */
import { type ValueChangedEventArgs, type MouseEventArgs } from '@kubuno/views'
import { useTranslation } from "react-i18next"
import { ViewMenu, type ViewMode } from "@kubuno/drive"
import { useDriveExtras } from "../model/driveExtras"
import type { SortDir, SortField } from "./types"

import { ViewBase } from './SortFilterBar.kbcontrol'

export type SortFilterBarProps = {
  sortField: SortField
  sortDir: SortDir
  typeFilter: string | null
  onSortField: (v: SortField) => void
  onSortDir: (v: SortDir) => void
  onTypeFilter: (v: string | null) => void
  viewMode: ViewMode
  onViewMode: (v: ViewMode) => void
  showHidden: boolean
  onShowHidden: (v: boolean) => void
}

export class SortFilterBar extends ViewBase {
  tr!: SortFilterBarStores['t']

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

  get SORT_OPTIONS(): { value: string; label: string; }[] {
    return this.memo('SORT_OPTIONS', [this.tr], () => [
    { value: 'date',  label: this.tr('app.sort_date') },
    { value: 'name',  label: this.tr('common.name') },
    { value: 'size',  label: this.tr('common.size') },
    { value: 'type',  label: this.tr('filter.type') },
  ])
  }

  get TYPE_OPTIONS(): { value: string; label: string; }[] {
    return this.memo('TYPE_OPTIONS', [this.tr], () => [
    { value: '',         label: this.tr('app.ft_all') },
    { value: 'image',    label: this.tr('app.ft_images') },
    { value: 'video',    label: this.tr('filter.t_video') },
    { value: 'audio',    label: this.tr('filter.t_audio') },
    { value: 'document', label: this.tr('filter.t_document') },
    { value: 'archive',  label: this.tr('filter.t_archive') },
  ])
  }

  get text() {
    return this.props.sortDir === 'asc' ? '↑' : '↓'
  }

  get tooltip() {
    return this.props.sortDir === 'asc' ? this.tr('app.sort_asc') : this.tr('app.sort_desc')
  }

  get selected_value() {
    return this.props.typeFilter ?? ''
  }

  /** `<ViewMenu>`, rendered by a ReactHost. */
  get ViewMenu() {
    return ViewMenu
  }

  get view_menu_props() {
    return this.memo('view_menu_props', [this.props, this.tr], () => ({ value: this.props.viewMode, onChange: this.props.onViewMode, showHidden: this.props.showHidden, onShowHidden: this.props.onShowHidden, t: this.tr }))
  }

  dropdown_selected_value_changed(_sender: unknown, args: ValueChangedEventArgs) {
    const v = args.value as string
    this.props.onSortField(v as SortField)
  }

  panel_click(_sender: unknown, _args: MouseEventArgs) {
    this.props.onSortDir(this.props.sortDir === 'asc' ? 'desc' : 'asc')
  }

  dropdown_selected_value_changed2(_sender: unknown, args: ValueChangedEventArgs) {
    const v = args.value as string
    this.props.onTypeFilter(v === '' ? null : v)
  }

  panel_click2(_sender: unknown, _args: MouseEventArgs) {
    useDriveExtras.getState().openTool('duplicates')
  }

  panel_click3(_sender: unknown, _args: MouseEventArgs) {
    useDriveExtras.getState().openTool('insights')
  }

}

/** What `useStores()` gives (the types of the fields it fills). */
export type SortFilterBarStores = ReturnType<SortFilterBar['useStores']>

export default SortFilterBar.component()
