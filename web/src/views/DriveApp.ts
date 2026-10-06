/**
 * Code-behind of `DriveApp.kbview` (converted from `DriveApp.tsx` by @kubuno/views-migrate).
 */
import { bind, type EventArgs } from '@kubuno/views'
import { useCallback, useEffect, useMemo } from "react"
import { useTranslation } from "react-i18next"
import { useSearchParams } from "react-router-dom"
import { StorageExplorer, localSource, useFilesStore, type FileItem } from "@kubuno/drive"
import { api, useAuthStore, useConfirm, type User } from "@kubuno/sdk"
import { ConfirmDialog } from "@ui"
import { useDriveExtras } from "../model/driveExtras"
import { recentSource, starredSource, sharedSource, suggestionsSource } from "../services/driveSources"
import DriveContextMenu from "../drive-app/DriveContextMenu"
import DriveDialogs from "../drive-app/DriveDialogs"
import DriveViewersLayer from "../drive-app/DriveViewersLayer"
import { isPreviewable } from "../drive-app/fileKinds"
import { useDriveBulkActions } from "../drive-app/useDriveBulkActions"
import { useDriveDialogs } from "../drive-app/useDriveDialogs"
import { useDriveImport } from "../drive-app/useDriveImport"
import { useDriveItemMenu } from "../drive-app/useDriveItemMenu"
import { useDriveListing } from "../drive-app/useDriveListing"
import { useDriveMutations } from "../drive-app/useDriveMutations"
import { useDriveSearchUrlSync } from "../drive-app/useDriveSearchUrlSync"
import { useDriveSelection } from "../drive-app/useDriveSelection"
import { useDriveViewers } from "../drive-app/useDriveViewers"
import { useDriveViewOptions } from "../drive-app/useDriveViewOptions"

import { ViewBase } from './DriveApp.kbview'
import * as __parts from './DriveApp.parts.tsx'

interface Props {
  starred?: boolean
  shared?:  boolean
  recent?:  boolean
  trashed?: boolean
  suggestions?: boolean
}

export type { Props }

export class DriveApp extends ViewBase {
  @bind accessor searchPreviewFiles: FileItem[] = []
  tr!: DriveAppStores['t']
  searchParams!: URLSearchParams
  setSearchParams!: DriveAppStores['setSearchParams']
  driveSource!: DriveAppStores['driveSource']
  recentSrc!: DriveAppStores['recentSrc']
  starredSrc!: DriveAppStores['starredSrc']
  sharedSrc!: DriveAppStores['sharedSrc']
  suggestionsSrc!: DriveAppStores['suggestionsSrc']
  confirm!: DriveAppStores['confirm']
  confirmState!: DriveAppStores['confirmState']
  handleConfirm!: () => void
  handleCancel!: () => void
  refreshKey!: number
  openNewFolder!: () => void
  setCurrentFolderId!: (id: string | null) => void
  searchQuery!: string
  searchFilters!: DriveAppStores['searchFilters']
  searchApplied!: boolean
  clearSearch!: () => void
  imageSearch!: DriveAppStores['imageSearch']
  clearImageSearch!: () => void
  refreshUser!: () => void
  view!: DriveAppStores['view']
  listing!: DriveAppHooks['listing']
  viewers!: DriveAppStores['viewers']
  dialogs!: DriveAppStores['dialogs']
  selection!: DriveAppHooks['selection']
  mutations!: DriveAppHooks['mutations']
  imports!: DriveAppHooks['imports']
  bulk!: { compressSelection: () => Promise<void>; trashSelection: () => void; deleteSelection: () => void; restoreSelection: () => void; emptyTrash: () => Promise<void>; clearSelection: () => void; }
  itemMenu!: DriveAppHooks['itemMenu']
  previewNavFiles!: FileItem[]
  hasProtectedInSelection!: boolean
  hasPlayingInSelection!: boolean

