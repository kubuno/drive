import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useConfirm } from '@kubuno/sdk'
import { ConfirmDialog } from '@ui'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Folder as FolderIcon, Upload, ChevronRight, ChevronLeft, Loader2,
  Star, Trash2, RotateCcw, FolderInput, Pencil, Share2,
  Download, MoreVertical, CloudUpload, Info,
  Image, Search, X, History, Play,
  FolderPlus, Camera,
  Scissors, Copy, ClipboardPaste, Archive, Link,
  PackageOpen, ListChecks, CheckSquare,
} from 'lucide-react'
import { filesApi, formatSize, type Folder, type FolderAncestor, type FileItem, type SearchHit } from '@kubuno/drive'
import { StorageExplorer, localSource, FolderGlyph, FilesTextViewer, isTextFile } from '@kubuno/drive'
import { useFilesStore, type FilesSearchFilters } from '@kubuno/drive'
import { useFilesPaintStore } from '@kubuno/drive'
import { useAuthStore } from '@kubuno/sdk'
import { api } from '@kubuno/sdk'
import type { User } from '@kubuno/sdk'
import { ViewMenu, VIEW_SPECS, type ViewMode } from '@kubuno/drive'
import { NewFolderModal } from '@kubuno/drive'
import ImportUrlModal from './ImportUrlModal'
import RemoteStoragePanel from './RemoteStoragePanel'
import { RenameModal } from '@kubuno/drive'
import { BatchRenameModal, type BatchRenameItem } from '@kubuno/drive'
import { useBatchRenameStore } from '@kubuno/drive'
import { MoveModal } from '@kubuno/drive'
import { ShareModal, type ShareTarget } from '@kubuno/drive'
import { FileInfoModal, type InfoTarget } from '@kubuno/drive'
import { VersionHistoryModal } from '@kubuno/drive'
import { UploadPanel } from '@kubuno/drive'
import Files3DViewer, { is3dFile } from './Files3DViewer'
import FilesFontViewer, { isFontFile } from './FilesFontViewer'
import { SlotRegistry } from '@kubuno/sdk'
import { useModulesStore } from '@kubuno/sdk'
import { usePendingDeletionStore, usePendingKind, pendingBoxClass, pendingBoxStyle, type DeletionKind, type PendingItem } from '@kubuno/sdk'
import { ModuleServiceRegistry } from '@kubuno/sdk'
import { FileTypeRegistry } from '@kubuno/sdk'
import { FloatCheckbox, Button, Dropdown, MenuDropdown, type MenuItem } from '@ui'
import { useFilesMediaPlayerStore } from '@kubuno/drive'
import { useFilesVideoPlayerStore } from '@kubuno/drive'
import { useImageCacheStore } from '@kubuno/sdk'
import { getFileIcon, OpenWithSubmenu, OrganiserSubmenu } from '@kubuno/drive'
import { useFilesContextMenuStore } from './filesContextMenuStore'
import { useFilesDialogStore } from '@kubuno/drive'
import { PdfViewerModal } from '@kubuno/sdk'
import { ConflictDialog, type ConflictChoice } from '@ui'
import ArchiveBrowser from './ArchiveBrowser'
import { useMarqueeSelection } from '@kubuno/drive'
// ── Types ─────────────────────────────────────────────────────────────────────

type MenuTarget =
  | { type: 'folder'; item: Folder;   x: number; y: number }
  | { type: 'file';   item: FileItem; x: number; y: number }
  | null

type RenameTarget = { type: 'folder'; item: Folder } | { type: 'file'; item: FileItem } | null
type MoveTarget   = { type: 'folder'; item: Folder } | { type: 'file'; item: FileItem } | null

// ── Drag & drop helpers ───────────────────────────────────────────────────────

async function readAllEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  const all: FileSystemEntry[] = []
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((res, rej) =>
      reader.readEntries(res, rej),
    )
    if (batch.length === 0) break
    all.push(...batch)
  }
  return all
}

// ── Breadcrumb ────────────────────────────────────────────────────────────────

interface BreadcrumbProps {
  folder:      Folder | null
  ancestors:   FolderAncestor[]
  pageTitle:   string
  onNavigate:  (id: string | null) => void
}

function Breadcrumb({ folder, ancestors, pageTitle, onNavigate }: BreadcrumbProps) {
  const { t } = useTranslation('drive')
  // Vue spéciale (Corbeille, Récents…) → juste le titre, non cliquable
  if (!folder) {
    return (
      <h1 className="text-xl font-medium text-text-primary leading-tight">{pageTitle}</h1>
    )
  }

  // Vue dossier → fil d'ariane complet
  return (
    <nav className="flex items-center gap-0.5 flex-wrap" aria-label={t('app.breadcrumb')}>
      {/* Racine */}
      <button
        onClick={() => onNavigate(null)}
        className="text-xl font-medium text-text-secondary hover:text-primary transition-colors leading-tight"
      >
        {t('nav.my_files')}
      </button>

      {/* Ancêtres intermédiaires */}
      {ancestors.map((anc) => (
        <span key={anc.id} className="flex items-center gap-0.5">
          <ChevronRight size={16} className="text-text-tertiary flex-shrink-0" />
          <button
            onClick={() => onNavigate(anc.id)}
            className="text-xl font-medium text-text-secondary hover:text-primary transition-colors leading-tight"
          >
            {anc.name}
          </button>
        </span>
      ))}

      {/* Dossier courant — non cliquable */}
      <span className="flex items-center gap-0.5">
        <ChevronRight size={16} className="text-text-tertiary flex-shrink-0" />
        <span className="text-xl font-medium text-text-primary leading-tight">
          {folder.name}
        </span>
      </span>
    </nav>
  )
}

// ── Context menu ──────────────────────────────────────────────────────────────

interface ItemMenuHandlers {
  onClose: () => void
  onRename: () => void
  onMove: () => void
  onStar: () => void
  onTrash: (permanent: boolean) => void
  onDelete: () => void
  onRestore: () => void
  onShare: () => void
  onGetLink: () => void
  onInfo: () => void
  onEditPaint: () => void
  onVersionHistory: () => void
  onCut: () => void
  onCopy: () => void
  onPaste: () => void
  onCompress: () => void
  onCompressSave: () => void
  onDecompress: () => void
  onSetColor: (color: string | null) => void
  clipboard: { action: 'cut' | 'copy'; type: 'file' | 'folder'; id: string; name: string } | null
  isTrashed: boolean
  isPlaying: boolean
  isMultiSelection: boolean
  selectionCount: number
}

// Construit la liste d'items du menu contextuel pour <MenuDropdown>. Les sous-menus
// dynamiques (« Ouvrir avec » + grille couleurs de l'« Organiser ») sont embarqués
// via des items `custom` qui rendent leurs composants existants tels quels.
function buildItemMenuItems(
  menu: NonNullable<MenuTarget>,
  tr: (k: string, opts?: Record<string, unknown>) => string,
  h: ItemMenuHandlers,
): MenuItem[] {
  const { clipboard, isTrashed, isPlaying, isMultiSelection, selectionCount } = h
  const isFile   = menu.type === 'file'
  const isFolder = menu.type === 'folder'
  const starred  = isFile
    ? (menu.item as FileItem).is_starred
    : (menu.item as Folder).is_starred
  const folderColor  = isFolder ? (menu.item as Folder).color : null
  const isProtected  = isFolder && !!(menu.item as Folder).is_protected
  const trashDisabled = isProtected || isPlaying
  const isZip = isFile && (
    (menu.item as FileItem).mime_type.includes('zip') ||
    (menu.item as FileItem).name.toLowerCase().endsWith('.zip')
  )

  const items: MenuItem[] = []

  // Label multi-sélection (entête).
  if (isMultiSelection) {
    items.push({ type: 'label', text: tr('app.items_selected', { count: selectionCount }) })
  }

  if (isTrashed) {
    items.push({ type: 'action', label: tr('ctx.restore'), icon: <RotateCcw size={14} />, onClick: h.onRestore, disabled: isMultiSelection })
    items.push({ type: 'action', label: tr('ctx.delete_perm'), icon: <Trash2 size={14} />, danger: true, onClick: h.onDelete, disabled: isPlaying || isMultiSelection })
    return items
  }

  // Télécharger : fichier → téléchargement direct (nouvel onglet) ; dossier → zip.
  if (isFile) {
    items.push({
      type: 'action', label: tr('common.download'), icon: <Download size={14} />,
      disabled: isMultiSelection,
      onClick: () => { window.open(filesApi.downloadUrl((menu.item as FileItem).id), '_blank', 'noreferrer') },
    })
  } else {
    items.push({ type: 'action', label: tr('ctx.download_zip'), icon: <Download size={14} />, onClick: h.onCompress, disabled: isMultiSelection })
  }

  // Renommer — en multi-sélection, ouvre le renommage en lot (PowerRename).
  items.push({ type: 'action', label: tr('common.rename'), shortcut: 'F2', icon: <Pencil size={14} />, onClick: h.onRename, disabled: isProtected })

  // Ouvrir avec (fichiers).
  if (isFile && !isMultiSelection) {
    items.push({ type: 'custom', render: (close) => <OpenWithSubmenu file={menu.item as FileItem} onClose={close} /> })
  }

  // Modifier dans Paint (images).
  if (isFile && (menu.item as FileItem).mime_type.startsWith('image/')) {
    items.push({ type: 'action', label: tr('ctx.edit_paint'), icon: <Image size={14} />, onClick: h.onEditPaint, disabled: isMultiSelection })
  }

  items.push({ type: 'separator' })

  // Partager.
  items.push({ type: 'action', label: tr('ctx.share'), icon: <Share2 size={14} />, onClick: h.onShare, disabled: isMultiSelection })
  items.push({ type: 'action', label: tr('ctx.get_link'), icon: <Link size={14} />, onClick: h.onGetLink, disabled: isMultiSelection })

  // Organiser (sous-menu).
  items.push({
    type: 'custom',
    render: (close) => (
      <OrganiserSubmenu
        isFolder={isFolder}
        starred={starred}
        folderColor={folderColor}
        isProtected={isProtected}
        disabled={isMultiSelection}
        onMove={h.onMove}
        onStar={h.onStar}
        onSetColor={h.onSetColor}
        onClose={close}
      />
    ),
  })

  items.push({ type: 'separator' })

  // Presse-papier.
  items.push({ type: 'action', label: tr('ctx.cut'), icon: <Scissors size={14} />, onClick: h.onCut, disabled: isProtected || isMultiSelection })
  items.push({ type: 'action', label: tr('ctx.copy'), icon: <Copy size={14} />, onClick: h.onCopy, disabled: isMultiSelection })
  if (isFolder && clipboard && !isMultiSelection) {
    items.push({ type: 'action', label: tr('ctx.paste'), icon: <ClipboardPaste size={14} />, onClick: h.onPaste })
  }
  // Compresser — fonctionne en multi-sélection.
  items.push({ type: 'action', label: tr('ctx.compress'), icon: <Archive size={14} />, onClick: h.onCompressSave })
  if (isZip && !isMultiSelection) {
    items.push({ type: 'action', label: tr('ctx.decompress'), icon: <PackageOpen size={14} />, onClick: h.onDecompress })
  }

  items.push({ type: 'separator' })

  // Informations.
  items.push({ type: 'action', label: isFolder ? tr('ctx.info_folder') : tr('ctx.info_file'), icon: <Info size={14} />, onClick: h.onInfo, disabled: isMultiSelection })
  if (isFile && !isMultiSelection) {
    items.push({ type: 'action', label: tr('version.title'), icon: <History size={14} />, onClick: h.onVersionHistory })
  }

  items.push({ type: 'separator' })

  // Corbeille / suppression définitive — fonctionne en multi-sélection.
  // Item `custom` pour préserver le raccourci Shift = suppression définitive
  // (l'événement de clic n'est pas exposé par les items `action`).
  items.push({
    type: 'custom',
    render: (close) => (
      <button
        onClick={trashDisabled ? undefined : (e) => { h.onTrash(e.shiftKey); close() }}
        disabled={trashDisabled}
        title={trashDisabled && isPlaying ? tr('app.stop_playback') : tr('app.shift_perm')}
        className={`w-full flex items-center gap-3 px-3 py-2 text-sm text-left outline-none transition-colors
                    ${trashDisabled ? 'opacity-40 cursor-not-allowed' : 'text-danger hover:bg-danger-light cursor-pointer'}`}
      >
        <Trash2 size={14} />
        <span className="flex-1">{isFile ? tr('ctx.trash') : tr('ctx.trash_folder')}</span>
        {!trashDisabled && <span className="text-text-tertiary text-xs opacity-60">{tr('ctx.shift_short')}</span>}
      </button>
    ),
  })

  return items
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  starred?: boolean
  shared?:  boolean
  recent?:  boolean
  trashed?: boolean
}

