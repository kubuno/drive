/**
 * Code-behind of `DriveContentGrid.kbview` (converted from `DriveContentGrid.tsx` by @kubuno/views-migrate).
 */
import { Fragment } from 'react'
import React from "react"
import { useTranslation } from "react-i18next"
import { ViewMenu, VIEW_SPECS, type FileItem, type Folder } from "@kubuno/drive"
import TrashStatsBanner from "../TrashStatsBanner"
import EmptyState from "./EmptyState"
import FileCard from "./FileCard"
import FileRow from "./FileRow"
import SortFilterBar from "./SortFilterBar"
import type { DriveSelection } from "./useDriveSelection"
import type { DriveViewOptions } from "./useDriveViewOptions"

import { ViewBase } from './DriveContentGrid.kbview'
import * as __parts from './DriveContentGrid.parts'

interface Props {
  folders:       Folder[]
  files:         FileItem[]
  filteredFiles: FileItem[]
  isLoading:  boolean
  hasError:   boolean
  trashed: boolean
  starred: boolean
  shared:  boolean
  recent:  boolean
  view:       DriveViewOptions
  selection:  DriveSelection
  /** Flat display order (folders then files) used to anchor range selections. */
  orderedIds: string[]
  dragOverFolderId:    string | null
  setDragOverFolderId: (id: string | null) => void
  setDraggingItem:     (item: { type: 'folder' | 'file'; id: string } | null) => void
  onDropOnFolder: (e: React.DragEvent, folderId: string) => void
  onNavigate:  (id: string | null) => void
  onOpenMenu:  (e: React.MouseEvent, type: 'folder' | 'file', item: Folder | FileItem) => void
  onOpenFile:  (file: FileItem) => void
  onRestoreFile: (id: string) => void
  onDeleteFile:  (id: string) => void
}

export type { Props }

export class DriveContentGrid extends ViewBase {
  tr!: DriveContentGridStores['t']

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

  get selectedIds() {
    return this.memo('selectedIds', [this.props], () => (this.props.selection).selectedIds)
  }

  get setSelectedIds() {
    return this.memo('setSelectedIds', [this.props], () => (this.props.selection).setSelectedIds)
  }

  get preSelectedIds() {
    return this.memo('preSelectedIds', [this.props], () => (this.props.selection).preSelectedIds)
  }

  get cursorId() {
    return (this.props.selection).cursorId
  }

  get handleItemSelect() {
    return this.memo('handleItemSelect', [this.props], () => (this.props.selection).handleItemSelect)
  }

  get lastSelectedIdxRef() {
    return this.memo('lastSelectedIdxRef', [this.props], () => (this.props.selection).lastSelectedIdxRef)
  }

  get show_case_1() {
    return !!(this.props.isLoading)
  }

  get show_case_2() {
    return !(this.props.isLoading) && !!(this.props.hasError)
  }

  get show_case_3() {
    return !(this.props.isLoading) && !(this.props.hasError) && !!(this.props.folders.length === 0 && this.props.filteredFiles.length === 0)
  }

  /** `<EmptyState>`, rendered by a ReactHost. */
  get EmptyState() {
    if (!(!(this.props.isLoading)) || !(!(this.props.hasError)) || !(this.props.folders.length === 0 && this.props.filteredFiles.length === 0)) return undefined as never
    return EmptyState
  }

  get empty_state_props() {
    return this.memo('empty_state_props', [this.props], () => {
      if (!(!(this.props.isLoading)) || !(!(this.props.hasError)) || !(this.props.folders.length === 0 && this.props.filteredFiles.length === 0)) return undefined as never
      return ({ trashed: this.props.trashed, starred: this.props.starred, shared: this.props.shared, recent: this.props.recent })
    })
  }

  get show_main() {
    return !(this.props.isLoading) && !(this.props.hasError) && !(this.props.folders.length === 0 && this.props.filteredFiles.length === 0)
  }

  /** `<TrashStatsBanner>`, rendered by a ReactHost. */
  get TrashStatsBanner() {
    return TrashStatsBanner
  }

  get show_files_trashed_recent() {
    if (!(!(this.props.isLoading)) || !(!(this.props.hasError)) || !(!(this.props.folders.length === 0 && this.props.filteredFiles.length === 0))) return undefined as never
    return this.props.files.length > 0 && !this.props.trashed && !this.props.recent && !this.props.starred && !this.props.shared
  }

  /** `<SortFilterBar>`, rendered by a ReactHost. */
  get SortFilterBar() {
    if (!(!(this.props.isLoading)) || !(!(this.props.hasError)) || !(!(this.props.folders.length === 0 && this.props.filteredFiles.length === 0)) || !(this.props.files.length > 0 && !this.props.trashed && !this.props.recent && !this.props.starred && !this.props.shared)) return undefined as never
    return SortFilterBar
  }

