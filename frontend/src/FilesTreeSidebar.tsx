import { useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Folder as FolderIcon, FolderOpen, ChevronRight, Star, Clock,
  Trash2, Share2, HardDrive, Server, FolderPlus, RefreshCw, Plug, Settings2, ExternalLink, Columns2, ServerCog,
  Search, X,
} from 'lucide-react'
import { MenuDropdown, type MenuItem, ConfirmDialog } from '@ui'
import { filesApi, FolderGlyph, type Folder, type RemoteConnection, type RemoteEntry } from '@kubuno/drive'
import { usePendingKind, pendingBoxClass, pendingBoxStyle, useConfirm, useAuthStore } from '@kubuno/sdk'
import { useFilesStore, type FilesSearchFilters } from '@kubuno/drive'
import { useDriveExtras, tagColorHex, type SavedSearch } from './driveExtras'
import { useFilesContextMenuStore } from './filesContextMenuStore'
import { SidebarNavItem } from '@kubuno/sdk'
// ── Folder tree node ──────────────────────────────────────────────────────────

function TreeNode({
  folder, depth, activeFolderId, contextMenuFolderId, refreshKey, onNavigate, onContextMenu,
}: {
  folder: Folder
  depth: number
  activeFolderId: string | null
  contextMenuFolderId: string | null
  refreshKey: number
  onNavigate: (id: string | null) => void
  onContextMenu: (folder: Folder, x: number, y: number) => void
}) {
  const { t } = useTranslation('drive')
  const [expanded, setExpanded] = useState(false)
  const pendingKind = usePendingKind(folder.id)
  const isActive = activeFolderId === folder.id
  const isContextTarget = contextMenuFolderId === folder.id

  const { data } = useQuery({
    queryKey: ['tree-children', folder.id, refreshKey],
    queryFn: () => filesApi.listFolders(folder.id),
    enabled: expanded,
  })

  const children = data?.folders ?? []

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const vw = window.innerWidth
    const vh = window.innerHeight
    onContextMenu(folder, Math.min(e.clientX, vw - 200), Math.min(e.clientY, vh - 320))
  }

  return (
    <div>
      <div
        className={`flex items-center gap-1 py-1 rounded-full cursor-pointer select-none
          ${isActive ? 'bg-primary-light' : isContextTarget ? 'bg-surface-3' : 'hover:bg-surface-2'} ${pendingBoxClass(pendingKind)}`}
        style={{ paddingLeft: `${8 + depth * 16}px`, paddingRight: '8px', ...pendingBoxStyle(pendingKind) }}
        onClick={() => onNavigate(folder.id)}
        onContextMenu={handleContextMenu}
      >
        <button
          className="shrink-0 p-0.5 rounded hover:bg-black/10"
          style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 150ms' }}
          onClick={e => { e.stopPropagation(); setExpanded(v => !v) }}
          aria-label={expanded ? t('common.collapse') : t('common.expand')}
        >
          <ChevronRight size={14} className="text-text-tertiary" />
        </button>
        <FolderGlyph folder={folder} size={15} className="shrink-0" color={isActive ? '#1a73e8' : undefined} />
        <span
          className="text-sm truncate ml-1 flex-1"
          style={{ color: isActive ? '#041e49' : '#5f6368', fontWeight: isActive ? 600 : 400 }}
        >
          {folder.name}
        </span>
      </div>

      {expanded && children.map(child => (
        <TreeNode
          key={child.id}
          folder={child}
          depth={depth + 1}
          activeFolderId={activeFolderId}
          contextMenuFolderId={contextMenuFolderId}
          refreshKey={refreshKey}
          onNavigate={onNavigate}
          onContextMenu={onContextMenu}
        />
      ))}
      {expanded && data && children.length === 0 && (
        <p
          className="text-xs text-text-tertiary italic py-0.5"
          style={{ paddingLeft: `${8 + (depth + 1) * 16 + 22}px` }}
        >
          {t('common.empty')}
        </p>
      )}
    </div>
  )
}

// ── Mon Drive section (expandable root) ───────────────────────────────────────

