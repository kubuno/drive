import { useTranslation } from 'react-i18next'
import {
  RotateCcw, Trash2, Download, Pencil, AppWindow, Image, Wand2, CopyPlus,
  Tags, Share2, Link, Link2, Unlock, Lock, Move, Star, FolderInput,
  Scissors, Copy, ClipboardPaste, Archive, PackageOpen, Info, History, Palette, Eraser,
} from 'lucide-react'
import { filesApi, FOLDER_COLORS, type Folder, type FileItem } from '@kubuno/drive'
import type { MenuItem } from '@ui'
import { hasReclaimableHistory, type FileVersionStats } from '../fileVersions'
import type { MenuTarget } from './types'

// Item context menu: handlers contract, folder colour grid and the builder that
// turns a menu target into <MenuDropdown> items.

export interface ItemMenuHandlers {
  onClose: () => void
  onRename: () => void
  onMove: () => void
  onStar: () => void
  onTrash: (permanent: boolean) => void
  onDelete: () => void
  onRestore: () => void
  onShare: () => void
  onGetLink: () => void
  onAdvancedShare: () => void
  onInfo: () => void
  onEditPaint: () => void
  onVersionHistory: () => void
  /** Drops the file's whole history, handing the reclaimed bytes back to the quota. */
  onPurgeVersions: () => void
  onCut: () => void
  onCopy: () => void
  onPaste: () => void
  onCompress: () => void
  onCompressSave: () => void
  onDecompress: () => void
  onSetColor: (color: string | null) => void
  onTags: () => void
  onLock: () => void
  onUnlock: () => void
  onEditImage: () => void
  onDuplicate: () => void
  /** Items of the "Open with" submenu (computed by the component). */
  openWithItems: MenuItem[]
  clipboard: { action: 'cut' | 'copy'; type: 'file' | 'folder'; id: string; name: string } | null
  isTrashed: boolean
  isPlaying: boolean
  isLocked: boolean
  isMultiSelection: boolean
  selectionCount: number
}

// Folder colour grid, rendered inside the "Organize" submenu (custom item).
function FolderColorGrid({ current, onPick }: { current?: string | null; onPick: (c: string | null) => void }) {
  const { t } = useTranslation('drive')
  return (
    <div className="px-3 py-2">
      <p className="flex items-center gap-1.5 text-xs text-text-tertiary mb-2 font-medium">
        <Palette size={12} />
        {t('ctx.folder_color')}
      </p>
      <div className="grid grid-cols-6 gap-1.5">
        {FOLDER_COLORS.map((c, i) => (
          <button
            key={i}
            title={c ?? t('ctx.no_color')}
            onClick={() => onPick(c)}
            className="w-6 h-6 rounded-full border-2 flex items-center justify-center hover:scale-110 transition-transform"
            style={{
              backgroundColor: c ?? '#f1f3f4',
              borderColor: c === current ? '#1a73e8' : (c ? c : '#dadce0'),
              boxShadow: c === current ? '0 0 0 2px #fff, 0 0 0 4px #1a73e8' : undefined,
            }}
          >
            {c === null && <span style={{ fontSize: 10, color: '#80868b', lineHeight: 1 }}>✕</span>}
          </button>
        ))}
      </div>
    </div>
  )
}

