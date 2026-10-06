/**
 * Code-behind of `FilesTreeSidebar.kbview` (converted from `FilesTreeSidebar.tsx` by @kubuno/views-migrate).
 */
import { bind } from '@kubuno/views'
import { useMemo, useEffect } from "react"
import { useLocation, useNavigate, useSearchParams } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Star, Clock, Trash2, Share2, HardDrive, FolderPlus, RefreshCw, Plug, Settings2, ExternalLink, Columns2, ServerCog, Cloud, Home } from "lucide-react"
import { type MenuItem, ConfirmDialog } from "@ui"
import { filesApi, type Folder, type RemoteConnection } from "@kubuno/drive"
import { useConfirm, useAuthStore } from "@kubuno/sdk"
import { useFilesStore, type FilesSearchFilters } from "@kubuno/drive"
import { useDriveExtras, type SavedSearch } from "./driveExtras"
import { useFilesContextMenuStore } from "./filesContextMenuStore"
import { SidebarNavItem, useModulesStore, ModuleServiceRegistry } from "@kubuno/sdk"
import { useIsMobile } from "./openable"
import { fromHash } from "./hashRoute"

import { ViewBase } from './FilesTreeSidebar.kbview'
import * as __parts from './FilesTreeSidebar.parts'

export type FilesTreeSidebarProps = { collapsed?: boolean }

export class FilesTreeSidebar extends ViewBase {
  @bind accessor mountsVersion = 0
  @bind accessor ctx: { x: number; y: number; items: MenuItem[] } | null = null
  tr!: FilesTreeSidebarStores['t']
  isMobile!: boolean
  pathname!: string
  hash!: string
  searchParams!: URLSearchParams
  navigate!: FilesTreeSidebarStores['navigate']
  currentFolderId!: string | null
  refreshKey!: number
  openNewFolder!: () => void
  openRemotesPanel!: () => void
  setSearchQuery!: (q: string) => void
  setSearchFilters!: (partial: Partial<FilesSearchFilters>) => void
  applySearch!: () => void
  savedSearches!: SavedSearch[]
  deleteSavedSearch!: (id: string) => Promise<void>
  openFolderMenu!: ((folder: Folder, x: number, y: number) => void) | null
  contextMenuFolderId!: string | null
  setContextMenuFolderId!: (id: string | null) => void
  qc!: FilesTreeSidebarStores['qc']
  confirm!: FilesTreeSidebarStores['confirm']
  confirmState!: FilesTreeSidebarStores['confirmState']
  handleConfirm!: () => void
  handleCancel!: () => void
  isAdmin!: boolean
  activeModules!: FilesTreeSidebarStores['activeModules']
  moduleMounts!: { moduleId: string; key: string; name: string; }[]
  remotes!: FilesTreeSidebarStores['remotes']

  /** The screen's hooks that read nothing of the view (stores, translations…), as the TSX called them. React's rules apply: `use()` runs them on every render. */
  useStores() {
    const { t } = useTranslation('drive')
    const isMobile = useIsMobile()
    const { pathname, hash } = useLocation()
    const [searchParams] = useSearchParams()
    const navigate = useNavigate()
    const { currentFolderId, refreshKey, openNewFolder, openRemotesPanel,
            setSearchQuery, setSearchFilters, applySearch } = useFilesStore()
    const savedSearches      = useDriveExtras(s => s.savedSearches)
    const deleteSavedSearch  = useDriveExtras(s => s.deleteSavedSearch)
    const { openFolderMenu, contextMenuFolderId, setContextMenuFolderId } = useFilesContextMenuStore()
    const qc = useQueryClient()
    const { confirm, confirmState, handleConfirm, handleCancel } = useConfirm()
    const isAdmin = useAuthStore(s => s.user?.role === 'admin')
    const activeModules = useModulesStore(s => s.activeModules)
    const { data: remotes = [] } = useQuery({ queryKey: ['remotes'], queryFn: filesApi.listRemotes })
    return { t, isMobile, pathname, hash, searchParams, navigate, currentFolderId, refreshKey, openNewFolder, openRemotesPanel, setSearchQuery, setSearchFilters, applySearch, savedSearches, deleteSavedSearch, openFolderMenu, contextMenuFolderId, setContextMenuFolderId, qc, confirm, confirmState, handleConfirm, handleCancel, isAdmin, activeModules, remotes }
  }

