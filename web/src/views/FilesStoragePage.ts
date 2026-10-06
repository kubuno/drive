/**
 * Code-behind of `FilesStoragePage.kbview` (converted from `FilesStoragePage.tsx` by @kubuno/views-migrate).
 */
import { bind, type MouseEventArgs, type ValueChangedEventArgs } from '@kubuno/views'
import { useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useAuthStore } from "@kubuno/sdk"
import { api } from "@kubuno/sdk"
import { filesApi, formatSize, type FileItem } from "@kubuno/drive"
import { useConfirm } from "@kubuno/sdk"
import { ConfirmDialog } from "@ui"
import { fetchVersionsSummary, hasReclaimableHistory, purgeFileVersions, versionBytes, versionCount, VERSIONS_SUMMARY_KEY, type FileVersionStats } from "../model/fileVersions"

import { ViewBase } from './FilesStoragePage.kbview'
import * as __parts from './FilesStoragePage.parts.tsx'

const PAGE_SIZE = 25

interface Category { label: string; color: string; match: (mime: string) => boolean }

const CATEGORIES: Category[] = [
  { label: 'Images',    color: '#1a73e8', match: m => m.startsWith('image/') },
  { label: 'Vidéos',    color: '#ea4335', match: m => m.startsWith('video/') },
  { label: 'Audio',     color: '#fbbc04', match: m => m.startsWith('audio/') },
  { label: 'Documents', color: '#34a853', match: m =>
      m.startsWith('text/') || m.includes('pdf') || m.includes('word') ||
      m.includes('spreadsheet') || m.includes('presentation') || m.includes('opendocument') },
  { label: 'Archives',  color: '#ff6d00', match: m =>
      m.includes('zip') || m.includes('tar') || m.includes('gzip') ||
      m.includes('rar') || m.includes('7z') || m.includes('bzip') },
]

function categorize(file: FileItem): Category {
  return CATEGORIES.find(c => c.match(file.mime_type)) ??
    { label: 'Autre', color: '#9e9e9e', match: () => true }
}

type Tab = 'files' | 'folders' | 'versions'

export class FilesStoragePage extends ViewBase {
  @bind accessor tab: Tab = 'files'
  @bind accessor filePage = 0
  @bind accessor folderPage = 0
  navigate!: FilesStoragePageStores['navigate']
  tr!: FilesStoragePageStores['t']
  user!: FilesStoragePageStores['user']
  updateUser!: FilesStoragePageStores['updateUser']
  qc!: FilesStoragePageStores['qc']
  confirm!: FilesStoragePageStores['confirm']
  confirmState!: FilesStoragePageStores['confirmState']
  handleConfirm!: () => void
  handleCancel!: () => void
  selFiles!: Set<string>
  setSelFiles!: FilesStoragePageStores['setSelFiles']
  selFolders!: Set<string>
  setSelFolders!: FilesStoragePageStores['setSelFolders']
  filesQ!: FilesStoragePageStores['filesQ']
  foldersQ!: FilesStoragePageStores['foldersQ']
  versionsQ!: FilesStoragePageStores['versionsQ']
  versionedFiles!: (FileItem & FileVersionStats)[]
  totalFileBytes!: number
  deleteMut!: FilesStoragePageHooks['deleteMut']
  archiveMut!: FilesStoragePageHooks['archiveMut']

  /** The screen's hooks that read nothing of the view (stores, translations…), as the TSX called them. React's rules apply: `use()` runs them on every render. */
  useStores() {
    const navigate = useNavigate()
    const { t } = useTranslation('drive')
    const { user, updateUser } = useAuthStore()
    const qc = useQueryClient()
    const { confirm, confirmState, handleConfirm, handleCancel } = useConfirm()
    const [selFiles, setSelFiles]     = useState<Set<string>>(new Set())
    const [selFolders, setSelFolders] = useState<Set<string>>(new Set())
    const filesQ = useQuery({
      // The listing carries the per-file version counters, so the "Versions" tab
      // reuses it instead of asking the backend a second time.
      queryKey: ['files-by-size'],
      queryFn:  () => filesApi.listFilesBySize(1000).then(d => d.files as Array<FileItem & FileVersionStats>),
    })
    const foldersQ = useQuery({
      queryKey: ['folders-by-size'],
      queryFn:  () => filesApi.listFoldersBySize(1000).then(d => d.folders),
    })
    const versionsQ = useQuery({
      queryKey: VERSIONS_SUMMARY_KEY,
      queryFn:  fetchVersionsSummary,
    })
    return { navigate, t, user, updateUser, qc, confirm, confirmState, handleConfirm, handleCancel, selFiles, setSelFiles, selFolders, setSelFolders, filesQ, foldersQ, versionsQ }
  }