function DriveRootSection({
  activeFolderId, contextMenuFolderId, isInDrive, refreshKey, onNavigate, onContextMenu, onHeaderContextMenu,
}: {
  activeFolderId: string | null
  contextMenuFolderId: string | null
  isInDrive: boolean
  refreshKey: number
  onNavigate: (id: string | null) => void
  onContextMenu: (folder: Folder, x: number, y: number) => void
  onHeaderContextMenu?: (e: React.MouseEvent) => void
}) {
  const { t } = useTranslation('drive')
  // Enroulé par défaut (demande utilisateur).
  const [expanded, setExpanded] = useState(false)

  const { data } = useQuery({
    queryKey: ['tree-children', null, refreshKey],
    queryFn: () => filesApi.listFolders(null),
    enabled: expanded,
  })

  const folders = data?.folders ?? []
  const isRootActive = isInDrive && activeFolderId === null

  return (
    <div>
      <div
        className={`flex items-center gap-1 px-3 py-2 rounded-full cursor-pointer select-none
          ${isRootActive ? 'bg-primary-light' : 'hover:bg-surface-2'}`}
        onClick={() => onNavigate(null)}
        onContextMenu={onHeaderContextMenu}
      >
        <button
          className="shrink-0 p-0.5 rounded hover:bg-black/10"
          style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 150ms' }}
          onClick={e => { e.stopPropagation(); setExpanded(v => !v) }}
          aria-label={expanded ? t('tree.collapse_drive') : t('tree.expand_drive')}
        >
          <ChevronRight size={14} className="text-text-tertiary" />
        </button>
        <FolderOpen
          size={20}
          className="shrink-0"
          style={{ color: isRootActive ? '#1a73e8' : '#5f6368' }}
        />
        <span
          className="text-sm font-medium truncate ml-1 flex-1"
          style={{ color: isRootActive ? '#041e49' : '#5f6368', fontWeight: isRootActive ? 600 : 500 }}
        >
          {t('tree.my_drive')}
        </span>
      </div>

      {expanded && (
        <div className="pl-4">
          {folders.map(folder => (
            <TreeNode
              key={folder.id}
              folder={folder}
              depth={0}
              activeFolderId={activeFolderId}
              contextMenuFolderId={contextMenuFolderId}
              refreshKey={refreshKey}
              onNavigate={onNavigate}
              onContextMenu={onContextMenu}
            />
          ))}
          {data && folders.length === 0 && (
            <p className="text-xs text-text-tertiary italic py-1 pl-6">{t('common.empty')}</p>
          )}
        </div>
      )}
    </div>
  )
}

// ── Remote mount tree (live browse) ───────────────────────────────────────────

const REMOTE_STATUS_COLOR: Record<RemoteConnection['status'], string> = {
  connected: '#1e8e3e', syncing: '#1a73e8', error: '#d93025', disconnected: '#80868b',
}

function RemoteTreeNode({
  remoteId, entry, depth, activeRemoteId, activePath, onNavigate,
}: {
  remoteId: string
  entry: RemoteEntry
  depth: number
  activeRemoteId: string | null
  activePath: string
  onNavigate: (remoteId: string, path: string) => void
}) {
  const { t } = useTranslation('drive')
  const [expanded, setExpanded] = useState(false)
  const isActive = activeRemoteId === remoteId && activePath === entry.path

  const { data } = useQuery({
    queryKey: ['remote-browse', remoteId, entry.path],
    queryFn:  () => filesApi.browseRemote(remoteId, entry.path),
    enabled:  expanded,
    retry:    false,
  })
  const childDirs = (data ?? []).filter(e => e.is_dir)

  return (
    <div>
      <div
        className={`flex items-center gap-1 py-1 rounded-full cursor-pointer select-none
          ${isActive ? 'bg-primary-light' : 'hover:bg-surface-2'}`}
        style={{ paddingLeft: `${8 + depth * 16}px`, paddingRight: '8px' }}
        onClick={() => onNavigate(remoteId, entry.path)}
      >
        <button
          className="shrink-0 p-0.5 rounded hover:bg-black/10"
          style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 150ms' }}
          onClick={e => { e.stopPropagation(); setExpanded(v => !v) }}
          aria-label={expanded ? t('common.collapse') : t('common.expand')}
        >
          <ChevronRight size={14} className="text-text-tertiary" />
        </button>
        <FolderIcon size={15} className="shrink-0" style={{ color: isActive ? '#1a73e8' : '#5f6368' }} fill="currentColor" />
        <span className="text-sm truncate ml-1 flex-1" style={{ color: isActive ? '#041e49' : '#5f6368', fontWeight: isActive ? 600 : 400 }}>
          {entry.name}
        </span>
      </div>
      {expanded && childDirs.map(child => (
        <RemoteTreeNode
          key={child.path} remoteId={remoteId} entry={child} depth={depth + 1}
          activeRemoteId={activeRemoteId} activePath={activePath} onNavigate={onNavigate}
        />
      ))}
    </div>
  )
}