  /** The screen's hooks that read its members (run after the fields of `useStores()` are set). React's rules apply: `use()` runs them on every render. */
  useHooks() {
    const hash = this.hash
    const savedSearches = this.savedSearches
    const activeModules = this.activeModules
    useEffect(() => {
      const target = fromHash(hash)
      if (!target || target.kind !== 'search') return
      const saved = savedSearches.find(s => s.id === target.id)
      if (saved) this.applySaved(saved)
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hash, savedSearches])
    useEffect(() => {
      const h = () => this.mountsVersion = this.mountsVersion + 1
      window.addEventListener('kubuno:module-mounts-changed', h)
      return () => window.removeEventListener('kubuno:module-mounts-changed', h)
    }, [])
    const moduleMounts = useMemo(
      () => activeModules.flatMap(m => {
        const list = ModuleServiceRegistry.call<Array<{ key: string; name: string }>>(m.module_id, 'getStorageMounts')
        return (list ?? []).map(x => ({ moduleId: m.module_id, key: x.key, name: x.name }))
      }),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [activeModules, this.mountsVersion],
    )
    this.publish({ moduleMounts })
    return { moduleMounts }
  }

  /** Runs the hooks and publishes what they give as fields (the bindings, the getters and the methods read them). */
  use(): void {
    const s = this.useStores()
    this.publish({ tr: s.t, isMobile: s.isMobile, pathname: s.pathname, hash: s.hash, searchParams: s.searchParams, navigate: s.navigate, currentFolderId: s.currentFolderId, refreshKey: s.refreshKey, openNewFolder: s.openNewFolder, openRemotesPanel: s.openRemotesPanel, setSearchQuery: s.setSearchQuery, setSearchFilters: s.setSearchFilters, applySearch: s.applySearch, savedSearches: s.savedSearches, deleteSavedSearch: s.deleteSavedSearch, openFolderMenu: s.openFolderMenu, contextMenuFolderId: s.contextMenuFolderId, setContextMenuFolderId: s.setContextMenuFolderId, qc: s.qc, confirm: s.confirm, confirmState: s.confirmState, handleConfirm: s.handleConfirm, handleCancel: s.handleCancel, isAdmin: s.isAdmin, activeModules: s.activeModules, remotes: s.remotes })
    const h = this.useHooks()
    this.publish({ moduleMounts: h.moduleMounts })
  }

  get collapsed() {
    return this.props.collapsed ?? false
  }

  get moduleMatch() {
    return this.memo('moduleMatch', [this.pathname], () => this.pathname.match(/^\/drive\/m\/([^/]+)\/([^/]+)/))
  }

  get activeModuleId(): string | null {
    return this.moduleMatch ? this.moduleMatch[1] : null
  }

  get activeMountKey(): string | null {
    return this.moduleMatch ? this.moduleMatch[2] : null
  }

  get activeMountPath(): string {
    return this.moduleMatch ? (this.searchParams.get('path') ?? '') : ''
  }

  get remoteMatch() {
    return this.memo('remoteMatch', [this.pathname], () => this.pathname.match(/^\/drive\/remote\/([^/]+)/))
  }

  get activeRemoteId(): string | null {
    return this.remoteMatch ? this.remoteMatch[1] : null
  }

  get activeRemotePath(): string {
    return this.activeRemoteId ? (this.searchParams.get('path') ?? '') : ''
  }