  /** The screen's hooks that read nothing of the view (stores, translations…), as the TSX called them. React's rules apply: `use()` runs them on every render. */
  useStores() {
    const { t } = useTranslation('drive')
    const [searchParams, setSearchParams] = useSearchParams()
    const driveSource = useMemo(() => localSource(), [])
    const recentSrc      = useMemo(() => recentSource(), [])
    const starredSrc     = useMemo(() => starredSource(), [])
    const sharedSrc      = useMemo(() => sharedSource(), [])
    const suggestionsSrc = useMemo(() => suggestionsSource(), [])
    const { confirm, confirmState, handleConfirm, handleCancel } = useConfirm()
    const {
      refreshKey,
      openNewFolder,
      setCurrentFolderId,
      searchQuery, searchFilters, searchApplied, clearSearch,
      imageSearch, clearImageSearch,
    } = useFilesStore()
    const { updateUser } = useAuthStore()
    const refreshUser = useCallback(() => {
      api.get<{ user: User }>('/me').then(res => updateUser(res.data.user)).catch(() => {})
    }, [updateUser])
    useEffect(() => { void useDriveExtras.getState().loadAll().catch(() => {}) }, [])
    useDriveSearchUrlSync(searchQuery)
    const view      = useDriveViewOptions()
    const viewers   = useDriveViewers()
    const dialogs   = useDriveDialogs()
    return { t, searchParams, setSearchParams, driveSource, recentSrc, starredSrc, sharedSrc, suggestionsSrc, confirm, confirmState, handleConfirm, handleCancel, refreshKey, openNewFolder, setCurrentFolderId, searchQuery, searchFilters, searchApplied, clearSearch, imageSearch, clearImageSearch, updateUser, refreshUser, view, viewers, dialogs }
  }

  /** The screen's hooks that read its members (run after the fields of `useStores()` are set). React's rules apply: `use()` runs them on every render. */
  useHooks() {
    const confirm = this.confirm
    const refreshKey = this.refreshKey
    const setCurrentFolderId = this.setCurrentFolderId
    const refreshUser = this.refreshUser
    const view = this.view
    const viewers = this.viewers
    const dialogs = this.dialogs
    const folderId = this.folderId
    useEffect(() => { setCurrentFolderId(folderId); return () => setCurrentFolderId(null) }, [folderId, setCurrentFolderId])
    const listing   = useDriveListing({ folderId: this.folderId, starred: this.starred, shared: this.shared, recent: this.recent, trashed: this.trashed, refreshKey, view })
    this.publish({ listing })
    const selection = useDriveSelection({
      orderedIds: listing.orderedIds,
      folders:    listing.folders,
      files:      listing.files,
      trashed: this.trashed,
      openFile:   viewers.openFile,
      navigate: this.memo("navigate:bound", [], () => this.navigate.bind(this)),
    })
    this.publish({ selection })
    const mutations = useDriveMutations({ folderId: this.folderId, navigate: this.memo("navigate:bound", [], () => this.navigate.bind(this)), confirm, refreshUser })
    this.publish({ mutations })
    const imports   = useDriveImport({
      folderId: this.folderId,
      selectedIds: selection.selectedIds,
      itemTypeMap: listing.itemTypeMap,
      refreshUser,
    })
    this.publish({ imports })
    const bulk = useDriveBulkActions({
      folderId: this.folderId,
      selectedIds:    selection.selectedIds,
      setSelectedIds: selection.setSelectedIds,
      itemTypeMap:    listing.itemTypeMap,
      mutations,
      confirm,
    })
    this.publish({ bulk })
    const itemMenu = useDriveItemMenu({
      folderId: this.folderId,
      folders:     listing.folders,
      files:       listing.files,
      orderedIds:  listing.orderedIds,
      itemTypeMap: listing.itemTypeMap,
      selectedIds:        selection.selectedIds,
      setSelectedIds:     selection.setSelectedIds,
      lastSelectedIdxRef: selection.lastSelectedIdxRef,
      playingFileIds:     viewers.playingFileIds,
      dialogs,
      mutations,
      confirm,
    })
    this.publish({ itemMenu })
    const previewNavFiles = useMemo(
      () => (this.isSearchMode ? this.searchPreviewFiles : listing.filteredFiles.filter(isPreviewable)),
      [this.isSearchMode, this.searchPreviewFiles, listing.filteredFiles],
    )
    this.publish({ previewNavFiles })
    const hasProtectedInSelection = useMemo(
      () => listing.folders.some(f => f.is_protected && selection.selectedIds.has(f.id)),
      [listing.folders, selection.selectedIds],
    )
    this.publish({ hasProtectedInSelection })
    const hasPlayingInSelection = useMemo(
      () => [...selection.selectedIds].some(id => viewers.playingFileIds.has(id)),
      [selection.selectedIds, viewers.playingFileIds],
    )
    this.publish({ hasPlayingInSelection })
    return { listing, selection, mutations, imports, bulk, itemMenu, previewNavFiles, hasProtectedInSelection, hasPlayingInSelection }
  }