  /** The screen's hooks that read its members (run after the fields of `useStores()` are set). React's rules apply: `use()` runs them on every render. */
  useHooks() {
    const selFiles = this.selFiles
    const selFolders = this.selFolders
    const versionedFiles = useMemo(() => this.files.filter(hasReclaimableHistory), [this.files])
    this.publish({ versionedFiles })
    const totalFileBytes = useMemo(() => this.files.reduce((s, f) => s + f.size_bytes, 0), [this.files])
    this.publish({ totalFileBytes })
    const deleteMut = useMutation({
      mutationFn: async () => {
        if (this.tab === 'files') await Promise.all([...selFiles].map(id => filesApi.trashFile(id)))
        else                 await Promise.all([...selFolders].map(id => filesApi.trashFolder(id)))
      },
      onSuccess: this.memo("afterMutation:bound", [], () => this.afterMutation.bind(this)),
    })
    this.publish({ deleteMut })
    const archiveMut = useMutation({
      mutationFn: () => {
        const fileIds   = this.tab === 'files'   ? [...selFiles]   : []
        const folderIds = this.tab === 'folders' ? [...selFolders] : []
        const stamp = new Date().toISOString().slice(0, 10)
        return filesApi.compressSave(fileIds, folderIds, `archive-${stamp}.zip`, null)
      },
      onSuccess: this.memo("afterMutation:bound", [], () => this.afterMutation.bind(this)),
    })
    this.publish({ archiveMut })
    return { versionedFiles, totalFileBytes, deleteMut, archiveMut }
  }

  /** Runs the hooks and publishes what they give as fields (the bindings, the getters and the methods read them). */
  use(): void {
    const s = this.useStores()
    this.publish({ navigate: s.navigate, tr: s.t, user: s.user, updateUser: s.updateUser, qc: s.qc, confirm: s.confirm, confirmState: s.confirmState, handleConfirm: s.handleConfirm, handleCancel: s.handleCancel, selFiles: s.selFiles, setSelFiles: s.setSelFiles, selFolders: s.selFolders, setSelFolders: s.setSelFolders, filesQ: s.filesQ, foldersQ: s.foldersQ, versionsQ: s.versionsQ })
    const h = this.useHooks()
    this.publish({ versionedFiles: h.versionedFiles, totalFileBytes: h.totalFileBytes, deleteMut: h.deleteMut, archiveMut: h.archiveMut })
  }

  get files() {
    return this.memo('files', [this.filesQ], () => this.filesQ.data ?? [])
  }

  get folders() {
    return this.memo('folders', [this.foldersQ], () => this.foldersQ.data ?? [])
  }

  get versionSummary() {
    return this.memo('versionSummary', [this.versionsQ], () => this.versionsQ.data)
  }

  get usedBytes(): number {
    return this.user?.used_bytes  ?? 0
  }

  get quotaBytes(): number {
    return this.user?.quota_bytes ?? 0
  }

  get pct(): number {
    return this.quotaBytes > 0 ? Math.min(100, Math.round((this.usedBytes / this.quotaBytes) * 100)) : 0
  }

  get barColor(): "#d93025" | "#f9ab00" | "#1a73e8" {
    return this.pct > 90 ? '#d93025' : this.pct > 70 ? '#f9ab00' : '#1a73e8'
  }

  get busy(): boolean {
    return this.deleteMut.isPending || this.archiveMut.isPending
  }

  get loading(): boolean {
    return this.filesQ.isLoading || this.foldersQ.isLoading
  }

  get filePages(): number {
    return Math.max(1, Math.ceil(this.files.length   / PAGE_SIZE))
  }

  get folderPages(): number {
    return Math.max(1, Math.ceil(this.folders.length / PAGE_SIZE))
  }

  get pageFiles(): (FileItem & FileVersionStats)[] {
    return this.memo('pageFiles', [this.files, this.filePage], () => this.files.slice(this.filePage   * PAGE_SIZE, this.filePage   * PAGE_SIZE + PAGE_SIZE))
  }