  get isSpecial(): boolean {
    return ['/drive/home', '/drive/recent', '/drive/starred', '/drive/shared', '/drive/trash', '/drive/settings', '/drive/storage', '/drive/remote', '/drive/split', '/drive/system', '/drive/m'].some(
    p => this.pathname === p || this.pathname.startsWith(p + '/'),
  )
  }

  get isInDrive(): boolean {
    return !this.isSpecial
  }

  get isHome(): boolean {
    return this.pathname === '/drive/home'
  }

  get isRecent(): boolean {
    return this.pathname === '/drive/recent'
  }

  get isStarred(): boolean {
    return this.pathname === '/drive/starred'
  }

  get isShared(): boolean {
    return this.pathname === '/drive/shared'
  }

  get isTrashed(): boolean {
    return this.pathname === '/drive/trash'
  }

  get isSystem(): boolean {
    return this.pathname === '/drive/system'
  }

  get show_case_1() {
    return !!(this.isMobile && !this.collapsed)
  }

  /** `<MobileDrawerNav>`, rendered by a ReactHost. */
  get MobileDrawerNav() {
    if (!(this.isMobile && !this.collapsed)) return undefined as never
    return __parts.MobileDrawerNav
  }

  get mobile_drawer_nav_props() {
    return this.memo('mobile_drawer_nav_props', [this.tr, this.pathname, this.isInDrive, this.isRecent, this.isTrashed, this.isSystem, this.isAdmin, this.moduleMounts, this.remotes, this.isMobile, this.collapsed], () => {
      if (!(this.isMobile && !this.collapsed)) return undefined as never
      return ({ t: this.tr, pathname: this.pathname, isInDrive: this.isInDrive, isRecent: this.isRecent, isTrashed: this.isTrashed, isSystem: this.isSystem, isAdmin: this.isAdmin, moduleMounts: this.moduleMounts, remotes: this.remotes })
    })
  }

  get show_case_2() {
    return !(this.isMobile && !this.collapsed) && !!(this.collapsed)
  }

  /** `<SidebarNavItem>`, rendered by a ReactHost. */
  get SidebarNavItem() {
    if (!(!(this.isMobile && !this.collapsed)) || !(this.collapsed)) return undefined as never
    return SidebarNavItem
  }

  get sidebar_nav_item_props() {
    return this.memo('sidebar_nav_item_props', [this.tr, this.isHome, this.isMobile, this.collapsed], () => {
      if (!(!(this.isMobile && !this.collapsed)) || !(this.collapsed)) return undefined as never
      return ({ collapsed: true, label: this.tr('nav.home', { defaultValue: 'Accueil' }), icon: <Home size={20} />, active: this.isHome, to: "/drive/home" })
    })
  }

  get sidebar_nav_item_props2() {
    return this.memo('sidebar_nav_item_props2', [this.tr, this.isInDrive, this.isMobile, this.collapsed], () => {
      if (!(!(this.isMobile && !this.collapsed)) || !(this.collapsed)) return undefined as never
      return ({ collapsed: true, label: this.tr('tree.my_drive', { defaultValue: 'Mon Drive' }), icon: <HardDrive size={20} />, active: this.isInDrive, to: "/drive" })
    })
  }

  /** The rows of the Repeater over `moduleMounts`. */
  get rows_module_mounts() {
    return this.memo('rows_module_mounts', [this.moduleMounts, this.isMobile, this.collapsed, this.pathname], () => {
      if (!(!(this.isMobile && !this.collapsed)) || !(this.collapsed)) return undefined as never
      return this.moduleMounts.map((mt) => {
      return { mt, sidebar_nav_item_props: ((!(this.isMobile && !this.collapsed)) && (this.collapsed)) ? ({ collapsed: true, label: mt.name, icon: <Cloud size={20} />, active: this.pathname === `/drive/m/${mt.moduleId}/${mt.key}`, to: `/drive/m/${mt.moduleId}/${mt.key}` }) : undefined, key: `${mt.moduleId}:${mt.key}` }
    })
    })
  }