  /** Runs the hooks and publishes what they give as fields (the bindings, the getters and the methods read them). */
  use(): void {
    const s = this.useStores()
    this.publish({ tr: s.t, searchParams: s.searchParams, setSearchParams: s.setSearchParams, driveSource: s.driveSource, recentSrc: s.recentSrc, starredSrc: s.starredSrc, sharedSrc: s.sharedSrc, suggestionsSrc: s.suggestionsSrc, confirm: s.confirm, confirmState: s.confirmState, handleConfirm: s.handleConfirm, handleCancel: s.handleCancel, refreshKey: s.refreshKey, openNewFolder: s.openNewFolder, setCurrentFolderId: s.setCurrentFolderId, searchQuery: s.searchQuery, searchFilters: s.searchFilters, searchApplied: s.searchApplied, clearSearch: s.clearSearch, imageSearch: s.imageSearch, clearImageSearch: s.clearImageSearch, refreshUser: s.refreshUser, view: s.view, viewers: s.viewers, dialogs: s.dialogs })
    const h = this.useHooks()
    this.publish({ listing: h.listing, selection: h.selection, mutations: h.mutations, imports: h.imports, bulk: h.bulk, itemMenu: h.itemMenu, previewNavFiles: h.previewNavFiles, hasProtectedInSelection: h.hasProtectedInSelection, hasPlayingInSelection: h.hasPlayingInSelection })
  }

  get starred() {
    return this.props.starred ?? false
  }

  get shared() {
    return this.props.shared ?? false
  }

  get recent() {
    return this.props.recent ?? false
  }

  get trashed() {
    return this.props.trashed ?? false
  }

  get suggestions() {
    return this.props.suggestions ?? false
  }

  get folderId(): string | null {
    return (this.starred || this.shared || this.recent || this.trashed || this.suggestions) ? null : (this.searchParams.get('folder') ?? null)
  }

  get isSearchMode(): boolean {
    return this.searchApplied || this.searchQuery.trim().length > 0
  }

  get isPlainNormal(): boolean {
    return !this.imageSearch && !this.isSearchMode && !this.starred && !this.shared && !this.recent && !this.trashed && !this.suggestions
  }

  get searchActive(): boolean {
    return this.isSearchMode || !!this.imageSearch
  }

  get specialSource() {
    return this.memo('specialSource', [this.searchActive, this.recent, this.recentSrc, this.starred, this.starredSrc, this.shared, this.sharedSrc, this.suggestions, this.suggestionsSrc], () => this.searchActive ? null
                      : this.recent ? this.recentSrc
                      : this.starred ? this.starredSrc
                      : this.shared ? this.sharedSrc
                      : this.suggestions ? this.suggestionsSrc
                      : null)
  }

  get specialTitle(): string {
    return this.recent ? this.tr('nav.recent', { defaultValue: 'Récents' })
                      : this.starred ? this.tr('tree.starred', { defaultValue: 'Étoilés' })
                      : this.shared ? this.tr('nav.shared', { defaultValue: 'Partagés avec moi' })
                      : this.suggestions ? this.tr('nav.home', { defaultValue: 'Accueil' })
                      : ''
  }

  get pageTitle(): string | null {
    return this.trashed ? this.tr('nav.trash')
    : this.starred ? this.tr('tree.starred')
    : this.shared  ? this.tr('nav.shared')
    : this.recent  ? this.tr('nav.recent')
    : null
  }

  get part1_props() {
    return this.memo('part1_props', [this.imports], () => ({ imports: this.imports }))
  }

  /** A part of the screen still written in React (<input> has no .kbview element yet). */
  get Part1() {
    return __parts.Part1
  }

  /** A part of the screen still written in React (<input> has no .kbview element yet). */
  get Part2() {
    return __parts.Part2
  }