  get pageFolders() {
    return this.memo('pageFolders', [this.folders, this.folderPage], () => this.folders.slice(this.folderPage * PAGE_SIZE, this.folderPage * PAGE_SIZE + PAGE_SIZE))
  }

  get allFilesOnPage(): boolean {
    return this.pageFiles.length > 0 && this.pageFiles.every(f => this.selFiles.has(f.id))
  }

  get allFoldersOnPage(): boolean {
    return this.pageFolders.length > 0 && this.pageFolders.every(f => this.selFolders.has(f.id))
  }

  get text() {
    return formatSize(this.usedBytes)
  }

  get used_suffix_quota() {
    return formatSize(this.quotaBytes)
  }

  /** `<StatsBar>`, rendered by a ReactHost. */
  get StatsBar() {
    return __parts.StatsBar
  }

  get stats_bar_props() {
    return this.memo('stats_bar_props', [this.files, this.totalFileBytes, this.usedBytes, this.pct, this.barColor], () => ({ files: this.files, totalBytes: this.totalFileBytes || this.usedBytes, pct: this.pct, barColor: this.barColor }))
  }

  get show_version_summary_version_summary_total() {
    return !!(this.versionSummary && this.versionSummary.total_versions > 0)
  }

  /** `<VersionsBanner>`, rendered by a ReactHost. */
  get VersionsBanner() {
    if (!(this.versionSummary && this.versionSummary.total_versions > 0)) return undefined as never
    return __parts.VersionsBanner
  }

  get versions_banner_props() {
    return this.memo('versions_banner_props', [this.versionSummary, this.tab], () => {
      if (!(this.versionSummary && this.versionSummary.total_versions > 0)) return undefined as never
      return ({ size: formatSize(this.versionSummary.total_bytes), count: this.versionSummary.files_with_versions, onManage: () => this.tab = 'versions' } as React.ComponentProps<typeof __parts.VersionsBanner>)
    })
  }

  get part1_props() {
    return this.memo('part1_props', [this.tr, this.files, this.folders, this.versionedFiles, this.tab, this.memo], () => ({ t: this.tr, files: this.files, folders: this.folders, versionedFiles: this.versionedFiles, tab: this.tab, setTab: this.memo("setTab:bound", [], () => this.setTab.bind(this)) }))
  }

  /** A part of the screen still written in React (<Tabs> tabs: no .kbview property). */
  get Part1() {
    return __parts.Part1
  }

  get show_not_loading() {
    return !(this.loading)
  }

  get show_tab_files() {
    if (!(!(this.loading))) return undefined as never
    return this.tab === 'files'
  }

  get show_not_tab_files() {
    if (!(!(this.loading))) return undefined as never
    return !(this.tab === 'files')
  }

  /** `<SelectionBar>`, rendered by a ReactHost. */
  get SelectionBar() {
    if (!(!(this.loading)) || !(this.tab === 'files')) return undefined as never
    return __parts.SelectionBar
  }

  get selection_bar_props() {
    return this.memo('selection_bar_props', [this.selFiles, this.busy, this.archiveMut, this.memo, this.tab, this.selFolders, this.confirm, this.tr, this.deleteMut, this.loading], () => {
      if (!(!(this.loading)) || !(this.tab === 'files')) return undefined as never
      return ({ count: this.selFiles.size, busy: this.busy, onArchive: () => this.archiveMut.mutate(), onDelete: this.memo("onDelete:bound", [], () => this.onDelete.bind(this)) } as React.ComponentProps<typeof __parts.SelectionBar>)
    })
  }

  get show_files() {
    if (!(!(this.loading)) || !(this.tab === 'files')) return undefined as never
    return this.files.length === 0
  }

  get show_not_files() {
    if (!(!(this.loading)) || !(this.tab === 'files')) return undefined as never
    return !(this.files.length === 0)
  }

  /** A part of the screen still written in React (<span> with a computed style). */
  get Part2() {
    if (!(!(this.loading)) || !(this.tab === 'files') || !(!(this.files.length === 0))) return undefined as never
    return __parts.Part2
  }