function RemoteSection({
  remote, activeRemoteId, activePath, onNavigate, onHeaderContextMenu,
}: {
  remote: RemoteConnection
  activeRemoteId: string | null
  activePath: string
  onNavigate: (remoteId: string, path: string) => void
  onHeaderContextMenu?: (e: React.MouseEvent) => void
}) {
  const { t } = useTranslation('drive')
  const [expanded, setExpanded] = useState(false)
  const isRootActive = activeRemoteId === remote.id && activePath === ''

  const { data } = useQuery({
    queryKey: ['remote-browse', remote.id, ''],
    queryFn:  () => filesApi.browseRemote(remote.id, ''),
    enabled:  expanded,
    retry:    false,
  })
  const dirs = (data ?? []).filter(e => e.is_dir)

  return (
    <div>
      <div
        className={`flex items-center gap-1 px-3 py-2 rounded-full cursor-pointer select-none
          ${isRootActive ? 'bg-primary-light' : 'hover:bg-surface-2'}`}
        onClick={() => onNavigate(remote.id, '')}
        onContextMenu={onHeaderContextMenu}
        title={t(`rs.status_${remote.status}`, { defaultValue: remote.status })}
      >
        <button
          className="shrink-0 p-0.5 rounded hover:bg-black/10"
          style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 150ms' }}
          onClick={e => { e.stopPropagation(); setExpanded(v => !v) }}
          aria-label={expanded ? t('common.collapse') : t('common.expand')}
        >
          <ChevronRight size={14} className="text-text-tertiary" />
        </button>
        <span className="relative shrink-0">
          <Server size={20} style={{ color: isRootActive ? '#1a73e8' : '#5f6368' }} />
          <span
            className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-white"
            style={{ backgroundColor: REMOTE_STATUS_COLOR[remote.status] }}
          />
        </span>
        <span className="text-sm font-medium truncate ml-1 flex-1" style={{ color: isRootActive ? '#041e49' : '#5f6368', fontWeight: isRootActive ? 600 : 500 }}>
          {remote.name}
        </span>
      </div>
      {expanded && (
        <div className="pl-4">
          {dirs.map(d => (
            <RemoteTreeNode
              key={d.path} remoteId={remote.id} entry={d} depth={0}
              activeRemoteId={activeRemoteId} activePath={activePath} onNavigate={onNavigate}
            />
          ))}
          {data && dirs.length === 0 && (
            <p className="text-xs text-text-tertiary italic py-1 pl-6">{t('common.empty')}</p>
          )}
        </div>
      )}
    </div>
  )
}

// ── Nav item (flat section) ───────────────────────────────────────────────────