export default function DriveApp({ starred = false, shared = false, recent = false, trashed = false }: Props) {
  const { t } = useTranslation('drive')
  const [searchParams, setSearchParams] = useSearchParams()
  const routerNavigate = useNavigate()
  const folderId = (starred || shared || recent || trashed) ? null : (searchParams.get('folder') ?? null)
  // Source locale pour la vue normale déléguée à StorageExplorer (zone unifiée).
  const driveSource = useMemo(() => localSource(), [])
  const qc = useQueryClient()

  // Use photos module image viewer if photos module is active
  const activeModules = useModulesStore(s => s.activeModules)
  const activeIds     = useMemo(() => new Set(activeModules.map(m => m.module_id)), [activeModules])

  const ImageViewer   = useMemo(
    () => SlotRegistry.getActiveOverride<{ file: FileItem; imageFiles: FileItem[]; onClose: () => void }>('files-image-viewer', activeIds),
    [activeIds],
  )
  // Use media module video player (floating window) if media module is active
  const VideoPlayer = useMemo(
    () => SlotRegistry.getActiveOverride<{ file: FileItem; onClose: () => void; initialPosition?: number; onInitialPositionConsumed?: () => void; onTimeUpdate?: (t: number) => void }>('files-video-player', activeIds),
    [activeIds],
  )

  const { confirm, confirmState, handleConfirm, handleCancel } = useConfirm()
  const [viewMode, setViewMode] = useState<ViewMode>('lg')
  const [compact, setCompact]   = useState(false)
  const [showHidden, setShowHidden] = useState(false)

  const {
    newFolderOpen, closeNewFolder,
    refreshKey,
    openNewFolder,
    setCurrentFolderId,
    addUpload, updateUpload,
    registerFileInput, registerFolderInput,
    searchQuery, searchFilters, searchApplied, clearSearch,
    imageSearch, clearImageSearch,
    clipboard, setClipboard, clearClipboard,
  } = useFilesStore()

  const { updateUser } = useAuthStore()
  const refreshUser = useCallback(() => {
    api.get<{ user: User }>('/me').then(res => updateUser(res.data.user)).catch(() => {})
  }, [updateUser])

  const isSearchMode = searchApplied || searchQuery.trim().length > 0
  // Vue normale « simple » (ni recherche, ni vue spéciale) → déléguée à StorageExplorer.
  const isPlainNormal = !imageSearch && !isSearchMode && !starred && !shared && !recent && !trashed

  // Modals / menu state
  const [menu,         setMenu]         = useState<MenuTarget>(null)
  const [renameTarget, setRenameTarget] = useState<RenameTarget>(null)
  const { open: batchOpen, items: batchItems, close: closeBatch } = useBatchRenameStore()
  const [moveTarget,   setMoveTarget]   = useState<MoveTarget>(null)
  const [shareTarget,   setShareTarget]   = useState<ShareTarget | null>(null)
  const [infoTarget,    setInfoTarget]    = useState<InfoTarget | null>(null)
  const [versionTarget, setVersionTarget] = useState<FileItem | null>(null)
  const [lightboxFile,    setLightboxFile]    = useState<FileItem | null>(null)
  const videoFile      = useFilesVideoPlayerStore(s => s.file)
  const openVideoFile  = useFilesVideoPlayerStore(s => s.open)
  const closeVideoFile = useFilesVideoPlayerStore(s => s.close)
  const videoRestorePos = useFilesVideoPlayerStore(s => s.restorePosition)
  const videoClearPos   = useFilesVideoPlayerStore(s => s._clearRestorePosition)

  const playingAudioFileId = useFilesMediaPlayerStore(s => s.file?.id ?? null)
  const playingVideoFileId = videoFile?.id ?? null
  const playingFileIds = useMemo(() => {
    const s = new Set<string>()
    if (playingAudioFileId) s.add(playingAudioFileId)
    if (playingVideoFileId) s.add(playingVideoFileId)
    return s
  }, [playingAudioFileId, playingVideoFileId])
  const [model3dFile,     setModel3dFile]     = useState<FileItem | null>(null)
  const [fontFile,        setFontFile]        = useState<FileItem | null>(null)
  const [pdfFile,         setPdfFile]         = useState<FileItem | null>(null)
  const [archiveFile,     setArchiveFile]     = useState<FileItem | null>(null)
  const [textFile,        setTextFile]        = useState<FileItem | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const lastSelectedIdxRef = useRef<number>(-1)

  const handleMarqueeSelect = useCallback((ids: Set<string>, additive: boolean) => {
    setSelectedIds(additive ? prev => new Set([...prev, ...ids]) : ids)
  }, [])

  const { containerRef: marqueeContainerRef, marqueeStyle, preSelectedIds,
          onPointerDown: onMarqueeDown, onPointerMove: onMarqueeMove,
          onPointerUp: onMarqueeUp, onPointerCancel: onMarqueeCancel } = useMarqueeSelection(handleMarqueeSelect)

  // Sort & filter
  const [sortField,  setSortField]  = useState<'name' | 'size' | 'date' | 'type'>('date')
  const [sortDir,    setSortDir]    = useState<'asc' | 'desc'>('desc')
  const [typeFilter, setTypeFilter] = useState<string | null>(null)

  const openAudio = useFilesMediaPlayerStore(s => s.open)

  const openFile = useCallback((file: FileItem) => {
    // 1. Préférence explicite « S'ouvre avec » (moduleId FileTypeRegistry, sinon service legacy)
    const openWith = typeof file.metadata?.['open_with'] === 'string' ? file.metadata['open_with'] as string : null
    if (openWith) {
      const decl = FileTypeRegistry.get(openWith)
      if (decl?.open) { decl.open(file, routerNavigate); return }
      const handled = ModuleServiceRegistry.call<boolean>(openWith, 'openFile', file, routerNavigate)
      if (handled) return
    }
    // 2. Comportement natif selon le type MIME (médias, pdf, archives…)
    if (file.mime_type.startsWith('image/'))          { setLightboxFile(file); return }
    if (file.mime_type.startsWith('video/'))          { openVideoFile(file);   return }
    if (file.mime_type.startsWith('audio/'))          { openAudio(file);       return }
    if (is3dFile(file))                               { setModel3dFile(file);  return }
    if (isFontFile(file))                             { setFontFile(file);     return }
    if (file.mime_type === 'application/pdf')         { setPdfFile(file);      return }
    if (file.mime_type.includes('zip') || file.name.toLowerCase().endsWith('.zip')) { setArchiveFile(file); return }
    // 3. Texte (txt, md, csv, log, json, code…) → visionneuse rapide par défaut.
    //    Un éditeur (ex. Documents) reste accessible via « Ouvrir avec ». La
    //    préférence explicite par-fichier (étape 1) a déjà la priorité absolue.
    if (isTextFile(file)) { setTextFile(file); return }
    // 4. Application associée (fichiers kubuno .kb*** et formats revendiqués) via FileTypeRegistry
    const opener = FileTypeRegistry.openersFor(file)[0]
    if (opener?.open) { opener.open(file, routerNavigate); return }
    // 5. Repli : téléchargement
    window.open(filesApi.downloadUrl(file.id), '_blank')
  }, [openAudio, routerNavigate])

  // Drag state
  const [isDragOver,       setIsDragOver]       = useState(false)
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null)
  const [draggingItem,     setDraggingItem]     = useState<{ type: 'folder' | 'file'; id: string } | null>(null)
  const dragCounter = useRef(0)

  // File input refs
  const fileInputRef   = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setCurrentFolderId(folderId); return () => setCurrentFolderId(null) }, [folderId, setCurrentFolderId])

  // Register direct callbacks so the sidebar "Nouveau" menu can trigger clicks
  // synchronously within the browser user gesture context (useEffect is fine here
  // because we're registering, not clicking — the actual click happens later in the
  // same gesture as the user's dropdown selection via onSelect → triggerUpload())
  useEffect(() => {
    registerFileInput(() => fileInputRef.current?.click())
    registerFolderInput(() => folderInputRef.current?.click())
  }, [registerFileInput, registerFolderInput])

  const { register: registerContextMenu, unregister: unregisterContextMenu, setContextMenuFolderId } = useFilesContextMenuStore()
  useEffect(() => {
    registerContextMenu((folder, x, y) => {
      setMenu({ type: 'folder', item: folder, x, y })
    })
    return () => unregisterContextMenu()
  }, [registerContextMenu, unregisterContextMenu])

  const navigate = (id: string | null) => {
    if (id) setSearchParams({ folder: id })
    else setSearchParams({})
  }

  // ── Queries ───────────────────────────────────────────────────────────────

  const { data: folderMeta } = useQuery({
    queryKey: ['folder-meta', folderId],
    queryFn:  () => filesApi.getFolder(folderId!),
    enabled:  !!folderId,
  })

  const { data: foldersData, isLoading: loadingFolders } = useQuery({
    queryKey: ['folders', folderId, trashed, refreshKey],
    queryFn:  () => trashed
      ? filesApi.listFolders(null, true)
      : filesApi.listFolders(folderId),
    enabled:  !starred && !shared && !recent,
  })

  const { data: filesData, isLoading: loadingFiles, isError: filesError } = useQuery({
    queryKey: ['files', folderId, starred, recent, trashed, refreshKey],
    queryFn:  () => filesApi.listFiles(folderId, starred, trashed, recent),
    retry:    1,
  })

  const folders = foldersData?.folders ?? []
  const files   = filesData?.files   ?? []
  const currentFolder  = folderMeta?.folder    ?? null
  const ancestors      = folderMeta?.ancestors  ?? []
  const isLoading = loadingFolders || loadingFiles

  const itemTypeMap = useMemo(() => {
    const map = new Map<string, 'file' | 'folder'>()
    folders.forEach(f => map.set(f.id, 'folder'))
    files.forEach(f => map.set(f.id, 'file'))
    return map
  }, [folders, files])

  const filteredFiles = useMemo(() => {
    let result = files
    if (!showHidden) result = result.filter(f => !f.name.startsWith('.'))
    if (typeFilter) {
      result = result.filter(f => {
        if (typeFilter === 'image')    return f.mime_type.startsWith('image/')
        if (typeFilter === 'video')    return f.mime_type.startsWith('video/')
        if (typeFilter === 'audio')    return f.mime_type.startsWith('audio/')
        if (typeFilter === 'document') return f.mime_type.startsWith('text/') || f.mime_type.includes('pdf') || f.mime_type.includes('word') || f.mime_type.includes('spreadsheet') || f.mime_type.includes('presentation') || f.mime_type.includes('opendocument')
        if (typeFilter === 'archive')  return f.mime_type.includes('zip') || f.mime_type.includes('tar') || f.mime_type.includes('gzip') || f.mime_type.includes('rar') || f.mime_type.includes('7z') || f.mime_type.includes('bzip')
        return true
      })
    }
    return [...result].sort((a, b) => {
      let cmp = 0
      if (sortField === 'name') cmp = a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' })
      else if (sortField === 'size') cmp = a.size_bytes - b.size_bytes
      else if (sortField === 'date') cmp = new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime()
      else if (sortField === 'type') cmp = a.mime_type.localeCompare(b.mime_type)
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [files, typeFilter, sortField, sortDir, showHidden])

  const orderedIds = useMemo(() => [
    ...folders.map(f => f.id),
    ...filteredFiles.map(f => f.id),
  ], [folders, filteredFiles])

  const allItemsSelected = orderedIds.length > 0 && orderedIds.every(id => selectedIds.has(id))
  const selectAll   = () => setSelectedIds(new Set(orderedIds))
  const toggleSelectAll = () => allItemsSelected ? setSelectedIds(new Set()) : selectAll()

  // Raccourcis : Ctrl/Cmd+A → tout sélectionner ; Échap → effacer la sélection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
      if (typing) return
      if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
        if (orderedIds.length === 0) return
        e.preventDefault()
        setSelectedIds(new Set(orderedIds))
      } else if (e.key === 'Escape' && selectedIds.size > 0) {
        setSelectedIds(new Set())
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [orderedIds, selectedIds.size])

  const hasProtectedInSelection = useMemo(
    () => folders.some(f => f.is_protected && selectedIds.has(f.id)),
    [folders, selectedIds],
  )

  const isMenuItemPlaying = useMemo(
    () => menu?.type === 'file' && playingFileIds.has((menu.item as FileItem).id),
    [menu, playingFileIds],
  )

  const hasPlayingInSelection = useMemo(
    () => [...selectedIds].some(id => playingFileIds.has(id)),
    [selectedIds, playingFileIds],
  )

  const handleItemSelect = useCallback((id: string, e: React.MouseEvent) => {
    const currentIdx = orderedIds.indexOf(id)
    if (e.shiftKey && lastSelectedIdxRef.current >= 0) {
      const from = Math.min(lastSelectedIdxRef.current, currentIdx)
      const to   = Math.max(lastSelectedIdxRef.current, currentIdx)
      const range = orderedIds.slice(from, to + 1)
      setSelectedIds(prev => { const next = new Set(prev); range.forEach(r => next.add(r)); return next })
    } else if (e.ctrlKey || e.metaKey) {
      setSelectedIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next })
      lastSelectedIdxRef.current = currentIdx
    } else {
      setSelectedIds(new Set([id]))
      lastSelectedIdxRef.current = currentIdx
    }
  }, [orderedIds])

  const handleItemToggle = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
    lastSelectedIdxRef.current = orderedIds.indexOf(id)
  }, [orderedIds])

  const pageTitle = trashed ? t('nav.trash')
    : starred ? t('tree.starred')
    : shared  ? t('nav.shared')
    : recent  ? t('nav.recent')
    : null  // géré par Breadcrumb

  // ── Upload avec suivi de progression ─────────────────────────────────────

  const [uploadConflictQueue, setUploadConflictQueue] = useState<Array<{ file: File; folderId: string | null }>>([])

  const uploadFileTracked = useCallback((file: File, targetFolderId: string | null, overwrite = false) => {
    const id = crypto.randomUUID()
    addUpload({ id, name: file.name, progress: 0, status: 'uploading' })
    filesApi.uploadFile(file, targetFolderId, pct => updateUpload(id, { progress: pct }), overwrite)
      .then((result) => {
        if (!result?.file?.id) {
          updateUpload(id, { status: 'error', error: t('app.module_unavailable') })
          return
        }
        updateUpload(id, { progress: 100, status: 'done' })
        qc.invalidateQueries({ queryKey: ['files'] })
        refreshUser()
      })
      .catch(err => updateUpload(id, { status: 'error', error: (err as Error).message ?? t('common.error') }))
  }, [addUpload, updateUpload, qc, refreshUser])

  const handleUploadConflictChoice = useCallback((choice: ConflictChoice) => {
    setUploadConflictQueue(prev => {
      const [current, ...rest] = prev
      if (current && choice !== 'cancel') {
        uploadFileTracked(current.file, current.folderId, choice === 'overwrite')
      }
      return rest
    })
  }, [uploadFileTracked])

  const enqueueUpload = useCallback((file: File, targetFolderId: string | null) => {
    const hasConflict = (filesData?.files ?? []).some(f => f.name === file.name)
    if (hasConflict && targetFolderId === folderId) {
      setUploadConflictQueue(prev => [...prev, { file, folderId: targetFolderId }])
    } else {
      uploadFileTracked(file, targetFolderId)
    }
  }, [filesData, folderId, uploadFileTracked])

  // Traitement récursif d'une entrée FileSystem (fichier ou répertoire)
  const processEntry = useCallback(async (entry: FileSystemEntry, parentFolderId: string | null): Promise<void> => {
    if (entry.isFile) {
      const fileEntry = entry as FileSystemFileEntry
      const file = await new Promise<File>((res, rej) => fileEntry.file(res, rej))
      uploadFileTracked(file, parentFolderId)
    } else if (entry.isDirectory) {
      const dirEntry = entry as FileSystemDirectoryEntry
      const { folder } = await filesApi.createFolder(entry.name, parentFolderId)
      qc.invalidateQueries({ queryKey: ['folders'] })
      qc.invalidateQueries({ queryKey: ['tree-children'] })
      const entries = await readAllEntries(dirEntry.createReader())
      for (const child of entries) await processEntry(child, folder.id)
    }
  }, [uploadFileTracked, qc])

  // Input fichiers classique
  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    Array.from(e.target.files ?? []).forEach(f => enqueueUpload(f, folderId))
    e.target.value = ''
  }

  // Input dossier (<input webkitdirectory>)
  const handleFolderInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (files.length === 0) return

    // Regrouper par répertoire racine
    const byRoot = new Map<string, File[]>()
    files.forEach(f => {
      const parts = (f.webkitRelativePath || f.name).split('/')
      const root  = parts[0]
      if (!byRoot.has(root)) byRoot.set(root, [])
      byRoot.get(root)!.push(f)
    })

    byRoot.forEach(async (rootFiles, rootName) => {
      const { folder: rootFolder } = await filesApi.createFolder(rootName, folderId)
      qc.invalidateQueries({ queryKey: ['folders'] })
      qc.invalidateQueries({ queryKey: ['tree-children'] })

      for (const f of rootFiles) {
        const parts = (f.webkitRelativePath || f.name).split('/')
        // parts[0] = root, parts[last] = file, parts[1..last-1] = subdirs
        const subParts = parts.slice(1, -1)
        let parentId: string = rootFolder.id

        for (const sub of subParts) {
          const { folder: subFolder } = await filesApi.createFolder(sub, parentId)
          qc.invalidateQueries({ queryKey: ['folders'] })
          qc.invalidateQueries({ queryKey: ['tree-children'] })
          parentId = subFolder.id
        }

        uploadFileTracked(f, parentId)
      }
    })

    e.target.value = ''
  }

  // ── Drag & drop depuis l'OS ───────────────────────────────────────────────

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    dragCounter.current++
    if (dragCounter.current === 1 && e.dataTransfer.types.includes('Files')) setIsDragOver(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    dragCounter.current--
    if (dragCounter.current === 0) setIsDragOver(false)
  }

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault() }

  const handleDrop = useCallback((e: React.DragEvent, targetFolderId: string | null = folderId) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current = 0
    setIsDragOver(false)
    setDragOverFolderId(null)

    // Déplacement interne (folder → folder)
    if (draggingItem && targetFolderId !== null) {
      const idsToMove = selectedIds.has(draggingItem.id) ? [...selectedIds] : [draggingItem.id]
      const moves: Promise<unknown>[] = []
      for (const id of idsToMove) {
        const kind = itemTypeMap.get(id) ?? draggingItem.type
        if (kind === 'folder' && id !== targetFolderId) {
          moves.push(filesApi.moveFolder(id, targetFolderId))
        } else if (kind === 'file') {
          moves.push(filesApi.moveFile(id, targetFolderId))
        }
      }
      Promise.all(moves).then(() => {
        (qc.invalidateQueries({ queryKey: ['folders'] }), qc.invalidateQueries({ queryKey: ['tree-children'] }))
        qc.invalidateQueries({ queryKey: ['files'] })
      })
      setDraggingItem(null)
      return
    }

    // Import depuis l'OS
    const items = Array.from(e.dataTransfer.items)
    const entries = items
      .map(item => item.webkitGetAsEntry?.() ?? null)
      .filter((en): en is FileSystemEntry => en !== null)

    if (entries.length > 0) {
      entries.forEach(en => processEntry(en, targetFolderId))
    } else {
      Array.from(e.dataTransfer.files).forEach(f => enqueueUpload(f, targetFolderId))
    }
  }, [folderId, draggingItem, selectedIds, itemTypeMap, processEntry, enqueueUpload, qc])

  // ── Mutations ─────────────────────────────────────────────────────────────

  const invalidateAll = () => {
    (qc.invalidateQueries({ queryKey: ['folders'] }), qc.invalidateQueries({ queryKey: ['tree-children'] }))
    qc.invalidateQueries({ queryKey: ['files'] })
    qc.invalidateQueries({ queryKey: ['tree-children'] })
    refreshUser()
  }

  // Suppression différée annulable (5 s) : planifie l'opération réelle, l'UI
  // affiche les box concernées en « en cours de suppression » via le store.
  const scheduleDelete = (kind: DeletionKind, items: PendingItem[]) => {
    if (items.length === 0) return
    usePendingDeletionStore.getState().schedule({
      kind, items,
      label:     t(kind === 'permanent' ? 'app.del_pending_perm' : 'app.del_pending_trash', { count: items.length }),
      undoLabel: t('common.cancel'),
      commit: (its) => {
        const ops = its.map(it =>
          kind === 'permanent'
            ? (it.type === 'file' ? filesApi.deleteFile(it.id) : filesApi.deleteFolder(it.id))
            : (it.type === 'file' ? filesApi.trashFile(it.id)  : filesApi.trashFolder(it.id)),
        )
        if (its.some(it => it.type === 'folder' && it.id === folderId)) navigate(null)
        // Promise résolue après le refetch (les invalidateQueries se résolvent une
        // fois les requêtes rafraîchies) → le store garde le style jusque-là.
        return Promise.allSettled(ops)
          .then((results) => {
            // Collecte les motifs d'échec précis (ex. élément protégé) renvoyés par
            // le backend, pour les afficher dans une boîte de dialogue.
            const msgs = Array.from(new Set(
              results
                .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
                .map(r => {
                  const e = r.reason as { response?: { data?: { message?: string } } }
                  return e?.response?.data?.message ?? null
                })
                .filter((m): m is string => !!m),
            ))
            return Promise.all([
              qc.invalidateQueries({ queryKey: ['folders'] }),
              qc.invalidateQueries({ queryKey: ['files'] }),
              qc.invalidateQueries({ queryKey: ['tree-children'] }),
            ]).then(() => { refreshUser(); return msgs })
          })
          .then((msgs) => {
            if (msgs.length > 0) {
              void confirm({
                title:        t('app.delete_blocked_title', { defaultValue: 'Suppression impossible' }),
                message:      msgs.join('\n\n'),
                confirmLabel: t('common.ok', { defaultValue: 'OK' }),
                hideCancel:   true,
                variant:      'warning',
              })
            }
          })
      },
    })
  }

  const starFolderMut = useMutation({
    mutationFn: (id: string) => filesApi.starFolder(id),
    onSuccess: invalidateAll,
  })
  const restoreFolderMut = useMutation({
    mutationFn: (id: string) => filesApi.restoreFolder(id),
    onSuccess: invalidateAll,
  })

  const starFileMut = useMutation({
    mutationFn: (id: string) => filesApi.starFile(id),
    onSuccess: invalidateAll,
  })
  const restoreFileMut = useMutation({
    mutationFn: (id: string) => filesApi.restoreFile(id),
    onSuccess: invalidateAll,
  })
  const purgeTrashMut = useMutation({
    mutationFn: () => filesApi.purgeTrash(),
    onSuccess: invalidateAll,
  })

  // ── Menu handlers ─────────────────────────────────────────────────────────

  const openMenu = (e: React.MouseEvent, type: 'folder' | 'file', item: Folder | FileItem) => {
    e.preventDefault()
    e.stopPropagation()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const x  = Math.min(e.clientX, vw - 200)
    const y  = Math.min(e.clientY, vh - 280)
    setMenu({ type, item, x, y } as MenuTarget)
  }

  const handleMenuStar = () => {
    if (!menu) return
    if (menu.type === 'folder') starFolderMut.mutate(menu.item.id)
    else                        starFileMut.mutate(menu.item.id)
  }
  const handleMenuTrash = (permanent = false) => {
    if (!menu) return
    scheduleDelete(permanent ? 'permanent' : 'trash', [{ id: menu.item.id, type: menu.type }])
  }
  const handleMenuDelete = () => {
    if (!menu) return
    scheduleDelete('permanent', [{ id: menu.item.id, type: menu.type }])
  }
  const handleMenuRestore = () => {
    if (!menu) return
    if (menu.type === 'folder') restoreFolderMut.mutate(menu.item.id)
    else                        restoreFileMut.mutate(menu.item.id)
  }

  const handleMenuCut = () => {
    if (!menu) return
    setClipboard({ action: 'cut', type: menu.type, id: menu.item.id, name: menu.item.name })
  }

  const handleMenuCopy = () => {
    if (!menu) return
    setClipboard({ action: 'copy', type: menu.type, id: menu.item.id, name: menu.item.name })
  }

  const handleMenuPaste = (targetFolderId: string | null) => {
    if (!clipboard) return
    if (clipboard.action === 'copy' && clipboard.type === 'file') {
      filesApi.copyFile(clipboard.id, targetFolderId)
        .then(() => qc.invalidateQueries({ queryKey: ['files'] }))
    } else if (clipboard.action === 'cut' && clipboard.type === 'file') {
      filesApi.moveFile(clipboard.id, targetFolderId)
        .then(() => { qc.invalidateQueries({ queryKey: ['files'] }); clearClipboard() })
    } else if (clipboard.action === 'cut' && clipboard.type === 'folder') {
      filesApi.moveFolder(clipboard.id, targetFolderId)
        .then(() => { (qc.invalidateQueries({ queryKey: ['folders'] }), qc.invalidateQueries({ queryKey: ['tree-children'] })); clearClipboard() })
    }
  }

  const handleMenuCompress = () => {
    if (!menu) return
    const name = menu.item.name
    if (menu.type === 'file') {
      filesApi.compressDownload([menu.item.id], [], name + '.zip')
    } else if (menu.type === 'folder') {
      filesApi.compressDownload([], [menu.item.id], name + '.zip')
    }
  }

  const handleCompressSave = async () => {
    if (!menu) return
    const useSelection = selectedIds.size > 1 && selectedIds.has(menu.item.id)
    const baseName = useSelection
      ? 'archive.zip'
      : menu.item.name.replace(/\.zip$/i, '') + '.zip'
    const result = await useFilesDialogStore.getState().saveFile({
      defaultName:     baseName,
      defaultFolderId: folderId,
    })
    if (!result) return
    const fileIds   = useSelection
      ? [...selectedIds].filter(id => itemTypeMap.get(id) === 'file')
      : menu.type === 'file' ? [menu.item.id] : []
    const folderIds = useSelection
      ? [...selectedIds].filter(id => itemTypeMap.get(id) === 'folder')
      : menu.type === 'folder' ? [menu.item.id] : []
    filesApi.compressSave(fileIds, folderIds, result.name, result.folderId)
      .then(() => invalidateAll())
      .catch(() => {})
  }

  const handleBulkCompress = async () => {
    const result = await useFilesDialogStore.getState().saveFile({
      defaultName:     'archive.zip',
      defaultFolderId: folderId,
    })
    if (!result) return
    const fileIds   = [...selectedIds].filter(id => itemTypeMap.get(id) === 'file')
    const folderIds = [...selectedIds].filter(id => itemTypeMap.get(id) === 'folder')
    filesApi.compressSave(fileIds, folderIds, result.name, result.folderId)
      .then(() => { invalidateAll(); setSelectedIds(new Set()) })
      .catch(() => {})
  }

  const handleDecompress = () => {
    if (!menu || menu.type !== 'file') return
    filesApi.decompress(menu.item.id, folderId, true)
      .then(() => invalidateAll())
      .catch(() => {})
  }

  const handleSetFolderColor = (color: string | null) => {
    if (!menu || menu.type !== 'folder') return
    filesApi.setFolderColor(menu.item.id, color)
      .then(() => (qc.invalidateQueries({ queryKey: ['folders'] }), qc.invalidateQueries({ queryKey: ['tree-children'] })))
  }

  const handleGetLink = async () => {
    if (!menu) return
    try {
      const opts = menu.type === 'file'
        ? { file_id: menu.item.id, can_download: true }
        : { folder_id: menu.item.id, can_download: true }
      const { share } = await filesApi.createShare(opts)
      if (share.token) {
        const url = `${window.location.origin}/api/v1/drive/share/${share.token}`
        await navigator.clipboard.writeText(url)
      }
    } catch (_) { /* silently ignore */ }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      className="relative flex h-full overflow-hidden"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={e => handleDrop(e)}
    >
      {/* Inputs cachés — id exposés pour que le toolbar puisse les cibler via <label> */}
      <input id="files-upload-input" ref={fileInputRef}   type="file" multiple hidden onChange={handleFileInput} />
      <input
        id="files-folder-input"
        ref={folderInputRef}
        type="file"
        multiple
        hidden
        // @ts-expect-error — attribut non-standard mais largement supporté
        webkitdirectory="true"
        onChange={handleFolderInput}
      />

      {/* Overlay drag & drop */}
      {isDragOver && (
        <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center
                        justify-center gap-3 rounded-2xl border-2 border-dashed border-primary
                        bg-primary/5 transition-all">
          <CloudUpload size={52} className="text-primary opacity-80" />
          <p className="text-primary font-medium text-sm">{t('mfb.drop_here')}</p>
          <p className="text-primary/60 text-xs">{t('app.accepted')}</p>
        </div>
      )}

      {/* Vue normale unifiée : zone d'exploration partagée (StorageExplorer). */}
      {isPlainNormal && (
        <StorageExplorer
          source={driveSource}
          pathParam="folder"
          title={t('nav.my_drive', { defaultValue: 'Mon Drive' })}
          onOpenFile={f => { openFile(f); return true }}
        />
      )}

      {/* Recherche + vues spéciales (Corbeille/Étoilés/Partagés/Récents) — rendu DriveApp. */}
      {!isPlainNormal && (
      <div
        ref={marqueeContainerRef}
        className="flex-1 min-w-0 overflow-y-auto p-6"
        onPointerDown={onMarqueeDown}
        onPointerMove={onMarqueeMove}
        onPointerUp={onMarqueeUp}
        onPointerCancel={onMarqueeCancel}
      >
        {/* Recherche d'images similaires (appareil photo) — prioritaire */}
        {imageSearch && (
          <ImageSearchResultsView state={imageSearch} onClear={clearImageSearch} onOpen={openFile} />
        )}

        {/* Mode recherche texte */}
        {!imageSearch && isSearchMode && (
          <SearchResultsView
            searchQuery={searchQuery}
            searchFilters={searchFilters}
            onClear={clearSearch}
            onOpen={openFile}
          />
        )}

        {/* Vue normale */}
        {!imageSearch && !isSearchMode && (
          <>
            {/* Toolbar inline : fil d'ariane + contrôles */}
            <div className="flex items-start gap-3 mb-5">
              <div className="flex-1 min-w-0">
                <Breadcrumb
                  folder={!starred && !shared && !recent && !trashed ? currentFolder : null}
                  ancestors={ancestors}
                  pageTitle={pageTitle ?? t('nav.my_files')}
                  onNavigate={navigate}
                />
              </div>

              <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
                {/* Selection action bar */}
                {selectedIds.size > 0 && (
                  <>
                    <span className="text-sm text-text-secondary mr-1">
                      {t('storage.selected', { count: selectedIds.size })}
                    </span>
                    <Button
                      variant={allItemsSelected ? 'secondary' : 'primary'}
                      size="sm"
                      icon={allItemsSelected ? <CheckSquare size={14} /> : <ListChecks size={14} />}
                      onClick={toggleSelectAll}
                    >
                      {allItemsSelected ? t('app.deselect_all') : t('app.select_all')}
                    </Button>
                    {!trashed ? (
                      <>
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={<Archive size={14} />}
                        onClick={handleBulkCompress}
                      >
                        Compresser
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        icon={<Trash2 size={14} />}
                        disabled={hasProtectedInSelection || hasPlayingInSelection || selectedIds.size === 0}
                        onClick={() => {
                          const items: PendingItem[] = [...selectedIds].map(id => ({ id, type: itemTypeMap.get(id) === 'file' ? 'file' : 'folder' }))
                          scheduleDelete('trash', items)
                          setSelectedIds(new Set())
                        }}
                      >
                        {t('common.delete')}
                      </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          variant="secondary"
                          size="sm"
                          icon={<RotateCcw size={14} />}
                          onClick={() => {
                            const ids = [...selectedIds]
                            ids.filter(id => itemTypeMap.get(id) === 'file').forEach(id => restoreFileMut.mutate(id))
                            ids.filter(id => itemTypeMap.get(id) === 'folder').forEach(id => restoreFolderMut.mutate(id))
                            setSelectedIds(new Set())
                          }}
                        >
                          {t('ctx.restore')}
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          icon={<Trash2 size={14} />}
                          onClick={() => {
                            const items: PendingItem[] = [...selectedIds].map(id => ({ id, type: itemTypeMap.get(id) === 'file' ? 'file' : 'folder' }))
                            scheduleDelete('permanent', items)
                            setSelectedIds(new Set())
                          }}
                        >
                          {t('common.delete')}
                        </Button>
                      </>
                    )}
                    <button
                      onClick={() => setSelectedIds(new Set())}
                      className="p-1.5 rounded-full hover:bg-surface-2 text-text-tertiary transition-colors"
                      title={t('app.cancel_selection')}
                    >
                      <X size={16} />
                    </button>
                    <div className="w-px h-5 bg-border mx-0.5" />
                  </>
                )}
                {trashed && selectedIds.size === 0 && (
                  <Button
                    variant="danger"
                    size="sm"
                    icon={<Trash2 size={14} />}
                    disabled={purgeTrashMut.isPending}
                    onClick={async () => {
                      const ok = await confirm({
                        title:        t('app.empty_trash_q'),
                        message:      t('app.empty_trash_msg'),
                        confirmLabel: t('app.empty_trash'),
                        variant:      'danger',
                      })
                      if (ok) purgeTrashMut.mutate()
                    }}
                  >
                    {t('app.empty_trash')}
                  </Button>
                )}
                {!trashed && !shared && !recent && !starred && (
                  <>
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={<FolderInput size={14} />}
                      onClick={() => folderInputRef.current?.click()}
                    >
                      {t('app.folder_btn')}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={<Upload size={14} />}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      {t('common.import')}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={<FolderPlus size={14} />}
                      onClick={openNewFolder}
                    >
                      {t('newfolder.title')}
                    </Button>
                  </>
                )}
              </div>
            </div>

            {isLoading ? (
              <div className="flex items-center gap-2 text-text-secondary text-sm py-16 justify-center">
                <Loader2 size={18} className="animate-spin" />
                {t('common.loading')}
              </div>
            ) : filesError ? (
              <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
                <Info size={36} className="text-danger" />
                <p className="text-danger text-sm font-medium">{t('app.module_down_title')}</p>
                <p className="text-text-tertiary text-xs">{t('app.module_down_hint')}</p>
              </div>
            ) : folders.length === 0 && filteredFiles.length === 0 ? (
              <EmptyState trashed={trashed} starred={starred} shared={shared} recent={recent} />
            ) : (
              <div className="space-y-6">
                {/* Sort / filter bar */}
                {files.length > 0 && !trashed && !recent && !starred && !shared && (
                  <SortFilterBar
                    sortField={sortField}
                    sortDir={sortDir}
                    typeFilter={typeFilter}
                    onSortField={setSortField}
                    onSortDir={setSortDir}
                    onTypeFilter={setTypeFilter}
                    viewMode={viewMode}
                    onViewMode={setViewMode}
                    compact={compact}
                    onCompact={setCompact}
                    showHidden={showHidden}
                    onShowHidden={setShowHidden}
                  />
                )}

                {/* Vues spéciales (récents/étoilés/corbeille/partagés) : menu Afficher seul. */}
                {files.length > 0 && (trashed || recent || starred || shared) && (
                  <div className="flex items-center pb-3 -mx-6 px-6 border-b border-border">
                    <div className="ml-auto">
                      <ViewMenu
                        value={viewMode} onChange={setViewMode}
                        compact={compact} onCompact={setCompact}
                        showHidden={showHidden} onShowHidden={setShowHidden}
                        t={t}
                      />
                    </div>
                  </div>
                )}

                {folders.length > 0 && (
                  <section>
                    <h2 className="text-xs font-semibold uppercase tracking-wider text-text-tertiary mb-2">
                      {trashed ? t('app.folders_trash') : t('app.folders')}
                    </h2>
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2">
                      {folders.map(folder => (
                        <FolderCard
                          key={folder.id}
                          folder={folder}
                          isDragTarget={dragOverFolderId === folder.id}
                          selected={selectedIds.has(folder.id)}
                          preSelected={preSelectedIds.has(folder.id)}
                          trashed={trashed}
                          onSelect={handleItemSelect}
                          onToggle={handleItemToggle}
                          onOpen={() => { if (!trashed) navigate(folder.id) }}
                          onContextMenu={e => openMenu(e, 'folder', folder)}
                          onDragStart={() => {
                            if (!selectedIds.has(folder.id)) { setSelectedIds(new Set([folder.id])); lastSelectedIdxRef.current = orderedIds.indexOf(folder.id) }
                            setDraggingItem({ type: 'folder', id: folder.id })
                          }}
                          onDragOver={e => { e.preventDefault(); e.stopPropagation(); setDragOverFolderId(folder.id) }}
                          onDragLeave={() => setDragOverFolderId(null)}
                          onDrop={e => handleDrop(e, folder.id)}
                        />
                      ))}
                    </div>
                  </section>
                )}

                {filteredFiles.length > 0 && (
                  <section>
                    <h2 className="text-xs font-semibold uppercase tracking-wider text-text-tertiary mb-2">
                      {trashed ? t('app.files_trash') : t('app.files')}
                      {typeFilter && filteredFiles.length !== files.length && (
                        <span className="ml-2 normal-case font-normal text-text-tertiary">
                          — {filteredFiles.length} / {files.length}
                        </span>
                      )}
                    </h2>
                    {(() => {
                      const spec = VIEW_SPECS[viewMode]
                      if (spec.kind === 'icons') {
                        return (
                          <div className="grid" style={{ gridTemplateColumns: `repeat(auto-fill,minmax(${spec.min}px,1fr))`, gap: compact ? 6 : 12 }}>
                            {filteredFiles.map(file => (
                              <FileCard
                                key={file.id}
                                file={file}
                                trashed={trashed}
                                selected={selectedIds.has(file.id)}
                                preSelected={preSelectedIds.has(file.id)}
                                onSelect={handleItemSelect}
                                onToggle={handleItemToggle}
                                onContextMenu={e => openMenu(e, 'file', file)}
                                onDragStart={() => {
                                  if (!selectedIds.has(file.id)) { setSelectedIds(new Set([file.id])); lastSelectedIdxRef.current = orderedIds.indexOf(file.id) }
                                  setDraggingItem({ type: 'file', id: file.id })
                                }}
                                onRestore={() => restoreFileMut.mutate(file.id)}
                                onDelete={() => scheduleDelete('permanent', [{ id: file.id, type: 'file' }])}
                                onOpen={() => openFile(file)}
                                thumbH={spec.thumbH}
                                iconScale={spec.iconScale}
                                dense={spec.dense}
                              />
                            ))}
                          </div>
                        )
                      }
                      if (spec.kind === 'tiles') {
                        return (
                          <div className="grid" style={{ gridTemplateColumns: `repeat(auto-fill,minmax(${spec.min}px,1fr))`, gap: compact ? 6 : 10 }}>
                            {filteredFiles.map(file => (
                              <div key={file.id} className="border border-border rounded-lg overflow-hidden bg-white hover:border-border-strong transition-colors">
                                <FileRow file={file} trashed={trashed} onContextMenu={e => openMenu(e, 'file', file)} onRestore={() => restoreFileMut.mutate(file.id)} onDelete={() => scheduleDelete('permanent', [{ id: file.id, type: 'file' }])} onOpen={() => openFile(file)} hideMeta />
                              </div>
                            ))}
                          </div>
                        )
                      }
                      if (spec.multicol) {
                        return (
                          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))', gap: 2 }}>
                            {filteredFiles.map(file => (
                              <FileRow key={file.id} file={file} trashed={trashed} onContextMenu={e => openMenu(e, 'file', file)} onRestore={() => restoreFileMut.mutate(file.id)} onDelete={() => scheduleDelete('permanent', [{ id: file.id, type: 'file' }])} onOpen={() => openFile(file)} density="compact" hideMeta />
                            ))}
                          </div>
                        )
                      }
                      return (
                        <div className="divide-y divide-border rounded-xl border border-border overflow-hidden">
                          {filteredFiles.map(file => (
                            <FileRow key={file.id} file={file} trashed={trashed} onContextMenu={e => openMenu(e, 'file', file)} onRestore={() => restoreFileMut.mutate(file.id)} onDelete={() => scheduleDelete('permanent', [{ id: file.id, type: 'file' }])} onOpen={() => openFile(file)} density={spec.density} />
                          ))}
                        </div>
                      )
                    })()}
                  </section>
                )}
              </div>
            )}
          </>
        )}
      </div>
      )}

      {/* Context menu */}
      {menu && (
        <MenuDropdown
          pos={{ top: menu.y, left: menu.x }}
          onClose={() => { setMenu(null); setContextMenuFolderId(null) }}
          items={buildItemMenuItems(menu, t, {
            isTrashed: menu.item.is_trashed,
            isPlaying: isMenuItemPlaying,
            isMultiSelection: selectedIds.size > 1 && selectedIds.has(menu.item.id),
            selectionCount: selectedIds.size,
            clipboard,
            onClose: () => { setMenu(null); setContextMenuFolderId(null) },
            onRename: () => {
              // Renommage en lot (PowerRename) pour TOUT renommage : sur la sélection
              // si plusieurs éléments, sinon sur le seul élément cliqué.
              const multi = selectedIds.size > 1 && selectedIds.has(menu.item.id)
              const ids = multi ? [...selectedIds] : [menu.item.id]
              const out: BatchRenameItem[] = []
              for (const id of ids) {
                const fo = folders.find(x => x.id === id)
                if (fo) { out.push({ id: fo.id, name: fo.name, type: 'folder' }); continue }
                const fi = files.find(x => x.id === id)
                if (fi) out.push({ id: fi.id, name: fi.name, type: 'file' })
              }
              useBatchRenameStore.getState().start(out)
            },
            onMove: () => { setMoveTarget({ type: menu.type, item: menu.item } as MoveTarget) },
            onStar: handleMenuStar,
            onTrash: handleMenuTrash,
            onDelete: handleMenuDelete,
            onRestore: handleMenuRestore,
            onShare: () => {
              if (menu.type === 'file')   setShareTarget({ type: 'file',   item: menu.item as FileItem })
              if (menu.type === 'folder') setShareTarget({ type: 'folder', item: menu.item as Folder })
            },
            onGetLink: handleGetLink,
            onInfo: () => {
              if (menu.type === 'file')   setInfoTarget({ type: 'file',   item: menu.item as FileItem })
              if (menu.type === 'folder') setInfoTarget({ type: 'folder', item: menu.item as Folder })
            },
            onEditPaint: () => {
              if (menu.type === 'file') useFilesPaintStore.getState().openEditor(menu.item as FileItem)
            },
            onVersionHistory: () => {
              if (menu.type === 'file') setVersionTarget(menu.item as FileItem)
            },
            onCut: handleMenuCut,
            onCopy: handleMenuCopy,
            onPaste: () => {
              const targetId = menu.type === 'folder' ? menu.item.id : folderId
              handleMenuPaste(targetId)
            },
            onCompress: handleMenuCompress,
            onCompressSave: handleCompressSave,
            onDecompress: handleDecompress,
            onSetColor: handleSetFolderColor,
          })}
        />
      )}

      {/* Marquee selection overlay */}
      {marqueeStyle && marqueeStyle.width > 2 && marqueeStyle.height > 2 && (
        <div
          className="pointer-events-none z-50 rounded border border-primary/50 bg-primary/10"
          style={marqueeStyle}
        />
      )}

      {/* Modals */}
      <NewFolderModal open={newFolderOpen} onClose={closeNewFolder} parentId={folderId} />
      <ImportUrlModal />
      <RemoteStoragePanel />
      <RenameModal   target={renameTarget} onClose={() => setRenameTarget(null)} siblingNames={[...folders.map(f => f.name), ...files.map(f => f.name)]} />
      {batchOpen && <BatchRenameModal items={batchItems} onClose={closeBatch} />}
      <MoveModal     target={moveTarget}   onClose={() => setMoveTarget(null)} />
      <ShareModal          target={shareTarget}    onClose={() => setShareTarget(null)} />
      <FileInfoModal       target={infoTarget}     onClose={() => setInfoTarget(null)} />
      <VersionHistoryModal file={versionTarget}    onClose={() => setVersionTarget(null)} />

      {/* Archive browser */}
      {archiveFile && (
        <ArchiveBrowser file={archiveFile} onClose={() => setArchiveFile(null)} />
      )}

      {/* Panneau d'upload */}
      <UploadPanel />

      {/* Conflit d'upload */}
      {uploadConflictQueue.length > 0 && (
        <ConflictDialog
          type="file"
          name={uploadConflictQueue[0].file.name}
          onChoice={handleUploadConflictChoice}
        />
      )}

      {/* Lightbox image — remplacé par PhotosImageViewer si le module photos est actif */}
      {lightboxFile && (
        ImageViewer
          ? <ImageViewer
              file={lightboxFile}
              imageFiles={filteredFiles.filter(f => f.mime_type.startsWith('image/'))}
              onClose={() => setLightboxFile(null)}
            />
          : <FilesLightbox
              file={lightboxFile}
              imageFiles={filteredFiles.filter(f => f.has_thumbnail && f.mime_type.startsWith('image/'))}
              onClose={() => setLightboxFile(null)}
            />
      )}

      {/* Lecteur vidéo — remplacé par le module media si actif */}
      {videoFile && (
        VideoPlayer
          ? <VideoPlayer
              file={videoFile}
              onClose={closeVideoFile}
              initialPosition={videoRestorePos}
              onInitialPositionConsumed={videoClearPos}
              onTimeUpdate={(t) => { (window as Window & { __filesVideoPos?: number }).__filesVideoPos = t }}
            />
          : <FilesVideoPlayer file={videoFile} onClose={closeVideoFile} />
      )}

      {/* Visionneuse 3D */}
      {model3dFile && (
        <Files3DViewer file={model3dFile} onClose={() => setModel3dFile(null)} />
      )}

      {/* Visionneuse police */}
      {fontFile && (
        <FilesFontViewer file={fontFile} onClose={() => setFontFile(null)} />
      )}

      {/* Visionneuse texte */}
      {textFile && (
        <FilesTextViewer
          name={textFile.name}
          load={() => filesApi.downloadBlob(textFile.id)}
          onClose={() => setTextFile(null)}
        />
      )}

      {/* Visionneuse PDF */}
      {pdfFile && (
        <PdfViewerModal
          url={filesApi.downloadUrl(pdfFile.id)}
          filename={pdfFile.name}
          onClose={() => setPdfFile(null)}
        />
      )}

      {confirmState && (
        <ConfirmDialog {...confirmState} onConfirm={handleConfirm} onCancel={handleCancel} />
      )}
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