  /** The rows of the Repeater over `pageFiles`. */
  get rows_page_files() {
    return this.memo('rows_page_files', [this.pageFiles, this.loading, this.tab, this.files, this.selFiles], () => {
      if (!(!(this.loading)) || !(this.tab === 'files') || !(!(this.files.length === 0))) return undefined as never
      return this.pageFiles.map((file) => {
      const cat = categorize(file)
      return { file, cat, div_class: ((!(this.loading)) && (this.tab === 'files') && (!(this.files.length === 0))) ? (`flex items-center gap-3 px-4 py-2.5 transition-colors cursor-pointer
                                    ${this.selFiles.has(file.id) ? 'bg-primary-light' : 'hover:bg-surface-1'}`) : undefined, checked: ((!(this.loading)) && (this.tab === 'files') && (!(this.files.length === 0))) ? (this.selFiles.has(file.id)) : undefined, part2_props: ((!(this.loading)) && (this.tab === 'files') && (!(this.files.length === 0))) ? ({ cat: cat }) : undefined, span_text: ((!(this.loading)) && (this.tab === 'files') && (!(this.files.length === 0))) ? (formatSize(file.size_bytes)) : undefined, key: file.id }
    })
    })
  }

  /** `<Pager>`, rendered by a ReactHost. */
  get Pager() {
    if (!(!(this.loading)) || !(this.tab === 'files') || !(!(this.files.length === 0))) return undefined as never
    return __parts.Pager
  }

  get pager_props() {
    return this.memo('pager_props', [this.filePage, this.filePages, this.memo, this.loading, this.tab, this.files], () => {
      if (!(!(this.loading)) || !(this.tab === 'files') || !(!(this.files.length === 0))) return undefined as never
      return ({ page: this.filePage, pageCount: this.filePages, onPage: this.memo("setFilePage:bound", [], () => this.setFilePage.bind(this)) })
    })
  }

  get visible() {
    return this.memo('visible', [this.show_files, this.show_tab_files, this.loading], () => {
      if (!(!(this.loading))) return undefined as never
      return this.show_files && this.show_tab_files
    })
  }

  get visible2() {
    return this.memo('visible2', [this.show_not_files, this.show_tab_files, this.loading], () => {
      if (!(!(this.loading))) return undefined as never
      return this.show_not_files && this.show_tab_files
    })
  }

  get show_tab_versions() {
    if (!(!(this.loading)) || !(!(this.tab === 'files'))) return undefined as never
    return this.tab === 'versions'
  }

  get show_not_tab_versions() {
    if (!(!(this.loading)) || !(!(this.tab === 'files'))) return undefined as never
    return !(this.tab === 'versions')
  }

  get show_versioned_files() {
    if (!(!(this.loading)) || !(!(this.tab === 'files')) || !(this.tab === 'versions')) return undefined as never
    return this.versionedFiles.length === 0
  }

  get show_not_versioned_files() {
    if (!(!(this.loading)) || !(!(this.tab === 'files')) || !(this.tab === 'versions')) return undefined as never
    return !(this.versionedFiles.length === 0)
  }

  /** A part of the screen still written in React (<span> with a computed style). */
  get Part3() {
    if (!(!(this.loading)) || !(!(this.tab === 'files')) || !(this.tab === 'versions') || !(!(this.versionedFiles.length === 0))) return undefined as never
    return __parts.Part3
  }

  /** The rows of the Repeater over `versionedFiles`. */
  get rows_versioned_files() {
    return this.memo('rows_versioned_files', [this.versionedFiles, this.loading, this.tab], () => {
      if (!(!(this.loading)) || !(!(this.tab === 'files')) || !(this.tab === 'versions') || !(!(this.versionedFiles.length === 0))) return undefined as never
      return this.versionedFiles.map((file) => {
      const cat = categorize(file)
      return { file, cat, part3_props: ((!(this.loading)) && (!(this.tab === 'files')) && (this.tab === 'versions') && (!(this.versionedFiles.length === 0))) ? ({ cat: cat }) : undefined, stats_count: ((!(this.loading)) && (!(this.tab === 'files')) && (this.tab === 'versions') && (!(this.versionedFiles.length === 0))) ? (versionCount(file)) : undefined, stats_size: ((!(this.loading)) && (!(this.tab === 'files')) && (this.tab === 'versions') && (!(this.versionedFiles.length === 0))) ? (formatSize(versionBytes(file))) : undefined, key: file.id }
    })
    })
  }