  get sort_filter_bar_props() {
    return this.memo('sort_filter_bar_props', [this.props], () => {
      if (!(!(this.props.isLoading)) || !(!(this.props.hasError)) || !(!(this.props.folders.length === 0 && this.props.filteredFiles.length === 0)) || !(this.props.files.length > 0 && !this.props.trashed && !this.props.recent && !this.props.starred && !this.props.shared)) return undefined as never
      return ({ sortField: this.props.view.sortField, sortDir: this.props.view.sortDir, typeFilter: this.props.view.typeFilter, onSortField: this.props.view.setSortField, onSortDir: this.props.view.setSortDir, onTypeFilter: this.props.view.setTypeFilter, viewMode: this.props.view.viewMode, onViewMode: this.props.view.setViewMode, showHidden: this.props.view.showHidden, onShowHidden: this.props.view.setShowHidden })
    })
  }

  get show_files_trashed_recent2() {
    if (!(!(this.props.isLoading)) || !(!(this.props.hasError)) || !(!(this.props.folders.length === 0 && this.props.filteredFiles.length === 0))) return undefined as never
    return this.props.files.length > 0 && (this.props.trashed || this.props.recent || this.props.starred || this.props.shared)
  }

  /** `<ViewMenu>`, rendered by a ReactHost. */
  get ViewMenu() {
    if (!(!(this.props.isLoading)) || !(!(this.props.hasError)) || !(!(this.props.folders.length === 0 && this.props.filteredFiles.length === 0)) || !(this.props.files.length > 0 && (this.props.trashed || this.props.recent || this.props.starred || this.props.shared))) return undefined as never
    return ViewMenu
  }

  get view_menu_props() {
    return this.memo('view_menu_props', [this.props, this.tr], () => {
      if (!(!(this.props.isLoading)) || !(!(this.props.hasError)) || !(!(this.props.folders.length === 0 && this.props.filteredFiles.length === 0)) || !(this.props.files.length > 0 && (this.props.trashed || this.props.recent || this.props.starred || this.props.shared))) return undefined as never
      return ({ value: this.props.view.viewMode, onChange: this.props.view.setViewMode, showHidden: this.props.view.showHidden, onShowHidden: this.props.view.setShowHidden, t: this.tr })
    })
  }

  get show_folders() {
    if (!(!(this.props.isLoading)) || !(!(this.props.hasError)) || !(!(this.props.folders.length === 0 && this.props.filteredFiles.length === 0))) return undefined as never
    return this.props.folders.length > 0
  }

  get h2_text() {
    if (!(!(this.props.isLoading)) || !(!(this.props.hasError)) || !(!(this.props.folders.length === 0 && this.props.filteredFiles.length === 0)) || !(this.props.folders.length > 0)) return undefined as never
    return this.props.trashed ? this.tr('app.folders_trash') : this.tr('app.folders')
  }

  get part1_props() {
    return this.memo('part1_props', [this.props, this.selectedIds, this.preSelectedIds, this.cursorId, this.handleItemSelect, this.setSelectedIds, this.lastSelectedIdxRef], () => {
      if (!(!(this.props.isLoading)) || !(!(this.props.hasError)) || !(!(this.props.folders.length === 0 && this.props.filteredFiles.length === 0)) || !(this.props.folders.length > 0)) return undefined as never
      return ({ view: this.props.view, folders: this.props.folders, dragOverFolderId: this.props.dragOverFolderId, selectedIds: this.selectedIds, preSelectedIds: this.preSelectedIds, cursorId: this.cursorId, trashed: this.props.trashed, handleItemSelect: this.handleItemSelect, onNavigate: this.props.onNavigate, onOpenMenu: this.props.onOpenMenu, setSelectedIds: this.setSelectedIds, lastSelectedIdxRef: this.lastSelectedIdxRef, orderedIds: this.props.orderedIds, setDraggingItem: this.props.setDraggingItem, setDragOverFolderId: this.props.setDragOverFolderId, onDropOnFolder: this.props.onDropOnFolder })
    })
  }

  /** A part of the screen still written in React (<div> with a computed style). */
  get Part1() {
    if (!(!(this.props.isLoading)) || !(!(this.props.hasError)) || !(!(this.props.folders.length === 0 && this.props.filteredFiles.length === 0)) || !(this.props.folders.length > 0)) return undefined as never
    return __parts.Part1
  }

  get show_filtered_files() {
    if (!(!(this.props.isLoading)) || !(!(this.props.hasError)) || !(!(this.props.folders.length === 0 && this.props.filteredFiles.length === 0))) return undefined as never
    return this.props.filteredFiles.length > 0
  }

  get text() {
    if (!(!(this.props.isLoading)) || !(!(this.props.hasError)) || !(!(this.props.folders.length === 0 && this.props.filteredFiles.length === 0)) || !(this.props.filteredFiles.length > 0)) return undefined as never
    return this.props.trashed ? this.tr('app.files_trash') : this.tr('app.files')
  }