  get sidebar_nav_item_props3() {
    return this.memo('sidebar_nav_item_props3', [this.tr, this.isShared, this.isMobile, this.collapsed], () => {
      if (!(!(this.isMobile && !this.collapsed)) || !(this.collapsed)) return undefined as never
      return ({ collapsed: true, label: this.tr('nav.shared'), icon: <Share2 size={20} />, active: this.isShared, to: "/drive/shared" })
    })
  }

  get sidebar_nav_item_props4() {
    return this.memo('sidebar_nav_item_props4', [this.tr, this.isRecent, this.isMobile, this.collapsed], () => {
      if (!(!(this.isMobile && !this.collapsed)) || !(this.collapsed)) return undefined as never
      return ({ collapsed: true, label: this.tr('nav.recent'), icon: <Clock size={20} />, active: this.isRecent, to: "/drive/recent" })
    })
  }

  get sidebar_nav_item_props5() {
    return this.memo('sidebar_nav_item_props5', [this.tr, this.isStarred, this.isMobile, this.collapsed], () => {
      if (!(!(this.isMobile && !this.collapsed)) || !(this.collapsed)) return undefined as never
      return ({ collapsed: true, label: this.tr('tree.starred'), icon: <Star size={20} />, active: this.isStarred, to: "/drive/starred" })
    })
  }

  get sidebar_nav_item_props6() {
    return this.memo('sidebar_nav_item_props6', [this.tr, this.isTrashed, this.isMobile, this.collapsed], () => {
      if (!(!(this.isMobile && !this.collapsed)) || !(this.collapsed)) return undefined as never
      return ({ collapsed: true, label: this.tr('nav.trash'), icon: <Trash2 size={20} />, active: this.isTrashed, to: "/drive/trash" })
    })
  }

  get sidebar_nav_item_props7() {
    return this.memo('sidebar_nav_item_props7', [this.tr, this.pathname, this.isMobile, this.collapsed], () => {
      if (!(!(this.isMobile && !this.collapsed)) || !(this.collapsed)) return undefined as never
      return ({ collapsed: true, label: this.tr('dual.title', { defaultValue: 'Deux volets' }), icon: <Columns2 size={20} />, active: this.pathname === '/drive/split', to: "/drive/split" })
    })
  }

  /** `<SidebarNavItem>`, rendered by a ReactHost. */
  get SidebarNavItem2() {
    if (!(!(this.isMobile && !this.collapsed)) || !(this.collapsed) || !(this.isAdmin)) return undefined as never
    return SidebarNavItem
  }

  get sidebar_nav_item_props8() {
    return this.memo('sidebar_nav_item_props8', [this.tr, this.isSystem, this.isMobile, this.collapsed, this.isAdmin], () => {
      if (!(!(this.isMobile && !this.collapsed)) || !(this.collapsed) || !(this.isAdmin)) return undefined as never
      return ({ collapsed: true, label: this.tr('nav.system', { defaultValue: 'Système' }), icon: <ServerCog size={20} />, active: this.isSystem, to: "/drive/system" })
    })
  }

  get show_main() {
    return !(this.isMobile && !this.collapsed) && !(this.collapsed)
  }

  /** `<NavItem>`, rendered by a ReactHost. */
  get NavItem() {
    if (!(!(this.isMobile && !this.collapsed)) || !(!(this.collapsed))) return undefined as never
    return __parts.NavItem
  }

  get nav_item_props() {
    return this.memo('nav_item_props', [this.tr, this.isHome, this.isMobile, this.collapsed], () => {
      if (!(!(this.isMobile && !this.collapsed)) || !(!(this.collapsed))) return undefined as never
      return ({ icon: <Home size={20} />, label: this.tr('nav.home', { defaultValue: 'Accueil' }), isActive: this.isHome, to: "/drive/home" })
    })
  }

