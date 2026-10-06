/**
 * Code-behind of `DriveToolbar.kbcontrol` (converted from `DriveToolbar.tsx` by @kubuno/views-migrate).
 */
import { type MouseEventArgs } from '@kubuno/views'
import { useTranslation } from "react-i18next"
import type { Folder, FolderAncestor } from "@kubuno/drive"
import Breadcrumb from "./DriveBreadcrumb"
import type { DriveBulkActions } from "./useDriveBulkActions"

import { ViewBase } from './DriveToolbar.kbcontrol'
import * as __parts from './DriveToolbar.parts'

interface Props {
  currentFolder: Folder | null
  ancestors:     FolderAncestor[]
  pageTitle:     string
  onNavigate:    (id: string | null) => void
  trashed: boolean
  starred: boolean
  shared:  boolean
  recent:  boolean
  selectedCount:    number
  allItemsSelected: boolean
  onToggleSelectAll: () => void
  /** True when the selection cannot be trashed (protected or playing item). */
  deleteDisabled: boolean
  purgePending:   boolean
  bulk: DriveBulkActions
  onImportFiles:  () => void
  onImportFolder: () => void
  onNewFolder:    () => void
}

export type { Props }

export class DriveToolbar extends ViewBase {
  tr!: DriveToolbarStores['t']

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

  /** `<Breadcrumb>`, rendered by a ReactHost. */
  get Breadcrumb() {
    return Breadcrumb
  }

  get breadcrumb_props() {
    return this.memo('breadcrumb_props', [this.props], () => ({ folder: !this.props.starred && !this.props.shared && !this.props.recent && !this.props.trashed ? this.props.currentFolder : null, ancestors: this.props.ancestors, pageTitle: this.props.pageTitle, onNavigate: this.props.onNavigate }))
  }

  get show_selected_count() {
    return this.props.selectedCount > 0
  }

  get part1_props() {
    return this.memo('part1_props', [this.props, this.tr], () => {
      if (!(this.props.selectedCount > 0)) return undefined as never
      return ({ allItemsSelected: this.props.allItemsSelected, onToggleSelectAll: this.props.onToggleSelectAll, t: this.tr })
    })
  }

  /** A part of the screen still written in React (<Button Icon>: an icon that is not a Lucide icon). */
  get Part1() {
    if (!(this.props.selectedCount > 0)) return undefined as never
    return __parts.Part1
  }

  get show_trashed() {
    if (!(this.props.selectedCount > 0)) return undefined as never
    return !this.props.trashed
  }

  get show_not_trashed() {
    if (!(this.props.selectedCount > 0)) return undefined as never
    return !(!this.props.trashed)
  }

  get enabled_unless_delete_disabled() {
    if (!(this.props.selectedCount > 0) || !(!this.props.trashed)) return undefined as never
    return !(this.props.deleteDisabled)
  }

  get visible() {
    return this.memo('visible', [this.show_trashed, this.show_selected_count], () => this.show_trashed && this.show_selected_count)
  }

  get visible2() {
    return this.memo('visible2', [this.show_not_trashed, this.show_selected_count], () => this.show_not_trashed && this.show_selected_count)
  }

  get show_trashed_selected_count() {
    return this.props.trashed && this.props.selectedCount === 0
  }

  get enabled_unless_purge_pending() {
    if (!(this.props.trashed && this.props.selectedCount === 0)) return undefined as never
    return !(this.props.purgePending)
  }

  get show_trashed_shared_recent() {
    return !this.props.trashed && !this.props.shared && !this.props.recent && !this.props.starred
  }

  button_click(_sender: unknown, _args: MouseEventArgs) {
    if (!(this.props.selectedCount > 0) || !(!this.props.trashed)) return undefined as never
    return (this.props.bulk.compressSelection)?.()
  }

  button_click2(_sender: unknown, _args: MouseEventArgs) {
    if (!(this.props.selectedCount > 0) || !(!this.props.trashed)) return undefined as never
    return (this.props.bulk.trashSelection)?.()
  }

  button_click3(_sender: unknown, _args: MouseEventArgs) {
    if (!(this.props.selectedCount > 0) || !(!(!this.props.trashed))) return undefined as never
    return (this.props.bulk.restoreSelection)?.()
  }

  button_click4(_sender: unknown, _args: MouseEventArgs) {
    if (!(this.props.selectedCount > 0) || !(!(!this.props.trashed))) return undefined as never
    return (this.props.bulk.deleteSelection)?.()
  }

  panel_click(_sender: unknown, _args: MouseEventArgs) {
    if (!(this.props.selectedCount > 0)) return undefined as never
    return (this.props.bulk.clearSelection)?.()
  }

  button_click5(_sender: unknown, _args: MouseEventArgs) {
    if (!(this.props.trashed && this.props.selectedCount === 0)) return undefined as never
    return (this.props.bulk.emptyTrash)?.()
  }

  button_click6(_sender: unknown, _args: MouseEventArgs) {
    if (!(!this.props.trashed && !this.props.shared && !this.props.recent && !this.props.starred)) return undefined as never
    this.props.onImportFolder?.()
  }

  button_click7(_sender: unknown, _args: MouseEventArgs) {
    if (!(!this.props.trashed && !this.props.shared && !this.props.recent && !this.props.starred)) return undefined as never
    this.props.onImportFiles?.()
  }

  button_click8(_sender: unknown, _args: MouseEventArgs) {
    if (!(!this.props.trashed && !this.props.shared && !this.props.recent && !this.props.starred)) return undefined as never
    this.props.onNewFolder?.()
  }

}

/** What `useStores()` gives (the types of the fields it fills). */
export type DriveToolbarStores = ReturnType<DriveToolbar['useStores']>

export default DriveToolbar.component()