  get show_imports_is_drag_over_is_plain_normal() {
    return this.imports.isDragOver && !this.isPlainNormal
  }

  /** `<StorageExplorer>`, rendered by a ReactHost. */
  get StorageExplorer() {
    if (!(this.isPlainNormal)) return undefined as never
    return StorageExplorer
  }

  get storage_explorer_props() {
    return this.memo('storage_explorer_props', [this.driveSource, this.tr, this.viewers, this.itemMenu, this.isPlainNormal], () => {
      if (!(this.isPlainNormal)) return undefined as never
      return ({ source: this.driveSource, pathParam: "folder", title: this.tr('nav.my_drive', { defaultValue: 'Mon Drive' }), onOpenFile: f => { this.viewers.openFile(f); return true }, fileContextActions: this.itemMenu.driveContextActions } as React.ComponentProps<typeof StorageExplorer>)
    })
  }

  get show_special_source() {
    return this.memo('show_special_source', [this.specialSource], () => !!(this.specialSource))
  }

  /** `<StorageExplorer>`, rendered by a ReactHost. */
  get StorageExplorer2() {
    if (!(this.specialSource)) return undefined as never
    return StorageExplorer
  }

  get storage_explorer_props2() {
    return this.memo('storage_explorer_props2', [this.specialSource, this.specialTitle, this.viewers, this.shared, this.itemMenu], () => {
      if (!(this.specialSource)) return undefined as never
      return ({ source: this.specialSource, title: this.specialTitle, onOpenFile: f => { this.viewers.openFile(f); return true }, fileContextActions: this.shared ? [] : this.itemMenu.driveContextActions } as React.ComponentProps<typeof StorageExplorer>)
    })
  }

  get show_is_plain_normal_special_source() {
    return !this.isPlainNormal && !this.specialSource
  }

  get part3_props() {
    return this.memo('part3_props', [this.selection, this.imageSearch, this.clearImageSearch, this.viewers, this.isSearchMode, this.searchQuery, this.searchFilters, this.clearSearch, this.memo, this.searchPreviewFiles, this.listing, this.pageTitle, this.tr, this.setSearchParams, this.trashed, this.starred, this.shared, this.recent, this.hasProtectedInSelection, this.hasPlayingInSelection, this.mutations, this.bulk, this.imports, this.openNewFolder, this.view, this.itemMenu, this.isPlainNormal, this.specialSource], () => {
      if (!(!this.isPlainNormal && !this.specialSource)) return undefined as never
      return ({ selection: this.selection, imageSearch: this.imageSearch, clearImageSearch: this.clearImageSearch, viewers: this.viewers, isSearchMode: this.isSearchMode, searchQuery: this.searchQuery, searchFilters: this.searchFilters, clearSearch: this.clearSearch, setSearchPreviewFiles: this.memo("setSearchPreviewFiles:bound", [], () => this.setSearchPreviewFiles.bind(this)), listing: this.listing, pageTitle: this.pageTitle, t: this.tr, navigate: this.memo("navigate:bound", [], () => this.navigate.bind(this)), trashed: this.trashed, starred: this.starred, shared: this.shared, recent: this.recent, hasProtectedInSelection: this.hasProtectedInSelection, hasPlayingInSelection: this.hasPlayingInSelection, mutations: this.mutations, bulk: this.bulk, imports: this.imports, openNewFolder: this.openNewFolder, view: this.view, itemMenu: this.itemMenu })
    })
  }

  /** A part of the screen still written in React (<div ref onPointerDown onPointerMove onPointerUp onPointerCancel>: attribute(s) without a .kbview property). */
  get Part3() {
    if (!(!this.isPlainNormal && !this.specialSource)) return undefined as never
    return __parts.Part3
  }

  get show_item_menu_menu_item_menu() {
    return this.memo('show_item_menu_menu_item_menu', [this.itemMenu], () => !!(this.itemMenu.menu && this.itemMenu.menuHandlers))
  }

  /** `<DriveContextMenu>`, rendered by a ReactHost. */
  get DriveContextMenu() {
    if (!(this.itemMenu.menu && this.itemMenu.menuHandlers)) return undefined as never
    return DriveContextMenu
  }