  /** `<DriveRootSection>`, rendered by a ReactHost. */
  get DriveRootSection() {
    if (!(!(this.isMobile && !this.collapsed)) || !(!(this.collapsed))) return undefined as never
    return __parts.DriveRootSection
  }

  get drive_root_section_props() {
    return this.memo('drive_root_section_props', [this.currentFolderId, this.contextMenuFolderId, this.isInDrive, this.refreshKey, this.memo, this.isMobile, this.collapsed, this.setContextMenuFolderId, this.openFolderMenu, this.ctx, this.tr, this.openNewFolder, this.qc], () => {
      if (!(!(this.isMobile && !this.collapsed)) || !(!(this.collapsed))) return undefined as never
      return ({ activeFolderId: this.currentFolderId, contextMenuFolderId: this.contextMenuFolderId, isInDrive: this.isInDrive, refreshKey: this.refreshKey, linkFor: this.memo("folderLink:bound", [], () => this.folderLink.bind(this)), onContextMenu: this.memo("handleContextMenu:bound", [], () => this.handleContextMenu.bind(this)), onHeaderContextMenu: e => this.openCtx(e, this.driveMenuItems()) } as React.ComponentProps<typeof __parts.DriveRootSection>)
    })
  }

  /** `<ModuleMountSection>`, rendered by a ReactHost. */
  get ModuleMountSection() {
    if (!(!(this.isMobile && !this.collapsed)) || !(!(this.collapsed))) return undefined as never
    return __parts.ModuleMountSection
  }

  /** The rows of the Repeater over `moduleMounts`. */
  get rows_module_mounts2() {
    return this.memo('rows_module_mounts2', [this.moduleMounts, this.isMobile, this.collapsed, this.activeModuleId, this.activeMountKey, this.activeMountPath, this.ctx, this.tr, this.navigate, this.qc], () => {
      if (!(!(this.isMobile && !this.collapsed)) || !(!(this.collapsed))) return undefined as never
      return this.moduleMounts.map((mt) => {
      return { mt, module_mount_section_props: ((!(this.isMobile && !this.collapsed)) && (!(this.collapsed))) ? ({ moduleId: mt.moduleId, mountKey: mt.key, name: mt.name, isActiveMount: this.activeModuleId === mt.moduleId && this.activeMountKey === mt.key, activePath: this.activeMountPath, linkFor: path => this.moduleMountLink(mt.moduleId, mt.key, path), onHeaderContextMenu: e => this.openCtx(e, this.moduleMountMenuItems(mt)) } as React.ComponentProps<typeof __parts.ModuleMountSection>) : undefined, key: `${mt.moduleId}:${mt.key}` }
    })
    })
  }

  /** `<RemoteSection>`, rendered by a ReactHost. */
  get RemoteSection() {
    if (!(!(this.isMobile && !this.collapsed)) || !(!(this.collapsed))) return undefined as never
    return __parts.RemoteSection
  }

  /** The rows of the Repeater over `remotes`. */
  get rows_remotes() {
    return this.memo('rows_remotes', [this.remotes, this.isMobile, this.collapsed, this.activeRemoteId, this.activeRemotePath, this.memo, this.ctx, this.tr, this.navigate, this.qc, this.openRemotesPanel, this.confirm], () => {
      if (!(!(this.isMobile && !this.collapsed)) || !(!(this.collapsed))) return undefined as never
      return this.remotes.map((remote) => {
      return { remote, remote_section_props: ((!(this.isMobile && !this.collapsed)) && (!(this.collapsed))) ? ({ remote: remote, activeRemoteId: this.activeRemoteId, activePath: this.activeRemotePath, linkFor: this.memo("remoteLink:bound", [], () => this.remoteLink.bind(this)), onHeaderContextMenu: e => this.openCtx(e, this.remoteMenuItems(remote)) } as React.ComponentProps<typeof __parts.RemoteSection>) : undefined, key: remote.id }
    })
    })
  }