  get visible3() {
    return this.memo('visible3', [this.show_versioned_files, this.show_tab_versions, this.loading, this.tab], () => {
      if (!(!(this.loading)) || !(!(this.tab === 'files'))) return undefined as never
      return this.show_versioned_files && this.show_tab_versions
    })
  }

  get visible4() {
    return this.memo('visible4', [this.show_not_versioned_files, this.show_tab_versions, this.loading, this.tab], () => {
      if (!(!(this.loading)) || !(!(this.tab === 'files'))) return undefined as never
      return this.show_not_versioned_files && this.show_tab_versions
    })
  }

  /** `<SelectionBar>`, rendered by a ReactHost. */
  get SelectionBar2() {
    if (!(!(this.loading)) || !(!(this.tab === 'files')) || !(!(this.tab === 'versions'))) return undefined as never
    return __parts.SelectionBar
  }

  get selection_bar_props2() {
    return this.memo('selection_bar_props2', [this.selFolders, this.busy, this.archiveMut, this.memo, this.tab, this.selFiles, this.confirm, this.tr, this.deleteMut, this.loading], () => {
      if (!(!(this.loading)) || !(!(this.tab === 'files')) || !(!(this.tab === 'versions'))) return undefined as never
      return ({ count: this.selFolders.size, busy: this.busy, onArchive: () => this.archiveMut.mutate(), onDelete: this.memo("onDelete:bound", [], () => this.onDelete.bind(this)) } as React.ComponentProps<typeof __parts.SelectionBar>)
    })
  }

  get show_folders() {
    if (!(!(this.loading)) || !(!(this.tab === 'files')) || !(!(this.tab === 'versions'))) return undefined as never
    return this.folders.length === 0
  }

  get show_not_folders() {
    if (!(!(this.loading)) || !(!(this.tab === 'files')) || !(!(this.tab === 'versions'))) return undefined as never
    return !(this.folders.length === 0)
  }

  /** The rows of the Repeater over `pageFolders`. */
  get rows_page_folders() {
    return this.memo('rows_page_folders', [this.pageFolders, this.loading, this.tab, this.folders, this.selFolders], () => {
      if (!(!(this.loading)) || !(!(this.tab === 'files')) || !(!(this.tab === 'versions')) || !(!(this.folders.length === 0))) return undefined as never
      return this.pageFolders.map((folder) => {
      return { folder, div_class: ((!(this.loading)) && (!(this.tab === 'files')) && (!(this.tab === 'versions')) && (!(this.folders.length === 0))) ? (`flex items-center gap-3 px-4 py-2.5 transition-colors cursor-pointer
                                  ${this.selFolders.has(folder.id) ? 'bg-primary-light' : 'hover:bg-surface-1'}`) : undefined, checked: ((!(this.loading)) && (!(this.tab === 'files')) && (!(this.tab === 'versions')) && (!(this.folders.length === 0))) ? (this.selFolders.has(folder.id)) : undefined, span_text: ((!(this.loading)) && (!(this.tab === 'files')) && (!(this.tab === 'versions')) && (!(this.folders.length === 0))) ? (formatSize(folder.total_size)) : undefined, key: folder.id }
    })
    })
  }

  /** `<Pager>`, rendered by a ReactHost. */
  get Pager2() {
    if (!(!(this.loading)) || !(!(this.tab === 'files')) || !(!(this.tab === 'versions')) || !(!(this.folders.length === 0))) return undefined as never
    return __parts.Pager
  }

  get pager_props2() {
    return this.memo('pager_props2', [this.folderPage, this.folderPages, this.memo, this.loading, this.tab, this.folders], () => {
      if (!(!(this.loading)) || !(!(this.tab === 'files')) || !(!(this.tab === 'versions')) || !(!(this.folders.length === 0))) return undefined as never
      return ({ page: this.folderPage, pageCount: this.folderPages, onPage: this.memo("setFolderPage:bound", [], () => this.setFolderPage.bind(this)) })
    })
  }

  get visible5() {
    return this.memo('visible5', [this.show_folders, this.show_not_tab_versions, this.loading, this.tab], () => {
      if (!(!(this.loading)) || !(!(this.tab === 'files'))) return undefined as never
      return this.show_folders && this.show_not_tab_versions
    })
  }