// Builds the context menu items for <MenuDropdown>. "Open with" and "Organize"
// use MenuDropdown's NATIVE `submenu` type (homogeneous styling + portal-rendered
// sub-panel, so it is never clipped by the menu's own scrolling).
export function buildItemMenuItems(
  menu: NonNullable<MenuTarget>,
  tr: (k: string, opts?: Record<string, unknown>) => string,
  h: ItemMenuHandlers,
): MenuItem[] {
  const { clipboard, isTrashed, isPlaying, isLocked, isMultiSelection, selectionCount } = h
  const isFile   = menu.type === 'file'
  const isFolder = menu.type === 'folder'
  const starred  = isFile
    ? (menu.item as FileItem).is_starred
    : (menu.item as Folder).is_starred
  const folderColor  = isFolder ? (menu.item as Folder).color : null
  const isProtected  = isFolder && !!(menu.item as Folder).is_protected
  const trashDisabled = isProtected || isPlaying
  const isZip = isFile && (() => {
    const it = menu.item as FileItem
    const n  = it.name.toLowerCase()
    return it.mime_type.includes('zip') || it.mime_type.includes('tar') || it.mime_type.includes('gzip')
      || n.endsWith('.zip') || n.endsWith('.tar') || n.endsWith('.tar.gz') || n.endsWith('.tgz')
  })()

  const items: MenuItem[] = []

  // Multi-selection label (header).
  if (isMultiSelection) {
    items.push({ type: 'label', text: tr('app.items_selected', { count: selectionCount }) })
  }

  if (isTrashed) {
    items.push({ type: 'action', label: tr('ctx.restore'), icon: <RotateCcw size={14} />, onClick: h.onRestore, disabled: isMultiSelection })
    items.push({ type: 'action', label: tr('ctx.delete_perm'), icon: <Trash2 size={14} />, danger: true, onClick: h.onDelete, disabled: isPlaying || isMultiSelection })
    return items
  }

  // Download: file → direct download (new tab); folder → zip.
  if (isFile) {
    items.push({
      type: 'action', label: tr('common.download'), icon: <Download size={14} />,
      disabled: isMultiSelection,
      onClick: () => { window.open(filesApi.downloadUrl((menu.item as FileItem).id), '_blank', 'noreferrer') },
    })
  } else {
    items.push({ type: 'action', label: tr('ctx.download_zip'), icon: <Download size={14} />, onClick: h.onCompress, disabled: isMultiSelection })
  }

  // Rename — in multi-selection, opens the batch rename (PowerRename).
  items.push({ type: 'action', label: tr('common.rename'), shortcut: 'F2', icon: <Pencil size={14} />, onClick: h.onRename, disabled: isProtected })

  // Open with (files) — native submenu.
  if (isFile && !isMultiSelection) {
    items.push({
      type: 'submenu',
      label: tr('ctx.open_with'),
      icon: <AppWindow size={14} />,
      disabled: h.openWithItems.length === 0,
      items: h.openWithItems,
    })
  }

  // Image editing: Paint (freehand editing) + Adjust (rotate/crop/convert).
  if (isFile && (menu.item as FileItem).mime_type.startsWith('image/')) {
    items.push({ type: 'action', label: tr('ctx.edit_paint'), icon: <Image size={14} />, onClick: h.onEditPaint, disabled: isMultiSelection })
    items.push({ type: 'action', label: 'Ajuster l’image', icon: <Wand2 size={14} />, onClick: h.onEditImage, disabled: isMultiSelection })
  }

  // Duplicate (files).
  if (isFile) {
    items.push({ type: 'action', label: 'Dupliquer', icon: <CopyPlus size={14} />, onClick: h.onDuplicate, disabled: isMultiSelection })
  }

  items.push({ type: 'separator' })

  // Labels (files and folders).
  items.push({ type: 'action', label: 'Étiquettes…', icon: <Tags size={14} />, onClick: h.onTags, disabled: isMultiSelection })

  // Share.
  items.push({ type: 'action', label: tr('ctx.share'), icon: <Share2 size={14} />, onClick: h.onShare, disabled: isMultiSelection })
  items.push({ type: 'action', label: tr('ctx.get_link'), icon: <Link size={14} />, onClick: h.onGetLink, disabled: isMultiSelection })
  items.push({ type: 'action', label: 'Partage avancé…', icon: <Link2 size={14} />, onClick: h.onAdvancedShare, disabled: isMultiSelection })

  // Lock / unlock (files).
  if (isFile && !isMultiSelection) {
    items.push(isLocked
      ? { type: 'action', label: 'Déverrouiller', icon: <Unlock size={14} />, onClick: h.onUnlock }
      : { type: 'action', label: 'Verrouiller', icon: <Lock size={14} />, onClick: h.onLock })
  }

  // Organize (native submenu): Move, Star, and — for folders — colour.
  {
    const organiserItems: MenuItem[] = [
      { type: 'action', label: tr('ctx.move'), icon: <Move size={14} />, onClick: h.onMove, disabled: isProtected },
      { type: 'separator' },
      {
        type: 'action',
        label: starred ? tr('ctx.unstar') : tr('ctx.star'),
        icon: <Star size={14} className={starred ? 'fill-yellow-400 text-yellow-400' : ''} />,
        onClick: h.onStar,
      },
    ]
    if (isFolder) {
      organiserItems.push({ type: 'separator' })
      organiserItems.push({
        type: 'custom',
        render: (close) => <FolderColorGrid current={folderColor} onPick={(c) => { h.onSetColor(c); close() }} />,
      })
    }
    items.push({
      type: 'submenu',
      label: tr('ctx.organize'),
      icon: <FolderInput size={14} />,
      disabled: isMultiSelection,
      items: organiserItems,
    })
  }

  items.push({ type: 'separator' })

  // Clipboard.
  items.push({ type: 'action', label: tr('ctx.cut'), icon: <Scissors size={14} />, onClick: h.onCut, disabled: isProtected || isMultiSelection })
  items.push({ type: 'action', label: tr('ctx.copy'), icon: <Copy size={14} />, onClick: h.onCopy, disabled: isMultiSelection })
  if (isFolder && clipboard && !isMultiSelection) {
    items.push({ type: 'action', label: tr('ctx.paste'), icon: <ClipboardPaste size={14} />, onClick: h.onPaste })
  }
  // Compress — works in multi-selection.
  items.push({ type: 'action', label: tr('ctx.compress'), icon: <Archive size={14} />, onClick: h.onCompressSave })
  if (isZip && !isMultiSelection) {
    items.push({ type: 'action', label: tr('ctx.decompress'), icon: <PackageOpen size={14} />, onClick: h.onDecompress })
  }

  items.push({ type: 'separator' })

  // Information.
  items.push({ type: 'action', label: isFolder ? tr('ctx.info_folder') : tr('ctx.info_file'), icon: <Info size={14} />, onClick: h.onInfo, disabled: isMultiSelection })
  if (isFile && !isMultiSelection) {
    items.push({ type: 'action', label: tr('version.title'), icon: <History size={14} />, onClick: h.onVersionHistory })
    // Kept revisions are billed to the quota. The entry only shows up when there
    // is actually something to reclaim — no history, no destructive noise.
    if (hasReclaimableHistory(menu.item as FileItem & FileVersionStats)) {
      items.push({ type: 'action', label: tr('version.purge'), icon: <Eraser size={14} />, danger: true, onClick: h.onPurgeVersions })
    }
  }

  items.push({ type: 'separator' })

  // Trash / permanent delete — works in multi-selection.
  // `custom` item to preserve the Shift shortcut (permanent delete): the click
  // event is not exposed by `action` items.
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