  get nav_item_props2() {
    return this.memo('nav_item_props2', [this.tr, this.isShared, this.isMobile, this.collapsed], () => {
      if (!(!(this.isMobile && !this.collapsed)) || !(!(this.collapsed))) return undefined as never
      return ({ icon: <Share2 size={20} />, label: this.tr('nav.shared'), isActive: this.isShared, to: "/drive/shared" })
    })
  }

  get nav_item_props3() {
    return this.memo('nav_item_props3', [this.tr, this.isRecent, this.isMobile, this.collapsed], () => {
      if (!(!(this.isMobile && !this.collapsed)) || !(!(this.collapsed))) return undefined as never
      return ({ icon: <Clock size={20} />, label: this.tr('nav.recent'), isActive: this.isRecent, to: "/drive/recent" })
    })
  }

  get nav_item_props4() {
    return this.memo('nav_item_props4', [this.tr, this.isStarred, this.isMobile, this.collapsed], () => {
      if (!(!(this.isMobile && !this.collapsed)) || !(!(this.collapsed))) return undefined as never
      return ({ icon: <Star size={20} />, label: this.tr('tree.starred'), isActive: this.isStarred, to: "/drive/starred" })
    })
  }

  get nav_item_props5() {
    return this.memo('nav_item_props5', [this.tr, this.isTrashed, this.isMobile, this.collapsed], () => {
      if (!(!(this.isMobile && !this.collapsed)) || !(!(this.collapsed))) return undefined as never
      return ({ icon: <Trash2 size={20} />, label: this.tr('nav.trash'), isActive: this.isTrashed, to: "/drive/trash" })
    })
  }

  get nav_item_props6() {
    return this.memo('nav_item_props6', [this.tr, this.pathname, this.isMobile, this.collapsed], () => {
      if (!(!(this.isMobile && !this.collapsed)) || !(!(this.collapsed))) return undefined as never
      return ({ icon: <Columns2 size={20} />, label: this.tr('dual.title', { defaultValue: 'Deux volets' }), isActive: this.pathname === '/drive/split', to: "/drive/split" })
    })
  }

  /** `<NavItem>`, rendered by a ReactHost. */
  get NavItem2() {
    if (!(!(this.isMobile && !this.collapsed)) || !(!(this.collapsed)) || !(this.isAdmin)) return undefined as never
    return __parts.NavItem
  }

  get nav_item_props7() {
    return this.memo('nav_item_props7', [this.tr, this.isSystem, this.isMobile, this.collapsed, this.isAdmin], () => {
      if (!(!(this.isMobile && !this.collapsed)) || !(!(this.collapsed)) || !(this.isAdmin)) return undefined as never
      return ({ icon: <ServerCog size={20} />, label: this.tr('nav.system', { defaultValue: 'Système' }), isActive: this.isSystem, to: "/drive/system" })
    })
  }

  get show_saved_searches() {
    if (!(!(this.isMobile && !this.collapsed)) || !(!(this.collapsed))) return undefined as never
    return this.savedSearches.length > 0
  }

  /** A part of the screen still written in React (<div {...spread}> (spread props)). */
  get Part1() {
    if (!(!(this.isMobile && !this.collapsed)) || !(!(this.collapsed)) || !(this.savedSearches.length > 0)) return undefined as never
    return __parts.Part1
  }

  /** The rows of the Repeater over `savedSearches`. */
  get rows_saved_searches() {
    return this.memo('rows_saved_searches', [this.savedSearches, this.isMobile, this.collapsed, this.deleteSavedSearch], () => {
      if (!(!(this.isMobile && !this.collapsed)) || !(!(this.collapsed)) || !(this.savedSearches.length > 0)) return undefined as never
      return this.savedSearches.map((s) => {
      return { s, part1_props: ((!(this.isMobile && !this.collapsed)) && (!(this.collapsed)) && (this.savedSearches.length > 0)) ? ({ s: s, s_color: s?.color, deleteSavedSearch: this.deleteSavedSearch }) : undefined, key: s.id }
    })
    })
  }