  get visible6() {
    return this.memo('visible6', [this.show_not_folders, this.show_not_tab_versions, this.loading, this.tab], () => {
      if (!(!(this.loading)) || !(!(this.tab === 'files'))) return undefined as never
      return this.show_not_folders && this.show_not_tab_versions
    })
  }

  get visible7() {
    return this.memo('visible7', [this.visible3, this.show_not_tab_files, this.loading], () => {
      if (!(!(this.loading))) return undefined as never
      return this.visible3 && this.show_not_tab_files
    })
  }

  get visible8() {
    return this.memo('visible8', [this.visible4, this.show_not_tab_files, this.loading], () => {
      if (!(!(this.loading))) return undefined as never
      return this.visible4 && this.show_not_tab_files
    })
  }

  get visible9() {
    return this.memo('visible9', [this.show_not_tab_versions, this.show_not_tab_files, this.loading], () => {
      if (!(!(this.loading))) return undefined as never
      return this.show_not_tab_versions && this.show_not_tab_files
    })
  }

  get visible10() {
    return this.memo('visible10', [this.visible5, this.show_not_tab_files, this.loading], () => {
      if (!(!(this.loading))) return undefined as never
      return this.visible5 && this.show_not_tab_files
    })
  }

  get visible11() {
    return this.memo('visible11', [this.visible6, this.show_not_tab_files, this.loading], () => {
      if (!(!(this.loading))) return undefined as never
      return this.visible6 && this.show_not_tab_files
    })
  }

  get visible12() {
    return this.memo('visible12', [this.show_tab_files, this.show_not_loading], () => this.show_tab_files && this.show_not_loading)
  }

  get visible13() {
    return this.memo('visible13', [this.visible, this.show_not_loading], () => this.visible && this.show_not_loading)
  }

  get visible14() {
    return this.memo('visible14', [this.visible2, this.show_not_loading], () => this.visible2 && this.show_not_loading)
  }

  get visible15() {
    return this.memo('visible15', [this.visible7, this.show_not_loading], () => this.visible7 && this.show_not_loading)
  }

  get visible16() {
    return this.memo('visible16', [this.visible8, this.show_not_loading], () => this.visible8 && this.show_not_loading)
  }

  get visible17() {
    return this.memo('visible17', [this.visible9, this.show_not_loading], () => this.visible9 && this.show_not_loading)
  }

  get visible18() {
    return this.memo('visible18', [this.visible10, this.show_not_loading], () => this.visible10 && this.show_not_loading)
  }