// ── Search helpers ────────────────────────────────────────────────────────────

/** Sanitise l'extrait `ts_headline` : échappe tout le HTML puis réautorise `<b>`. */
function sanitizeSnippet(raw: string): string {
  const escaped = raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return escaped
    .replace(/&lt;b&gt;/g, '<b>')
    .replace(/&lt;\/b&gt;/g, '</b>')
}

// Vignette image/vidéo : on tente TOUJOURS le thumbnail (le serveur le génère à la
// volée s'il manque — y compris les vidéos via ffmpeg). En cas d'échec (fichier
// corrompu, format non décodable…) on retombe sur l'icône de type.
function ThumbImg({ file, src, className }: { file: FileItem; src: string; className: string }) {
  const [err, setErr] = useState(false)
  const thumbable = file.mime_type.startsWith('image/') || file.mime_type.startsWith('video/')
  if (err || !thumbable) return <>{getFileIcon(file.mime_type, file.name)}</>
  return <img src={src} alt={file.name} className={className} loading="lazy" onError={() => setErr(true)} />
}

// ── SearchResultRow ───────────────────────────────────────────────────────────

function SearchResultRow({ file, onOpen }: { file: SearchHit; onOpen: (file: FileItem) => void }) {
  const { t, i18n } = useTranslation('drive')
  const updated = new Date(file.updated_at).toLocaleDateString(i18n.language, {
    day: '2-digit', month: 'short', year: 'numeric',
  })
  const thumbVer = useImageCacheStore(s => s.global + (s.versions[file.id] ?? 0))
  const thumbSrc = thumbVer ? `${filesApi.thumbnailUrl(file.id)}?v=${thumbVer}` : filesApi.thumbnailUrl(file.id)

  return (
    <div className="group flex items-start gap-4 py-3 px-2 rounded-lg hover:bg-surface-1 transition-colors">
      <div className="flex-shrink-0 w-10 flex items-center justify-center pt-0.5">
        <ThumbImg file={file} src={thumbSrc} className="w-9 h-9 object-cover rounded" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onOpen(file)}
            className="text-[15px] font-medium text-primary hover:underline truncate text-left"
          >
            {file.name}
          </button>
          {file.match_kind === 'semantic' && (
            <span className="flex-shrink-0 text-[10px] uppercase tracking-wide text-primary bg-primary-light px-1.5 py-0.5 rounded-full">
              {t('search.badge_semantic')}
            </span>
          )}
          {file.is_starred && <Star size={13} className="flex-shrink-0 fill-yellow-400 text-yellow-400" />}
          {file.is_trashed && (
            <span className="flex-shrink-0 text-xs text-danger bg-danger-light px-2 py-0.5 rounded-full">
              {t('nav.trash')}
            </span>
          )}
        </div>
        {/* Chemin du fichier (dossier parent) */}
        <p className="text-xs text-text-tertiary mt-0.5 truncate flex items-center gap-1">
          <FolderIcon size={11} className="flex-shrink-0 opacity-70" />
          {file.folder_path && file.folder_path !== '/' ? file.folder_path : t('nav.my_drive', { defaultValue: 'Mon Drive' })}
        </p>
        {file.snippet && (
          <p
            className="text-xs text-text-secondary mt-1 line-clamp-2 [&_b]:text-text-primary [&_b]:font-semibold"
            dangerouslySetInnerHTML={{ __html: sanitizeSnippet(file.snippet) }}
          />
        )}
        <p className="text-xs text-text-tertiary mt-0.5">{formatSize(file.size_bytes)} · {updated}</p>
      </div>
      <a
        href={filesApi.downloadUrl(file.id)}
        target="_blank"
        rel="noreferrer"
        className="flex-shrink-0 p-1.5 rounded hover:bg-surface-2 opacity-0 group-hover:opacity-100 transition-all"
        onClick={e => e.stopPropagation()}
        aria-label={`${t('common.download')} ${file.name}`}
      >
        <Download size={14} className="text-text-secondary" />
      </a>
    </div>
  )
}