function NavItem({
  icon, label, isActive, onClick,
}: {
  icon: React.ReactNode
  label: string
  isActive: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2 rounded-full text-sm
        transition-colors text-left select-none
        ${isActive ? 'bg-primary-light' : 'hover:bg-surface-2'}`}
    >
      <span className="flex-shrink-0" style={{ color: isActive ? '#1a73e8' : '#5f6368' }}>
        {icon}
      </span>
      <span className="truncate flex-1" style={{ color: isActive ? '#041e49' : '#5f6368', fontWeight: isActive ? 600 : 400 }}>
        {label}
      </span>
    </button>
  )
}

// ── FilesTreeSidebar ──────────────────────────────────────────────────────────

export default function FilesTreeSidebar({ collapsed = false }: { collapsed?: boolean }) {
  const { t } = useTranslation('drive')
  const { pathname } = useLocation()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { currentFolderId, refreshKey, openNewFolder, openRemotesPanel,
          setSearchQuery, setSearchFilters, applySearch } = useFilesStore()
  const savedSearches      = useDriveExtras(s => s.savedSearches)
  const deleteSavedSearch  = useDriveExtras(s => s.deleteSavedSearch)

  // Recall a saved search: push its query + filters into the core search store.
  const applySaved = (s: SavedSearch) => {
    setSearchQuery(s.query || '')
    if (s.filters && Object.keys(s.filters).length) {
      setSearchFilters(s.filters as Partial<FilesSearchFilters>)
    }
    applySearch()
    navigate('/drive')
  }
  const { openFolderMenu, contextMenuFolderId, setContextMenuFolderId } = useFilesContextMenuStore()
  const qc = useQueryClient()
  const { confirm, confirmState, handleConfirm, handleCancel } = useConfirm()
  const isAdmin = useAuthStore(s => s.user?.role === 'admin')

  // Menu contextuel local (Mon Drive / montages distants).
  const [ctx, setCtx] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  const openCtx = (e: React.MouseEvent, items: MenuItem[]) => {
    e.preventDefault(); e.stopPropagation()
    setCtx({ x: e.clientX, y: e.clientY, items })
  }

  // Montages distants : listés au même niveau que « Mon Drive », navigation LIVE.
  const { data: remotes = [] } = useQuery({ queryKey: ['remotes'], queryFn: filesApi.listRemotes })
  const remoteMatch    = pathname.match(/^\/drive\/remote\/([^/]+)/)
  const activeRemoteId = remoteMatch ? remoteMatch[1] : null
  const activeRemotePath = activeRemoteId ? (searchParams.get('path') ?? '') : ''
  const goToRemote = (remoteId: string, path: string) =>
    navigate(`/drive/remote/${remoteId}?path=${encodeURIComponent(path)}`)

  const isSpecial = ['/drive/recent', '/drive/starred', '/drive/shared', '/drive/trash', '/drive/settings', '/drive/storage', '/drive/remote', '/drive/split', '/drive/system'].some(
    p => pathname === p || pathname.startsWith(p + '/'),
  )
  const isInDrive = !isSpecial
  const isRecent  = pathname === '/drive/recent'
  const isStarred = pathname === '/drive/starred'
  const isShared  = pathname === '/drive/shared'
  const isTrashed = pathname === '/drive/trash'
  const isSystem  = pathname === '/drive/system'

  // Mode replié : nav en icônes vers les destinations principales (pas l'arbre).
  if (collapsed) {
    return (
      <nav className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
        <SidebarNavItem collapsed label={t('tree.my_drive', { defaultValue: 'Mon Drive' })}
          icon={<HardDrive size={20} />} active={isInDrive} onClick={() => navigate('/drive')} />
        <SidebarNavItem collapsed label={t('nav.shared')}
          icon={<Share2 size={20} />} active={isShared} onClick={() => navigate('/drive/shared')} />
        <SidebarNavItem collapsed label={t('nav.recent')}
          icon={<Clock size={20} />} active={isRecent} onClick={() => navigate('/drive/recent')} />
        <SidebarNavItem collapsed label={t('tree.starred')}
          icon={<Star size={20} />} active={isStarred} onClick={() => navigate('/drive/starred')} />
        <SidebarNavItem collapsed label={t('nav.trash')}
          icon={<Trash2 size={20} />} active={isTrashed} onClick={() => navigate('/drive/trash')} />
        <SidebarNavItem collapsed label={t('dual.title', { defaultValue: 'Deux volets' })}
          icon={<Columns2 size={20} />} active={pathname === '/drive/split'} onClick={() => navigate('/drive/split')} />
        {isAdmin && (
          <SidebarNavItem collapsed label={t('nav.system', { defaultValue: 'Système' })}
            icon={<ServerCog size={20} />} active={isSystem} onClick={() => navigate('/drive/system')} />
        )}
      </nav>
    )
  }

  const goToFolder = (id: string | null) => {
    if (id) navigate(`/drive?folder=${id}`)
    else navigate('/drive')
  }

  const handleContextMenu = (folder: Folder, x: number, y: number) => {
    setContextMenuFolderId(folder.id)
    openFolderMenu?.(folder, x, y)
  }

  // ── Items des menus contextuels (Mon Drive / montages distants) ───────────────
  const driveMenuItems = (): MenuItem[] => [
    { type: 'action', label: t('newfolder.title', { defaultValue: 'Nouveau dossier' }), icon: <FolderPlus size={15} />, onClick: openNewFolder },
    { type: 'action', label: t('common.refresh', { defaultValue: 'Actualiser' }), icon: <RefreshCw size={15} />, onClick: () => qc.invalidateQueries({ queryKey: ['tree-children'] }) },
  ]
  const remoteMenuItems = (r: RemoteConnection): MenuItem[] => [
    { type: 'action', label: t('common.open', { defaultValue: 'Ouvrir' }), icon: <ExternalLink size={15} />, onClick: () => goToRemote(r.id, '') },
    { type: 'action', label: t('common.refresh', { defaultValue: 'Actualiser' }), icon: <RefreshCw size={15} />, onClick: () => qc.invalidateQueries({ queryKey: ['remote-browse', r.id] }) },
    { type: 'action', label: t('rs.test', { defaultValue: 'Tester la connexion' }), icon: <Plug size={15} />, onClick: async () => { await filesApi.testRemote(r.id).catch(() => {}); qc.invalidateQueries({ queryKey: ['remotes'] }) } },
    { type: 'action', label: t('rs.manage', { defaultValue: 'Gérer les montages' }), icon: <Settings2 size={15} />, onClick: openRemotesPanel },
    { type: 'separator' },
    { type: 'action', label: t('rs.delete', { defaultValue: 'Supprimer le montage' }), icon: <Trash2 size={15} />, onClick: async () => {
        const ok = await confirm({
          title: t('rs.delete', { defaultValue: 'Supprimer le montage' }),
          message: t('rs.delete_confirm', { defaultValue: `Supprimer le montage « ${r.name} » ? Les fichiers distants ne sont pas affectés.`, name: r.name }),
          confirmLabel: t('common.delete', { defaultValue: 'Supprimer' }),
          variant: 'danger',
        })
        if (ok) { await filesApi.deleteRemote(r.id).catch(() => {}); qc.invalidateQueries({ queryKey: ['remotes'] }) }
      } },
  ]

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <nav className="flex-1 overflow-y-auto px-3 py-2 space-y-0.5">
        <DriveRootSection
          activeFolderId={currentFolderId}
          contextMenuFolderId={contextMenuFolderId}
          isInDrive={isInDrive}
          refreshKey={refreshKey}
          onNavigate={goToFolder}
          onContextMenu={handleContextMenu}
          onHeaderContextMenu={e => openCtx(e, driveMenuItems())}
        />

        {/* Montages distants — mêmes niveau hiérarchique que « Mon Drive » */}
        {remotes.map(remote => (
          <RemoteSection
            key={remote.id}
            remote={remote}
            activeRemoteId={activeRemoteId}
            activePath={activeRemotePath}
            onNavigate={goToRemote}
            onHeaderContextMenu={e => openCtx(e, remoteMenuItems(remote))}
          />
        ))}

        <div className="h-px bg-border mx-1 my-1" />

        <NavItem
          icon={<Share2 size={20} />}
          label={t('nav.shared')}
          isActive={isShared}
          onClick={() => navigate('/drive/shared')}
        />
        <NavItem
          icon={<Clock size={20} />}
          label={t('nav.recent')}
          isActive={isRecent}
          onClick={() => navigate('/drive/recent')}
        />
        <NavItem
          icon={<Star size={20} />}
          label={t('tree.starred')}
          isActive={isStarred}
          onClick={() => navigate('/drive/starred')}
        />
        <NavItem
          icon={<Trash2 size={20} />}
          label={t('nav.trash')}
          isActive={isTrashed}
          onClick={() => navigate('/drive/trash')}
        />
        <NavItem
          icon={<Columns2 size={20} />}
          label={t('dual.title', { defaultValue: 'Deux volets' })}
          isActive={pathname === '/drive/split'}
          onClick={() => navigate('/drive/split')}
        />
        {isAdmin && (
          <NavItem
            icon={<ServerCog size={20} />}
            label={t('nav.system', { defaultValue: 'Système' })}
            isActive={isSystem}
            onClick={() => navigate('/drive/system')}
          />
        )}

        {/* Recherches sauvegardées (smart folders) */}
        {savedSearches.length > 0 && (
          <>
            <div className="h-px bg-border mx-1 my-1" />
            <div className="px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-text-tertiary select-none">
              Recherches
            </div>
            {savedSearches.map(s => (
              <div
                key={s.id}
                onClick={() => applySaved(s)}
                className="group w-full flex items-center gap-3 px-3 py-2 rounded-full text-sm hover:bg-surface-2 cursor-pointer text-left select-none"
              >
                <Search size={18} className="flex-shrink-0" style={{ color: s.color ? tagColorHex(s.color) : '#5f6368' }} />
                <span className="truncate flex-1" style={{ color: '#5f6368' }}>{s.name}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); void deleteSavedSearch(s.id) }}
                  className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-danger-light text-danger transition-opacity"
                  title="Supprimer la recherche"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </>
        )}
      </nav>

      {ctx && (
        <MenuDropdown items={ctx.items} pos={{ top: ctx.y, left: ctx.x }} onClose={() => setCtx(null)} />
      )}
      {confirmState && (
        <ConfirmDialog {...confirmState} onConfirm={handleConfirm} onCancel={handleCancel} />
      )}
    </div>
  )
}