  get visible19() {
    return this.memo('visible19', [this.visible11, this.show_not_loading], () => this.visible11 && this.show_not_loading)
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

  async refreshUser() {
    try { const { data } = await api.get<{ user: FilesStoragePage['user'] }>('/me'); if (data?.user) this.updateUser(data.user) } catch { /* ignore */ }
  }

  afterMutation() {
    this.qc.invalidateQueries({ queryKey: ['files-by-size'] })
    this.qc.invalidateQueries({ queryKey: ['folders-by-size'] })
    this.qc.invalidateQueries({ queryKey: ['files'] })
    this.qc.invalidateQueries({ queryKey: ['folders'] })
    this.qc.invalidateQueries({ queryKey: VERSIONS_SUMMARY_KEY })
    this.refreshUser()
    this.setSelFiles(new Set()); this.setSelFolders(new Set())
  }

  async purgeVersionsOf(file: FileItem & FileVersionStats) {
    const ok = await this.confirm({
      title:        this.tr('version.purge_title'),
      message:      this.tr('version.purge_msg', {
        count: versionCount(file),
        name:  file.name,
        size:  formatSize(versionBytes(file)),
      }),
      variant:      'danger',
      confirmLabel: this.tr('version.purge_confirm'),
    })
    if (!ok) return
    try {
      await purgeFileVersions(file.id)
      this.afterMutation()
    } catch {
      await this.confirm({
        title:        this.tr('version.purge_failed_title'),
        message:      this.tr('version.purge_failed'),
        variant:      'warning',
        hideCancel:   true,
        confirmLabel: this.tr('common.ok', { defaultValue: 'OK' }),
      })
    }
  }

  async onDelete() {
    const count = this.tab === 'files' ? this.selFiles.size : this.selFolders.size
    const ok = await this.confirm({
      title: this.tr('storage.confirm_delete_title'),
      message: this.tr('storage.confirm_delete_msg', { count }),
      variant: 'danger',
      confirmLabel: this.tr('storage.delete'),
    })
    if (ok) this.deleteMut.mutate()
  }

  toggleFile(id: string) {
    return this.setSelFiles(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  toggleFolder(id: string) {
    return this.setSelFolders(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  toggleAllFiles() {
    return this.setSelFiles(s => { const n = new Set(s); this.allFilesOnPage ? this.pageFiles.forEach(f => n.delete(f.id)) : this.pageFiles.forEach(f => n.add(f.id)); return n })
  }

  toggleAllFolders() {
    return this.setSelFolders(s => { const n = new Set(s); this.allFoldersOnPage ? this.pageFolders.forEach(f => n.delete(f.id)) : this.pageFolders.forEach(f => n.add(f.id)); return n })
  }

  panel_click(_sender: unknown, _args: MouseEventArgs) {
    this.navigate(-1)
  }

  button_click(_sender: unknown, _args: MouseEventArgs) {
    this.navigate('/drive/trash')
  }

  panel_click2(_sender: unknown, args: MouseEventArgs) {
    const { file } = args.row as RowOf_rows_page_files
    if (!(!(this.loading)) || !(this.tab === 'files') || !(!(this.files.length === 0))) return undefined as never
    this.toggleFile(file.id)
  }

  check_box_checked_changed(_sender: unknown, args: ValueChangedEventArgs) {
    const { file } = args.row as RowOf_rows_page_files
    if (!(!(this.loading)) || !(this.tab === 'files') || !(!(this.files.length === 0))) return undefined as never
    this.toggleFile(file.id)
  }

  button_click2(_sender: unknown, args: MouseEventArgs) {
    const { file } = args.row as RowOf_rows_versioned_files
    if (!(!(this.loading)) || !(!(this.tab === 'files')) || !(this.tab === 'versions') || !(!(this.versionedFiles.length === 0))) return undefined as never
    void this.purgeVersionsOf(file)
  }

  panel_click3(_sender: unknown, args: MouseEventArgs) {
    const { folder } = args.row as RowOf_rows_page_folders
    if (!(!(this.loading)) || !(!(this.tab === 'files')) || !(!(this.tab === 'versions')) || !(!(this.folders.length === 0))) return undefined as never
    this.toggleFolder(folder.id)
  }

  check_box_checked_changed2(_sender: unknown, args: ValueChangedEventArgs) {
    const { folder } = args.row as RowOf_rows_page_folders
    if (!(!(this.loading)) || !(!(this.tab === 'files')) || !(!(this.tab === 'versions')) || !(!(this.folders.length === 0))) return undefined as never
    this.toggleFolder(folder.id)
  }

  /** `setTab` of the TSX: a value, or an update of the previous one. */
  setTab(value: Tab | ((prev: Tab) => Tab)) {
    this.tab = typeof value === 'function' ? (value as (prev: Tab) => Tab)(this.tab) : value
  }

  /** `setFilePage` of the TSX: a value, or an update of the previous one. */
  setFilePage(value: FilesStoragePage['filePage'] | ((prev: FilesStoragePage['filePage']) => FilesStoragePage['filePage'])) {
    this.filePage = typeof value === 'function' ? (value as (prev: FilesStoragePage['filePage']) => FilesStoragePage['filePage'])(this.filePage) : value
  }

  /** `setFolderPage` of the TSX: a value, or an update of the previous one. */
  setFolderPage(value: FilesStoragePage['folderPage'] | ((prev: FilesStoragePage['folderPage']) => FilesStoragePage['folderPage'])) {
    this.folderPage = typeof value === 'function' ? (value as (prev: FilesStoragePage['folderPage']) => FilesStoragePage['folderPage'])(this.folderPage) : value
  }

}

type RowOf_rows_page_files = FilesStoragePage['rows_page_files'][number]
type RowOf_rows_versioned_files = FilesStoragePage['rows_versioned_files'][number]
type RowOf_rows_page_folders = FilesStoragePage['rows_page_folders'][number]

/** What `useStores()` gives (the types of the fields it fills). */
export type FilesStoragePageStores = ReturnType<FilesStoragePage['useStores']>

/** What `useHooks()` gives (the types of the fields it fills). */
export type FilesStoragePageHooks = ReturnType<FilesStoragePage['useHooks']>

export default FilesStoragePage.component()