  get show_ctx() {
    return this.memo('show_ctx', [this.ctx, this.isMobile, this.collapsed], () => {
      if (!(!(this.isMobile && !this.collapsed)) || !(!(this.collapsed))) return undefined as never
      return !!(this.ctx)
    })
  }

  get part2_props() {
    return this.memo('part2_props', [this.ctx, this.memo, this.isMobile, this.collapsed], () => {
      if (!(!(this.isMobile && !this.collapsed)) || !(!(this.collapsed)) || !(this.ctx)) return undefined as never
      return ({ ctx: this.ctx, setCtx: this.memo("setCtx:bound", [], () => this.setCtx.bind(this)) })
    })
  }

  /** A part of the screen still written in React (<ContextMenu> pos, onClose: no .kbview property). */
  get Part2() {
    if (!(!(this.isMobile && !this.collapsed)) || !(!(this.collapsed)) || !(this.ctx)) return undefined as never
    return __parts.Part2
  }

  get show_confirm_state() {
    return this.memo('show_confirm_state', [this.confirmState, this.isMobile, this.collapsed], () => {
      if (!(!(this.isMobile && !this.collapsed)) || !(!(this.collapsed))) return undefined as never
      return !!(this.confirmState)
    })
  }

  /** `<ConfirmDialog>`, rendered by a ReactHost. */
  get ConfirmDialog() {
    if (!(!(this.isMobile && !this.collapsed)) || !(!(this.collapsed)) || !(this.confirmState)) return undefined as never
    return ConfirmDialog
  }

  get confirm_dialog_props() {
    return this.memo('confirm_dialog_props', [this.confirmState, this.handleConfirm, this.handleCancel, this.isMobile, this.collapsed], () => {
      if (!(!(this.isMobile && !this.collapsed)) || !(!(this.collapsed)) || !(this.confirmState)) return undefined as never
      return ({ ...this.confirmState, onConfirm: this.handleConfirm, onCancel: this.handleCancel })
    })
  }

  applySaved(s: SavedSearch) {
    this.setSearchQuery(s.query || '')
    if (s.filters && Object.keys(s.filters).length) {
      this.setSearchFilters(s.filters as Partial<FilesSearchFilters>)
    }
    this.applySearch()
  }

  moduleMountLink(moduleId: string, key: string, path: string) {
    return `/drive/m/${moduleId}/${key}${path ? `?path=${encodeURIComponent(path)}` : ''}`
  }

  goToModuleMount(moduleId: string, key: string, path: string) {
    return this.navigate(this.moduleMountLink(moduleId, key, path))
  }

  openCtx(e: React.MouseEvent, items: MenuItem[]) {
    e.preventDefault(); e.stopPropagation()
    this.ctx = { x: e.clientX, y: e.clientY, items }
  }

  remoteLink(remoteId: string, path: string) {
    return `/drive/remote/${remoteId}?path=${encodeURIComponent(path)}`
  }

  goToRemote(remoteId: string, path: string) {
    return this.navigate(this.remoteLink(remoteId, path))
  }

  folderLink(id: string | null) {
    if (!(!(this.isMobile && !this.collapsed)) || !(!(this.collapsed))) return undefined as never
    return (id ? `/drive?folder=${id}` : '/drive')
  }

  handleContextMenu(folder: Folder, x: number, y: number) {
    if (!(!(this.isMobile && !this.collapsed)) || !(!(this.collapsed))) return undefined as never
    this.setContextMenuFolderId(folder.id)
    this.openFolderMenu?.(folder, x, y)
  }