  get drive_context_menu_props() {
    return this.memo('drive_context_menu_props', [this.itemMenu], () => {
      if (!(this.itemMenu.menu && this.itemMenu.menuHandlers)) return undefined as never
      return ({ menu: this.itemMenu.menu, handlers: this.itemMenu.menuHandlers, onClose: this.itemMenu.closeMenu })
    })
  }

  get show_selection_marquee_style_selection() {
    return !!(this.selection.marqueeStyle && this.selection.marqueeStyle.width > 2 && this.selection.marqueeStyle.height > 2)
  }

  get part4_props() {
    return this.memo('part4_props', [this.selection], () => {
      if (!(this.selection.marqueeStyle && this.selection.marqueeStyle.width > 2 && this.selection.marqueeStyle.height > 2)) return undefined as never
      return ({ selection_marqueeStyle: this.selection?.marqueeStyle })
    })
  }

  /** A part of the screen still written in React (<div> with a computed style). */
  get Part4() {
    if (!(this.selection.marqueeStyle && this.selection.marqueeStyle.width > 2 && this.selection.marqueeStyle.height > 2)) return undefined as never
    return __parts.Part4
  }

  /** `<DriveDialogs>`, rendered by a ReactHost. */
  get DriveDialogs() {
    return DriveDialogs
  }

  get drive_dialogs_props() {
    return this.memo('drive_dialogs_props', [this.dialogs, this.folderId, this.listing, this.viewers, this.imports], () => ({ dialogs: this.dialogs, folderId: this.folderId, folders: this.listing.folders, files: this.listing.files, archiveFile: this.viewers.archiveFile, onCloseArchive: () => this.viewers.setArchiveFile(null), onOpenFile: this.viewers.openFile, conflictDialog: this.imports.conflictDialog } as React.ComponentProps<typeof DriveDialogs>))
  }

  /** `<DriveViewersLayer>`, rendered by a ReactHost. */
  get DriveViewersLayer() {
    return DriveViewersLayer
  }

  get drive_viewers_layer_props() {
    return this.memo('drive_viewers_layer_props', [this.viewers, this.dialogs, this.previewNavFiles, this.itemMenu], () => ({ viewers: this.viewers, dialogs: this.dialogs, previewNavFiles: this.previewNavFiles, openWithItemsFor: this.itemMenu.openWithItemsFor }))
  }

  get show_confirm_state() {
    return this.memo('show_confirm_state', [this.confirmState], () => !!(this.confirmState))
  }

  /** `<ConfirmDialog>`, rendered by a ReactHost. */
  get ConfirmDialog() {
    if (!(this.confirmState)) return undefined as never
    return ConfirmDialog
  }

  get confirm_dialog_props() {
    return this.memo('confirm_dialog_props', [this.confirmState, this.handleConfirm, this.handleCancel], () => {
      if (!(this.confirmState)) return undefined as never
      return ({ ...this.confirmState, onConfirm: this.handleConfirm, onCancel: this.handleCancel })
    })
  }

  navigate(id: string | null) {
    if (id) this.setSearchParams({ folder: id })
    else this.setSearchParams({})
  }

  stack_drag_enter(_sender: unknown, args: EventArgs) {
    return (this.imports.handleDragEnter)?.(args.native as never)
  }

  stack_drag_leave(_sender: unknown, args: EventArgs) {
    return (this.imports.handleDragLeave)?.(args.native as never)
  }

  stack_drag_over(_sender: unknown, args: EventArgs) {
    return (this.imports.handleDragOver)?.(args.native as never)
  }

  stack_drag_drop(_sender: unknown, args: EventArgs) {
    const e = args.native as React.DragEvent<HTMLDivElement>
    this.imports.handleDrop(e)
  }

  /** `setSearchPreviewFiles` of the TSX: a value, or an update of the previous one. */
  setSearchPreviewFiles(value: FileItem[] | ((prev: FileItem[]) => FileItem[])) {
    this.searchPreviewFiles = typeof value === 'function' ? (value as (prev: FileItem[]) => FileItem[])(this.searchPreviewFiles) : value
  }

}

/** What `useStores()` gives (the types of the fields it fills). */
export type DriveAppStores = ReturnType<DriveApp['useStores']>

/** What `useHooks()` gives (the types of the fields it fills). */
export type DriveAppHooks = ReturnType<DriveApp['useHooks']>

export default DriveApp.component()