// ── SearchResultsView ─────────────────────────────────────────────────────────

function SearchResultsView({
  searchQuery,
  searchFilters,
  onClear,
  onOpen,
}: {
  searchQuery: string
  searchFilters: FilesSearchFilters
  onClear: () => void
  onOpen: (file: FileItem) => void
}) {
  const { t } = useTranslation('drive')
  const PAGE_SIZE = 20

  // Débounce de la requête (250 ms) : une recherche par pause de frappe, pas par caractère.
  const [debouncedQ, setDebouncedQ] = useState(searchQuery)
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(searchQuery), 250)
    return () => clearTimeout(id)
  }, [searchQuery])

  // Onglets de type (Tous / Images / Vidéos) — pilotent le filtre de type.
  const [tab, setTab] = useState<'all' | 'image' | 'video'>('all')
  const [page, setPage] = useState(0)

  const hasCriteria =
    debouncedQ.trim().length > 0 ||
    searchFilters.itemName.trim().length > 0 ||
    searchFilters.containsWords.trim().length > 0

  // L'onglet prime sur le type du panneau de filtres (Tous = type du panneau).
  const effFilters: FilesSearchFilters = useMemo(
    () => ({ ...searchFilters, type: tab === 'all' ? searchFilters.type : tab }),
    [searchFilters, tab],
  )

  // Réinitialise la page à 0 quand la requête / les filtres / l'onglet changent.
  useEffect(() => { setPage(0) }, [debouncedQ, effFilters])

  const { data, isFetching } = useQuery({
    queryKey: ['files-search', debouncedQ.trim(), effFilters, page],
    queryFn:  () => filesApi.searchFiles(debouncedQ.trim(), effFilters, { limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
    enabled:  hasCriteria,
    placeholderData: prev => prev, // garde la page précédente pendant le chargement
  })

  const results   = data?.results ?? []
  const total     = data?.total ?? 0
  const semantic  = data?.semantic ?? false
  const isLoading = hasCriteria && isFetching && !data
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const label = searchQuery ? t('app.search_for', { query: searchQuery }) : t('app.search_results')

  const TABS: Array<{ id: 'all' | 'image' | 'video'; label: string }> = [
    { id: 'all',   label: t('search.tab_all', { defaultValue: 'Tous' }) },
    { id: 'image', label: t('search.tab_images', { defaultValue: 'Images' }) },
    { id: 'video', label: t('search.tab_videos', { defaultValue: 'Vidéos' }) },
  ]

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-medium text-text-primary">{label}</h1>
            {semantic && (
              <span className="text-[10px] uppercase tracking-wide text-primary bg-primary-light px-2 py-0.5 rounded-full">
                {t('search.semantic_on')}
              </span>
            )}
          </div>
          <p className="text-sm text-text-secondary mt-0.5">
            {isLoading ? t('app.searching') : t('app.result_count', { count: total })}
          </p>
        </div>
        <button
          onClick={onClear}
          className="flex items-center gap-2 text-sm text-primary hover:text-primary-hover transition-colors"
        >
          <X size={16} />
          {t('app.clear_search')}
        </button>
      </div>

      {/* Onglets de type */}
      <div className="flex items-center gap-1 border-b border-border mb-4">
        {TABS.map(tb => (
          <button
            key={tb.id}
            onClick={() => setTab(tb.id)}
            className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-colors ${
              tab === tb.id
                ? 'border-primary text-primary'
                : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            {tb.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-text-secondary text-sm py-16 justify-center">
          <Loader2 size={18} className="animate-spin" />
          {t('app.searching')}
        </div>
      ) : results.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
          <Search size={52} className="text-text-tertiary" />
          <p className="text-text-secondary text-sm">{t('app.no_results')}</p>
          <p className="text-text-tertiary text-xs">{t('app.no_results_hint')}</p>
        </div>
      ) : (
        <>
          <div className={`divide-y divide-border ${isFetching ? 'opacity-60' : ''}`}>
            {results.map(file => <SearchResultRow key={file.id} file={file} onOpen={onOpen} />)}
          </div>

          {/* Pagination */}
          {pageCount > 1 && (
            <div className="flex items-center justify-center gap-3 mt-6">
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg border border-border text-text-secondary hover:bg-surface-1 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronLeft size={15} /> {t('app.prev', { defaultValue: 'Précédent' })}
              </button>
              <span className="text-sm text-text-secondary">{t('app.page_of', { defaultValue: 'Page {{page}} / {{total}}', page: page + 1, total: pageCount })}</span>
              <button
                onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))}
                disabled={page >= pageCount - 1}
                className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg border border-border text-text-secondary hover:bg-surface-1 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {t('app.next', { defaultValue: 'Suivant' })} <ChevronRight size={15} />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Recherche d'images similaires (résultats) ──────────────────────────────────

function ImageSearchResultsView({
  state, onClear, onOpen,
}: {
  state: { name: string; loading: boolean; results: SearchHit[]; total: number }
  onClear: () => void
  onOpen: (file: FileItem) => void
}) {
  const { t } = useTranslation('drive')
  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <div className="flex items-center gap-2">
            <Camera size={18} className="text-primary" />
            <h1 className="text-xl font-medium text-text-primary truncate">
              {t('search.similar_to', { defaultValue: 'Images similaires à « {{name}} »', name: state.name })}
            </h1>
          </div>
          <p className="text-sm text-text-secondary mt-0.5">
            {state.loading ? t('app.searching') : t('app.result_count', { count: state.total })}
          </p>
        </div>
        <button onClick={onClear} className="flex items-center gap-2 text-sm text-primary hover:text-primary-hover transition-colors">
          <X size={16} /> {t('app.clear_search')}
        </button>
      </div>

      {state.loading ? (
        <div className="flex items-center gap-2 text-text-secondary text-sm py-16 justify-center">
          <Loader2 size={18} className="animate-spin" />
          {t('app.searching')}
        </div>
      ) : state.results.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
          <Camera size={52} className="text-text-tertiary" />
          <p className="text-text-secondary text-sm">{t('search.no_similar', { defaultValue: 'Aucune image similaire trouvée' })}</p>
        </div>
      ) : (
        <div className="divide-y divide-border">
          {state.results.map(file => <SearchResultRow key={file.id} file={file} onOpen={onOpen} />)}
        </div>
      )}
    </div>
  )
}

function FolderCard({
  folder, isDragTarget, selected, preSelected, trashed, onSelect, onToggle, onOpen, onContextMenu, onDragStart, onDragOver, onDragLeave, onDrop,
}: {
  folder: Folder
  isDragTarget: boolean
  selected: boolean
  preSelected?: boolean
  trashed?: boolean
  onSelect: (id: string, e: React.MouseEvent) => void
  onToggle: (id: string) => void
  onOpen: () => void
  onContextMenu: (e: React.MouseEvent) => void
  onDragStart: () => void
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: () => void
  onDrop: (e: React.DragEvent) => void
}) {
  const pendingKind = usePendingKind(folder.id)
  return (
    <div
      data-selectable-id={folder.id}
      className={`group relative flex items-center gap-2.5 px-3 py-2.5 rounded-xl border transition-all
                  cursor-default select-none min-w-0
                  ${isDragTarget
                    ? 'border-primary bg-primary/10 ring-2 ring-primary/20'
                    : selected
                    ? 'border-primary ring-2 ring-primary/20 bg-[#c9defa]'
                    : preSelected
                    ? 'border-primary/50 bg-[#c9defa]'
                    : 'border-[#e8eaed] bg-[#f3f4f5] hover:border-border hover:bg-[#e4ecf7] hover:shadow-sm'
                  } ${pendingBoxClass(pendingKind)}`}
      style={pendingBoxStyle(pendingKind)}
      draggable
      onClick={(e) => { e.preventDefault(); onSelect(folder.id, e) }}
      onDoubleClick={(e) => { e.preventDefault(); e.stopPropagation(); onOpen() }}
      onContextMenu={onContextMenu}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* Checkbox */}
      <FloatCheckbox
        selected={selected}
        onToggle={() => onToggle(folder.id)}
        className="absolute -top-1.5 -left-1.5 z-10"
      />
      <FolderGlyph folder={folder} size={20} className={`shrink-0 ${trashed ? 'opacity-50' : ''}`} />
      <span className={`text-sm truncate flex-1 ${trashed ? 'text-text-secondary line-through' : 'text-text-primary'}`}>{folder.name}</span>
      {folder.is_starred && !trashed && (
        <Star size={12} className="shrink-0 fill-yellow-400 text-yellow-400" />
      )}
      {trashed && (
        <Trash2 size={12} className="shrink-0 text-text-tertiary opacity-60" />
      )}
      <button
        className="shrink-0 p-1 rounded-full hover:bg-black/10 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={e => { e.stopPropagation(); onContextMenu(e) }}
      >
        <MoreVertical size={14} className="text-text-secondary" />
      </button>
    </div>
  )
}

const _videoPreviewCache = new Map<string, string>()

function FileCard({
  file, trashed, selected, preSelected, onSelect, onToggle, onContextMenu, onDragStart, onRestore, onDelete, onOpen,
  thumbH = 128, iconScale = 1, dense = false,
}: {
  file: FileItem
  trashed: boolean
  selected: boolean
  preSelected?: boolean
  onSelect: (id: string, e: React.MouseEvent) => void
  onToggle: (id: string) => void
  onContextMenu: (e: React.MouseEvent) => void
  onDragStart: () => void
  onRestore: () => void
  onDelete: () => void
  onOpen: () => void
  thumbH?: number
  iconScale?: number
  dense?: boolean
}) {
  const { t } = useTranslation('drive')
  const pendingKind = usePendingKind(file.id)
  const isImage = file.mime_type.startsWith('image/')
  const isVideo = file.mime_type.startsWith('video/')
  // On tente toujours le thumbnail pour images & vidéos (génération serveur à la volée)
  // ; `thumbErr` bascule sur l'icône de type si le serveur ne peut pas le produire.
  const [thumbErr, setThumbErr] = useState(false)
  const hasBigThumb = isImage || isVideo
  const thumbVer = useImageCacheStore(s => s.global + (s.versions[file.id] ?? 0))
  const thumbSrc = thumbVer ? `${filesApi.thumbnailUrl(file.id)}?v=${thumbVer}` : filesApi.thumbnailUrl(file.id)
  const videoRef    = useRef<HTMLVideoElement>(null)
  const fetchingRef = useRef(false)
  const [videoPlaying, setVideoPlaying] = useState(false)

  const startVideoPreview = useCallback(async () => {
    if (fetchingRef.current || !videoRef.current) return
    if (videoRef.current.src && videoRef.current.src.startsWith('blob:')) {
      setVideoPlaying(true)
      videoRef.current.currentTime = 0
      videoRef.current.play().catch(() => {})
      return
    }
    const cached = _videoPreviewCache.get(file.id)
    if (cached) {
      videoRef.current.src = cached
      setVideoPlaying(true)
      videoRef.current.play().catch(() => {})
      return
    }
    fetchingRef.current = true
    try {
      const token = useAuthStore.getState().accessToken
      const res = await fetch(`/api/v1/drive/${file.id}/download`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Range: 'bytes=0-10485760',
        },
      })
      if (!res.ok) return
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      _videoPreviewCache.set(file.id, url)
      if (videoRef.current) {
        videoRef.current.src = url
        setVideoPlaying(true)
        videoRef.current.play().catch(() => {})
      }
    } catch {/* ignore */} finally {
      fetchingRef.current = false
    }
  }, [file.id])

  const stopVideoPreview = useCallback(() => {
    setVideoPlaying(false)
    if (videoRef.current) { videoRef.current.pause(); videoRef.current.currentTime = 0 }
  }, [])

  useEffect(() => {
    if (!isVideo || !hasBigThumb) return
    if (selected) { void startVideoPreview() }
    else stopVideoPreview()
  }, [selected]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault()
    onSelect(file.id, e)
  }
  const handleDoubleClick = (e: React.MouseEvent) => {
    if (trashed) return
    e.preventDefault()
    onOpen()
  }

  const handleVideoMouseEnter = () => { void startVideoPreview() }
  const handleVideoMouseLeave = () => { if (!selected) stopVideoPreview() }
  const handleVideoTimeUpdate = () => {
    if (videoRef.current && videoRef.current.currentTime >= 5) stopVideoPreview()
  }
  const handleVideoEnded = () => stopVideoPreview()

  return (
    <div
      data-selectable-id={file.id}
      className={`group relative rounded-xl border
                 hover:shadow-[0_1px_6px_rgba(0,0,0,0.1)]
                 transition-all min-w-0 select-none cursor-default overflow-hidden
                 ${selected
                   ? 'border-primary ring-2 ring-primary/20 bg-[#ddeafc]'
                   : preSelected
                   ? 'border-primary/50 bg-[#ddeafc]'
                   : 'border-[#e8eaed] bg-surface-1 hover:border-border hover:bg-[#e4ecf7]'
                 } ${pendingBoxClass(pendingKind)}`}
      style={pendingBoxStyle(pendingKind)}
      draggable={!trashed}
      onContextMenu={onContextMenu}
      onDragStart={onDragStart}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
    >
      {/* Checkbox overlay */}
      <FloatCheckbox
        selected={selected}
        onToggle={() => onToggle(file.id)}
        className="absolute top-2 left-2 z-10"
      />

      {/* En-tête : icône de type + nom + étoile + menu (la checkbox couvre l'icône au survol) */}
      <div className={`flex items-center gap-2 ${dense ? 'px-2 h-8' : 'px-3 h-10'}`}>
        <span className="shrink-0 flex items-center [&_svg]:w-[18px] [&_svg]:h-[18px]">{getFileIcon(file.mime_type, file.name)}</span>
        <span className={`${dense ? 'text-xs' : 'text-[13px]'} font-medium truncate flex-1 ${trashed ? 'text-text-secondary line-through' : 'text-text-primary'}`} title={file.name}>{file.name}</span>
        {file.is_starred && !trashed && <Star size={12} className="shrink-0 fill-yellow-400 text-yellow-400" />}
        <button className="shrink-0 -mr-1.5 p-1 rounded-full hover:bg-black/10 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => { e.stopPropagation(); onContextMenu(e) }}>
          <MoreVertical size={14} className="text-text-secondary" />
        </button>
      </div>
      {/* Aperçu : miniature pleine zone (images & vidéos), sinon grande icône de type */}
      <div
        className={`relative overflow-hidden rounded-lg bg-white ${dense ? 'mx-1.5 mb-1.5' : 'mx-2 mb-2'}`}
        style={{ height: thumbH }}
        onMouseEnter={isVideo && hasBigThumb && !thumbErr ? handleVideoMouseEnter : undefined}
        onMouseLeave={isVideo && hasBigThumb && !thumbErr ? handleVideoMouseLeave : undefined}
      >
        {hasBigThumb && !thumbErr ? (
          <>
            <img
              src={thumbSrc}
              alt={file.name}
              className={`w-full h-full object-cover transition-opacity duration-200 ${videoPlaying ? 'opacity-0' : 'opacity-100'}`}
              loading="lazy"
              onError={() => setThumbErr(true)}
            />
            {isVideo && (
              <video
                ref={videoRef}
                muted
                playsInline
                preload="none"
                onTimeUpdate={handleVideoTimeUpdate}
                onEnded={handleVideoEnded}
                className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-200 ${videoPlaying ? 'opacity-100' : 'opacity-0'}`}
              />
            )}
            {isVideo && !videoPlaying && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-9 h-9 rounded-full bg-black/50 flex items-center justify-center">
                  <Play size={16} className="text-white ml-0.5" fill="white" />
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <div style={{ transform: `scale(${iconScale})` }}>{getFileIcon(file.mime_type, file.name)}</div>
          </div>
        )}
      </div>

      {trashed ? (
        <div className="absolute inset-0 flex flex-col items-center justify-end pb-2
                        opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="flex gap-1 bg-white/90 rounded-lg shadow px-2 py-1">
            <button
              onClick={e => { e.stopPropagation(); onRestore() }}
              className="flex items-center gap-1 px-2 py-1 text-xs text-success hover:bg-success/10 rounded"
            >
              <RotateCcw size={11} /> {t('ctx.restore')}
            </button>
            <button
              onClick={e => { e.stopPropagation(); onDelete() }}
              className="flex items-center gap-1 px-2 py-1 text-xs text-danger hover:bg-danger/10 rounded"
            >
              <Trash2 size={11} /> {t('common.delete')}
            </button>
          </div>
        </div>
      ) : (
        <button
          className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 p-1 rounded-full
                     hover:bg-black/10 transition-opacity"
          onClick={e => { e.stopPropagation(); onContextMenu(e) }}
        >
          <MoreVertical size={14} className="text-text-secondary" />
        </button>
      )}
    </div>
  )
}

// ── FileRow (vue liste) ───────────────────────────────────────────────────────

function FileRow({ file, trashed, onContextMenu, onRestore, onDelete, onOpen, density = 'normal', hideMeta = false }: {
  file: FileItem
  trashed: boolean
  onContextMenu: (e: React.MouseEvent) => void
  onRestore: () => void
  onDelete: () => void
  onOpen: () => void
  density?: 'compact' | 'normal' | 'large'
  hideMeta?: boolean
}) {
  const { t, i18n } = useTranslation('drive')
  const pendingKind = usePendingKind(file.id)
  const updated = new Date(file.updated_at).toLocaleDateString(i18n.language, { day: '2-digit', month: 'short', year: 'numeric' })
  const thumbVer = useImageCacheStore(s => s.global + (s.versions[file.id] ?? 0))
  const thumbSrc = thumbVer ? `${filesApi.thumbnailUrl(file.id)}?v=${thumbVer}` : filesApi.thumbnailUrl(file.id)
  const pad   = density === 'compact' ? 'px-3 py-1' : density === 'large' ? 'px-4 py-3.5' : 'px-4 py-2.5'
  const thumb = density === 'large' ? 'w-12 h-12' : density === 'compact' ? 'w-6 h-6' : 'w-8 h-8'
  return (
    <div
      className={`group flex items-center gap-3 ${pad} bg-white hover:bg-surface-1 transition-colors cursor-default select-none ${pendingBoxClass(pendingKind)}`}
      style={pendingBoxStyle(pendingKind)}
      onContextMenu={onContextMenu}
      onDoubleClick={!trashed ? e => { e.preventDefault(); onOpen() } : undefined}
    >
      <div className={`shrink-0 ${thumb} flex items-center justify-center rounded overflow-hidden bg-surface-2`}>
        {file.has_thumbnail
          ? <img src={thumbSrc} alt={file.name} className="w-full h-full object-cover" />
          : <span className="scale-75">{getFileIcon(file.mime_type, file.name)}</span>
        }
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-text-primary truncate">{file.name}</p>
        {density === 'large' && <p className="text-[11px] text-text-tertiary truncate">{file.mime_type} · {formatSize(file.size_bytes)}</p>}
      </div>
      {!hideMeta && <span className="text-xs text-text-tertiary shrink-0 w-28 text-right">{updated}</span>}
      {!hideMeta && <span className="text-xs text-text-tertiary shrink-0 w-20 text-right">{formatSize(file.size_bytes)}</span>}
      {file.is_starred && !trashed && (
        <Star size={13} className="shrink-0 fill-yellow-400 text-yellow-400" />
      )}
      {trashed ? (
        <div className="flex gap-1 shrink-0">
          <button onClick={e => { e.stopPropagation(); onRestore() }}
            className="flex items-center gap-1 px-2 py-1 text-xs text-success hover:bg-success/10 rounded">
            <RotateCcw size={11} /> {t('ctx.restore')}
          </button>
          <button onClick={e => { e.stopPropagation(); onDelete() }}
            className="flex items-center gap-1 px-2 py-1 text-xs text-danger hover:bg-danger/10 rounded">
            <Trash2 size={11} /> {t('common.delete')}
          </button>
        </div>
      ) : (
        <button
          className="shrink-0 p-1.5 rounded-full hover:bg-surface-2 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={e => { e.stopPropagation(); onContextMenu(e) }}
        >
          <MoreVertical size={14} className="text-text-secondary" />
        </button>
      )}
    </div>
  )
}

// ── SortFilterBar ─────────────────────────────────────────────────────────────

function SortFilterBar({
  sortField, sortDir, typeFilter, onSortField, onSortDir, onTypeFilter, viewMode, onViewMode, compact, onCompact, showHidden, onShowHidden,
}: {
  sortField: 'name' | 'size' | 'date' | 'type'
  sortDir: 'asc' | 'desc'
  typeFilter: string | null
  onSortField: (v: 'name' | 'size' | 'date' | 'type') => void
  onSortDir: (v: 'asc' | 'desc') => void
  onTypeFilter: (v: string | null) => void
  viewMode: ViewMode
  onViewMode: (v: ViewMode) => void
  compact: boolean
  onCompact: (v: boolean) => void
  showHidden: boolean
  onShowHidden: (v: boolean) => void
}) {
  const { t } = useTranslation('drive')
  const SORT_OPTIONS = [
    { value: 'date',  label: t('app.sort_date') },
    { value: 'name',  label: t('common.name') },
    { value: 'size',  label: t('common.size') },
    { value: 'type',  label: t('filter.type') },
  ]
  const TYPE_OPTIONS = [
    { value: '',         label: t('app.ft_all') },
    { value: 'image',    label: t('app.ft_images') },
    { value: 'video',    label: t('filter.t_video') },
    { value: 'audio',    label: t('filter.t_audio') },
    { value: 'document', label: t('filter.t_document') },
    { value: 'archive',  label: t('filter.t_archive') },
  ]
  return (
    <div className="flex flex-wrap items-center gap-2 pb-3 -mx-6 px-6 border-b border-border">
      {/* Sort selector */}
      <div className="flex items-center gap-1">
        <span className="text-sm text-text-tertiary select-none font-medium">{t('app.sort_label')}</span>
        <Dropdown
          variant="ghost"
          value={sortField}
          onChange={v => onSortField(v as typeof sortField)}
          options={SORT_OPTIONS}
        />
        <button
          onClick={() => onSortDir(sortDir === 'asc' ? 'desc' : 'asc')}
          className="ml-0.5 text-sm text-text-secondary hover:text-primary transition-colors select-none"
          title={sortDir === 'asc' ? t('app.sort_asc') : t('app.sort_desc')}
        >
          {sortDir === 'asc' ? '↑' : '↓'}
        </button>
      </div>

      {/* Separator */}
      <div className="h-5 w-px bg-border" />

      {/* Type filter dropdown */}
      <div className="flex items-center gap-1">
        <span className="text-sm text-text-tertiary select-none font-medium">{t('app.type_label')}</span>
        <Dropdown
          variant="ghost"
          value={typeFilter ?? ''}
          onChange={v => onTypeFilter(v === '' ? null : v)}
          options={TYPE_OPTIONS}
        />
      </div>

      {/* Menu « Afficher » façon explorateur Windows. */}
      <div className="ml-auto">
        <ViewMenu
          value={viewMode} onChange={onViewMode}
          compact={compact} onCompact={onCompact}
          showHidden={showHidden} onShowHidden={onShowHidden}
          t={t}
        />
      </div>
    </div>
  )
}

function EmptyState({ trashed, starred, shared, recent }: { trashed: boolean; starred: boolean; shared: boolean; recent: boolean }) {
  const { t } = useTranslation('drive')
  if (trashed)  return (
    <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
      <Trash2 size={52} className="text-text-tertiary" />
      <p className="text-text-secondary text-sm">{t('app.empty_trash_state')}</p>
    </div>
  )
  if (starred)  return (
    <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
      <Star size={52} className="text-text-tertiary" />
      <p className="text-text-secondary text-sm">{t('app.empty_starred')}</p>
      <p className="text-text-tertiary text-xs">{t('app.empty_starred_hint')}</p>
    </div>
  )
  if (shared)   return (
    <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
      <Share2 size={52} className="text-text-tertiary" />
      <p className="text-text-secondary text-sm">{t('app.empty_shared')}</p>
    </div>
  )
  if (recent)   return (
    <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
      <FolderIcon size={52} className="text-text-tertiary" />
      <p className="text-text-secondary text-sm">{t('app.empty_recent')}</p>
    </div>
  )
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
      <CloudUpload size={52} className="text-text-tertiary" />
      <p className="text-text-secondary text-sm">{t('app.empty_folder')}</p>
      <p className="text-text-tertiary text-xs">
        {t('app.dnd_hint', { import: t('common.import'), folder: t('app.folder_btn') })}
      </p>
    </div>
  )
}

// ── Lecteur vidéo ────────────────────────────────────────────────────────────

function FilesVideoPlayer({ file, onClose }: { file: FileItem; onClose: () => void }) {
  const { t } = useTranslation('drive')
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 bg-black/95 flex flex-col" onClick={onClose}>
      <div
        className="flex items-center justify-between px-4 py-3 bg-black/60 shrink-0"
        onClick={e => e.stopPropagation()}
      >
        <div>
          <p className="text-white text-sm font-medium truncate max-w-[60vw]">{file.name}</p>
          <p className="text-white/50 text-xs">{formatSize(file.size_bytes)}</p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={filesApi.downloadUrl(file.id)}
            download={file.name}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-white/10 hover:bg-white/20 text-white rounded-lg transition-colors"
            onClick={e => e.stopPropagation()}
          >
            <Download size={14} />
            {t('common.download')}
          </a>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full text-white transition-colors">
            <X size={18} />
          </button>
        </div>
      </div>

      <div
        className="flex-1 flex items-center justify-center p-6"
        onClick={e => e.stopPropagation()}
      >
        <video
          src={filesApi.downloadUrl(file.id)}
          controls
          autoPlay
          className="max-h-full max-w-full rounded-lg shadow-2xl"
          style={{ maxHeight: 'calc(100vh - 120px)' }}
        />
      </div>
    </div>
  )
}

// ── Lightbox images ───────────────────────────────────────────────────────────

function FilesLightbox({
  file,
  imageFiles,
  onClose,
}: {
  file: FileItem
  imageFiles: FileItem[]
  onClose: () => void
}) {
  const { t } = useTranslation('drive')
  const initialIdx = imageFiles.findIndex(f => f.id === file.id)
  const [idx, setIdx] = useState(initialIdx < 0 ? 0 : initialIdx)
  const current = imageFiles[idx] ?? file
  const thumbVer = useImageCacheStore(s => s.versions[current.id] ?? 0)
  const thumbSrc = thumbVer ? `${filesApi.thumbnailUrl(current.id)}?v=${thumbVer}` : filesApi.thumbnailUrl(current.id)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape')      onClose()
      if (e.key === 'ArrowLeft')   setIdx(i => Math.max(0, i - 1))
      if (e.key === 'ArrowRight')  setIdx(i => Math.min(imageFiles.length - 1, i + 1))
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose, imageFiles.length])

  return (
    <div className="fixed inset-0 z-50 bg-black/92 flex flex-col" onClick={onClose}>
      {/* En-tête */}
      <div
        className="flex items-center justify-between px-4 py-3 bg-black/60 shrink-0"
        onClick={e => e.stopPropagation()}
      >
        <div>
          <p className="text-white text-sm font-medium truncate max-w-[60vw]">{current.name}</p>
          <p className="text-white/50 text-xs">{formatSize(current.size_bytes)}</p>
        </div>
        <div className="flex items-center gap-2">
          {imageFiles.length > 1 && (
            <span className="text-white/50 text-xs">{idx + 1} / {imageFiles.length}</span>
          )}
          <a
            href={filesApi.downloadUrl(current.id)}
            download={current.name}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-white/10 hover:bg-white/20 text-white rounded-lg transition-colors"
            onClick={e => e.stopPropagation()}
          >
            <Download size={14} />
            {t('common.download')}
          </a>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/10 rounded-full text-white transition-colors"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Image principale */}
      <div className="flex-1 flex items-center justify-center relative overflow-hidden" onClick={e => e.stopPropagation()}>
        {idx > 0 && (
          <button
            onClick={() => setIdx(i => i - 1)}
            className="absolute left-3 z-10 p-2 bg-black/40 hover:bg-black/60 rounded-full text-white transition-colors"
          >
            <ChevronLeft size={22} />
          </button>
        )}

        <img
          key={`${current.id}-${thumbVer}`}
          src={thumbSrc}
          alt={current.name}
          className="max-h-full max-w-full object-contain"
          draggable={false}
        />

        {idx < imageFiles.length - 1 && (
          <button
            onClick={() => setIdx(i => i + 1)}
            className="absolute right-3 z-10 p-2 bg-black/40 hover:bg-black/60 rounded-full text-white transition-colors"
          >
            <ChevronRight size={22} />
          </button>
        )}
      </div>
    </div>
  )
}