  get show_view_type_filter_filtered_files() {
    if (!(!(this.props.isLoading)) || !(!(this.props.hasError)) || !(!(this.props.folders.length === 0 && this.props.filteredFiles.length === 0)) || !(this.props.filteredFiles.length > 0)) return undefined as never
    return !!(this.props.view.typeFilter && this.props.filteredFiles.length !== this.props.files.length)
  }

  get span_text() {
    return this.memo('span_text', [this.props], () => {
      if (!(!(this.props.isLoading)) || !(!(this.props.hasError)) || !(!(this.props.folders.length === 0 && this.props.filteredFiles.length === 0)) || !(this.props.filteredFiles.length > 0) || !(this.props.view.typeFilter && this.props.filteredFiles.length !== this.props.files.length)) return undefined as never
      return "— " + String(this.props.filteredFiles.length) + " / " + String(this.props.files.length)
    })
  }

  /** `React.Fragment`: renders the elements an expression holds. */
  get Fragment() {
    return Fragment
  }

  get content_const_spec_view() {
    return this.memo('content_const_spec_view', [this.props, this.selectedIds, this.preSelectedIds, this.cursorId, this.handleItemSelect, this.setSelectedIds, this.lastSelectedIdxRef], () => {
      if (!(!(this.props.isLoading)) || !(!(this.props.hasError)) || !(!(this.props.folders.length === 0 && this.props.filteredFiles.length === 0)) || !(this.props.filteredFiles.length > 0)) return undefined as never
      return ({ children: (() => {
            const spec = VIEW_SPECS[this.props.view.viewMode]
            // Shared selection props → same behaviour across every layout.
            const sel = (file: FileItem) => ({
              selected: this.selectedIds.has(file.id), preSelected: this.preSelectedIds.has(file.id), focused: this.cursorId === file.id, canMove: !this.props.trashed,
              onSelect: this.handleItemSelect,
              onDragStart: () => { if (!this.selectedIds.has(file.id)) { this.setSelectedIds(new Set([file.id])); this.lastSelectedIdxRef.current = this.props.orderedIds.indexOf(file.id) } this.props.setDraggingItem({ type: 'file', id: file.id }) },
            })
            if (spec.kind === 'icons') {
              return (
                <div className="grid" style={{ gridTemplateColumns: `repeat(auto-fill,minmax(${spec.min}px,1fr))`, gap: 24 }}>
                  {this.props.filteredFiles.map(file => (
                    <FileCard
                      key={file.id}
                      file={file}
                      trashed={this.props.trashed}
                      selected={this.selectedIds.has(file.id)}
                      preSelected={this.preSelectedIds.has(file.id)}
                      focused={this.cursorId === file.id}
                      onSelect={this.handleItemSelect}
                      onContextMenu={e => this.props.onOpenMenu(e, 'file', file)}
                      onDragStart={() => {
                        if (!this.selectedIds.has(file.id)) { this.setSelectedIds(new Set([file.id])); this.lastSelectedIdxRef.current = this.props.orderedIds.indexOf(file.id) }
                        this.props.setDraggingItem({ type: 'file', id: file.id })
                      }}
                      onRestore={() => this.props.onRestoreFile(file.id)}
                      onDelete={() => this.props.onDeleteFile(file.id)}
                      onOpen={() => this.props.onOpenFile(file)}
                      thumbH={spec.thumbH}
                      iconScale={spec.iconScale}
                      dense={spec.dense}
                    />
                  ))}
                </div>
              )
            }
            if (spec.multicol) {
              return (
                <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))', gap: 2 }}>
                  {this.props.filteredFiles.map(file => (
                    <FileRow key={file.id} file={file} trashed={this.props.trashed} {...sel(file)} onContextMenu={e => this.props.onOpenMenu(e, 'file', file)} onRestore={() => this.props.onRestoreFile(file.id)} onDelete={() => this.props.onDeleteFile(file.id)} onOpen={() => this.props.onOpenFile(file)} density="compact" hideMeta />
                  ))}
                </div>
              )
            }
            return (
              <div className="divide-y divide-border rounded-xl border border-border overflow-hidden">
                {this.props.filteredFiles.map(file => (
                  <FileRow key={file.id} file={file} trashed={this.props.trashed} {...sel(file)} onContextMenu={e => this.props.onOpenMenu(e, 'file', file)} onRestore={() => this.props.onRestoreFile(file.id)} onDelete={() => this.props.onDeleteFile(file.id)} onOpen={() => this.props.onOpenFile(file)} density={spec.density} />
                ))}
              </div>
            )
          })() })
    })
  }

}

/** What `useStores()` gives (the types of the fields it fills). */
export type DriveContentGridStores = ReturnType<DriveContentGrid['useStores']>

export default DriveContentGrid.component()