  driveMenuItems(): MenuItem[] {
    if (!(!(this.isMobile && !this.collapsed)) || !(!(this.collapsed))) return undefined as never
    return [
    { type: 'action', label: this.tr('newfolder.title', { defaultValue: 'Nouveau dossier' }), icon: <FolderPlus size={15} />, onClick: this.openNewFolder },
    { type: 'action', label: this.tr('common.refresh', { defaultValue: 'Actualiser' }), icon: <RefreshCw size={15} />, onClick: () => this.qc.invalidateQueries({ queryKey: ['tree-children'] }) },
  ]
  }

  moduleMountMenuItems(mt: { moduleId: string; key: string }): MenuItem[] {
    if (!(!(this.isMobile && !this.collapsed)) || !(!(this.collapsed))) return undefined as never
    return [
    { type: 'action', label: this.tr('common.open', { defaultValue: 'Ouvrir' }), icon: <ExternalLink size={15} />, onClick: () => this.goToModuleMount(mt.moduleId, mt.key, '') },
    { type: 'action', label: this.tr('common.refresh', { defaultValue: 'Actualiser' }), icon: <RefreshCw size={15} />, onClick: () => this.qc.invalidateQueries({ queryKey: ['module-mount', mt.moduleId, mt.key] }) },
  ]
  }

  remoteMenuItems(r: RemoteConnection): MenuItem[] {
    if (!(!(this.isMobile && !this.collapsed)) || !(!(this.collapsed))) return undefined as never
    return [
    { type: 'action', label: this.tr('common.open', { defaultValue: 'Ouvrir' }), icon: <ExternalLink size={15} />, onClick: () => this.goToRemote(r.id, '') },
    { type: 'action', label: this.tr('common.refresh', { defaultValue: 'Actualiser' }), icon: <RefreshCw size={15} />, onClick: () => this.qc.invalidateQueries({ queryKey: ['remote-browse', r.id] }) },
    { type: 'action', label: this.tr('rs.test', { defaultValue: 'Tester la connexion' }), icon: <Plug size={15} />, onClick: async () => { await filesApi.testRemote(r.id).catch(() => {}); this.qc.invalidateQueries({ queryKey: ['remotes'] }) } },
    { type: 'action', label: this.tr('rs.manage', { defaultValue: 'Gérer les montages' }), icon: <Settings2 size={15} />, onClick: this.openRemotesPanel },
    { type: 'separator' },
    { type: 'action', label: this.tr('rs.delete', { defaultValue: 'Supprimer le montage' }), icon: <Trash2 size={15} />, onClick: async () => {
        const ok = await this.confirm({
          title: this.tr('rs.delete', { defaultValue: 'Supprimer le montage' }),
          message: this.tr('rs.delete_confirm', { defaultValue: `Supprimer le montage « ${r.name} » ? Les fichiers distants ne sont pas affectés.`, name: r.name }),
          confirmLabel: this.tr('common.delete', { defaultValue: 'Supprimer' }),
          variant: 'danger',
        })
        if (ok) { await filesApi.deleteRemote(r.id).catch(() => {}); this.qc.invalidateQueries({ queryKey: ['remotes'] }) }
      } },
  ]
  }

  /** `setCtx` of the TSX: a value, or an update of the previous one. */
  setCtx(value: { x: number; y: number; items: MenuItem[] } | null | ((prev: { x: number; y: number; items: MenuItem[] } | null) => { x: number; y: number; items: MenuItem[] } | null)) {
    this.ctx = typeof value === 'function' ? (value as (prev: { x: number; y: number; items: MenuItem[] } | null) => { x: number; y: number; items: MenuItem[] } | null)(this.ctx) : value
  }

}

/** What `useStores()` gives (the types of the fields it fills). */
export type FilesTreeSidebarStores = ReturnType<FilesTreeSidebar['useStores']>

/** What `useHooks()` gives (the types of the fields it fills). */
export type FilesTreeSidebarHooks = ReturnType<FilesTreeSidebar['useHooks']>

export default FilesTreeSidebar.component()
