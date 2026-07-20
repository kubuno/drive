import { useState, useMemo, useEffect } from 'react'
import { Link as RouterLink, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Folder as FolderIcon, FolderOpen, ChevronRight, Star, Clock,
  Trash2, Share2, HardDrive, Server, FolderPlus, RefreshCw, Plug, Settings2, ExternalLink, Columns2, ServerCog,
  Search, X, Cloud,
} from 'lucide-react'
import { MenuDropdown, type MenuItem, ConfirmDialog } from '@ui'
import { filesApi, FolderGlyph, type Folder, type RemoteConnection, type RemoteEntry } from '@kubuno/drive'
import { usePendingKind, pendingBoxClass, pendingBoxStyle, useConfirm, useAuthStore } from '@kubuno/sdk'
import { useFilesStore, type FilesSearchFilters } from '@kubuno/drive'
import { useDriveExtras, tagColorHex, type SavedSearch } from './driveExtras'
import { useFilesContextMenuStore } from './filesContextMenuStore'
import { SidebarNavItem, useModulesStore, ModuleServiceRegistry } from '@kubuno/sdk'
import { formatSize } from '@kubuno/drive'
import { useIsMobile } from './openable'
import { hashTo, fromHash } from './hashRoute'

// ── Shared sidebar affordances ────────────────────────────────────────────────
// House rule: the sidebar contains no <button>. Anything clickable is an <a>.
// Navigation carries a real href (react-router <Link>); a pure action uses an
// anchor with role="button" that cancels the default and handles Space (Enter is
// already native on an anchor, wiring it would fire the action twice).

const FOCUS_RING = 'outline-none focus-visible:ring-2 focus-visible:ring-primary'

/**
 * Hover background driven in JavaScript instead of a `hover:bg-*` utility.
 *
 * A module bundle emits its Tailwind utilities inside the `kubuno-module`
 * cascade layer, which loses against the host's `utilities` layer: a
 * `hover:bg-*` class coming from a module simply never paints in the shell's
 * left sidebar (the computed background stays transparent on hover). Static
 * background classes do win, so only the `hover:` variants need this fallback.
 *
 * Resetting to an empty string on leave hands control back to the static
 * active-state class — that is intentional.
 */
const hoverBg = (color: string) => ({
  onMouseEnter: (e: React.MouseEvent<HTMLElement>) => { e.currentTarget.style.backgroundColor = color },
  onMouseLeave: (e: React.MouseEvent<HTMLElement>) => { e.currentTarget.style.backgroundColor = '' },
})

/**
 * Row hover tint. Same value as the core's SidebarNavItem so a drive row and a
 * mail row highlight identically — the left panel must feel like ONE sidebar,
 * whichever module renders it.
 */
const ROW_HOVER = 'color-mix(in srgb, var(--color-primary) 12%, white)'

/**
 * Expand/collapse chevron of a tree node — a pure action, never a navigation.
 * Kept as a sibling of the node's navigation link: an <a> must never nest in an <a>.
 */
function ExpandToggle({ expanded, onToggle, label }: {
  expanded: boolean; onToggle: () => void; label: string
}) {
  return (
    <a
      href="#"
      role="button"
      aria-label={label}
      aria-expanded={expanded}
      className={`shrink-0 inline-flex items-center justify-center p-0.5 rounded cursor-pointer ${FOCUS_RING}`}
      style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 150ms' }}
      {...hoverBg('rgba(0,0,0,0.1)')}
      onClick={e => { e.preventDefault(); e.stopPropagation(); onToggle() }}
      onKeyDown={e => { if (e.key === ' ') { e.preventDefault(); onToggle() } }}
    >
      <ChevronRight size={14} className="text-text-tertiary" />
    </a>
  )
}

// ── Mobile drawer ─────────────────────────────────────────────────────────────

type TFn = (key: string, opts?: Record<string, unknown>) => string

/** Row of the mobile drawer: a 52px tap target, icon + label, tinted when active. */
function DrawerLink({ icon, label, active, to }: {
  icon: React.ReactNode; label: string; active?: boolean; to: string
}) {
  return (
    <RouterLink
      to={to}
      className={`w-full flex items-center gap-4 h-[52px] px-4 rounded-r-full text-left text-[15px] transition-colors cursor-pointer ${FOCUS_RING}
                  ${active ? 'bg-primary-light text-primary font-medium' : 'text-text-primary active:bg-surface-2'}`}
    >
      <span className={`shrink-0 ${active ? 'text-primary' : 'text-text-secondary'}`}>{icon}</span>
      <span className="flex-1 min-w-0 truncate">{label}</span>
    </RouterLink>
  )
}

function MobileDrawerNav({ t, pathname, isInDrive, isRecent, isTrashed, isSystem, isAdmin, moduleMounts, remotes }: {
  t: TFn
  pathname: string
  isInDrive: boolean; isRecent: boolean; isTrashed: boolean; isSystem: boolean
  isAdmin: boolean
  moduleMounts: Array<{ moduleId: string; key: string; name: string }>
  remotes: RemoteConnection[]
}) {
  const user = useAuthStore(s => s.user)
  const pct = user && user.quota_bytes > 0
    ? Math.min(100, Math.round((user.used_bytes / user.quota_bytes) * 100))
    : null
  const barColor = pct == null ? '' : pct > 90 ? 'bg-danger' : pct > 70 ? 'bg-warning' : 'bg-primary'

  return (
    <div className="flex-1 flex flex-col overflow-y-auto py-2 pr-2">
      <nav className="space-y-0.5">
        <DrawerLink icon={<HardDrive size={22} />} label={t('tree.my_drive', { defaultValue: 'Mon Drive' })}
          active={isInDrive} to="/drive" />
        <DrawerLink icon={<Clock size={22} />} label={t('nav.recent')}
          active={isRecent} to="/drive/recent" />
        {moduleMounts.map(mt => (
          <DrawerLink key={`${mt.moduleId}:${mt.key}`} icon={<Cloud size={22} />} label={mt.name}
            active={pathname === `/drive/m/${mt.moduleId}/${mt.key}`}
            to={`/drive/m/${mt.moduleId}/${mt.key}`} />
        ))}
        {remotes.map(r => (
          <DrawerLink key={r.id} icon={<Server size={22} />} label={r.name}
            active={pathname === `/drive/remote/${r.id}`}
            to={`/drive/remote/${r.id}`} />
        ))}
        <DrawerLink icon={<Trash2 size={22} />} label={t('nav.trash')}
          active={isTrashed} to="/drive/trash" />
        {isAdmin && (
          <DrawerLink icon={<ServerCog size={22} />} label={t('nav.system', { defaultValue: 'Système' })}
            active={isSystem} to="/drive/system" />
        )}
        <DrawerLink icon={<Settings2 size={22} />} label={t('nav.storage_settings')}
          active={pathname === '/drive/settings'} to="/drive/settings" />
      </nav>

      {/* Storage gauge — the header one is desktop-only, so this is the ONLY
          place a phone user sees their quota. */}
      {pct != null && user && (
        <div className="mt-auto pt-4 px-4 pb-2">
          <div className="flex items-center gap-2 mb-2 text-text-secondary">
            <Cloud size={20} />
            <span className="text-[15px]">{t('storage.title')}</span>
          </div>
          <div className="h-1.5 w-full bg-black/10 rounded-full overflow-hidden mb-2">
            <div className={`h-full ${barColor} rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
          </div>
          <p className="text-xs text-text-secondary mb-3">
            {formatSize(user.used_bytes)} / {formatSize(user.quota_bytes)}
          </p>
          <RouterLink
            to="/drive/storage"
            className={`w-full h-10 flex items-center justify-center rounded-full border border-border text-primary text-sm font-medium active:bg-surface-2 transition-colors cursor-pointer ${FOCUS_RING}`}
          >
            {t('storage.manage', { defaultValue: 'Gérer le stockage' })}
          </RouterLink>
        </div>
      )}
    </div>
  )
}

// ── Folder tree node ──────────────────────────────────────────────────────────

function TreeNode({
  folder, depth, activeFolderId, contextMenuFolderId, refreshKey, linkFor, onContextMenu,
}: {
  folder: Folder
  depth: number
  activeFolderId: string | null
  contextMenuFolderId: string | null
  refreshKey: number
  /** Builds the real href of a folder — the row navigates through a <Link>. */
  linkFor: (id: string | null) => string
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
          ${isActive ? 'bg-primary-light' : isContextTarget ? 'bg-surface-3' : ''} ${pendingBoxClass(pendingKind)}`}
        style={{ paddingLeft: `${8 + depth * 16}px`, paddingRight: '8px', ...pendingBoxStyle(pendingKind) }}
        {...(isActive || isContextTarget ? {} : hoverBg(ROW_HOVER))}
        onContextMenu={handleContextMenu}
      >
        <ExpandToggle
          expanded={expanded}
          onToggle={() => setExpanded(v => !v)}
          label={expanded ? t('common.collapse') : t('common.expand')}
        />
        <RouterLink
          to={linkFor(folder.id)}
          className={`flex-1 min-w-0 flex items-center gap-1 self-stretch -my-1 py-1 pr-2 -mr-2 rounded-full cursor-pointer ${FOCUS_RING}`}
        >
          <FolderGlyph folder={folder} size={15} className="shrink-0" color={isActive ? '#1a73e8' : undefined} />
          <span
            className="text-sm truncate ml-1 flex-1"
            style={{ color: isActive ? '#041e49' : '#5f6368', fontWeight: isActive ? 600 : 400 }}
          >
            {folder.name}
          </span>
        </RouterLink>
      </div>

      {expanded && children.map(child => (
        <TreeNode
          key={child.id}
          folder={child}
          depth={depth + 1}
          activeFolderId={activeFolderId}
          contextMenuFolderId={contextMenuFolderId}
          refreshKey={refreshKey}
          linkFor={linkFor}
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
  activeFolderId, contextMenuFolderId, isInDrive, refreshKey, linkFor, onContextMenu, onHeaderContextMenu,
}: {
  activeFolderId: string | null
  contextMenuFolderId: string | null
  isInDrive: boolean
  refreshKey: number
  /** Builds the real href of a folder (null = the drive root). */
  linkFor: (id: string | null) => string
  onContextMenu: (folder: Folder, x: number, y: number) => void
  onHeaderContextMenu?: (e: React.MouseEvent) => void
}) {
  const { t } = useTranslation('drive')
  // Collapsed by default (user request).
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
          ${isRootActive ? 'bg-primary-light' : ''}`}
        {...(isRootActive ? {} : hoverBg(ROW_HOVER))}
        onContextMenu={onHeaderContextMenu}
      >
        <ExpandToggle
          expanded={expanded}
          onToggle={() => setExpanded(v => !v)}
          label={expanded ? t('tree.collapse_drive') : t('tree.expand_drive')}
        />
        <RouterLink
          to={linkFor(null)}
          className={`flex-1 min-w-0 flex items-center gap-1 self-stretch -my-2 py-2 pr-3 -mr-3 rounded-full cursor-pointer ${FOCUS_RING}`}
        >
          <FolderOpen
            size={20}
            className="shrink-0"
            style={{ color: isRootActive ? '#1a73e8' : '#5f6368' }}
          />
          <span
            className="text-sm font-medium truncate ml-1 flex-1"
            style={{ color: isRootActive ? '#041e49' : '#5f6368', fontWeight: 600 }}
          >
            {t('tree.my_drive')}
          </span>
        </RouterLink>
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
              linkFor={linkFor}
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
  remoteId, entry, depth, activeRemoteId, activePath, linkFor,
}: {
  remoteId: string
  entry: RemoteEntry
  depth: number
  activeRemoteId: string | null
  activePath: string
  /** Builds the real href of a remote folder. */
  linkFor: (remoteId: string, path: string) => string
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
          ${isActive ? 'bg-primary-light' : ''}`}
        style={{ paddingLeft: `${8 + depth * 16}px`, paddingRight: '8px' }}
        {...(isActive ? {} : hoverBg(ROW_HOVER))}
      >
        <ExpandToggle
          expanded={expanded}
          onToggle={() => setExpanded(v => !v)}
          label={expanded ? t('common.collapse') : t('common.expand')}
        />
        <RouterLink
          to={linkFor(remoteId, entry.path)}
          className={`flex-1 min-w-0 flex items-center gap-1 self-stretch -my-1 py-1 pr-2 -mr-2 rounded-full cursor-pointer ${FOCUS_RING}`}
        >
          <FolderIcon size={15} className="shrink-0" style={{ color: isActive ? '#1a73e8' : '#5f6368' }} fill="currentColor" />
          <span className="text-sm truncate ml-1 flex-1" style={{ color: isActive ? '#041e49' : '#5f6368', fontWeight: isActive ? 600 : 400 }}>
            {entry.name}
          </span>
        </RouterLink>
      </div>
      {expanded && childDirs.map(child => (
        <RemoteTreeNode
          key={child.path} remoteId={remoteId} entry={child} depth={depth + 1}
          activeRemoteId={activeRemoteId} activePath={activePath} linkFor={linkFor}
        />
      ))}
    </div>
  )
}

function RemoteSection({
  remote, activeRemoteId, activePath, linkFor, onHeaderContextMenu,
}: {
  remote: RemoteConnection
  activeRemoteId: string | null
  activePath: string
  /** Builds the real href of a remote folder. */
  linkFor: (remoteId: string, path: string) => string
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
          ${isRootActive ? 'bg-primary-light' : ''}`}
        {...(isRootActive ? {} : hoverBg(ROW_HOVER))}
        onContextMenu={onHeaderContextMenu}
        title={t(`rs.status_${remote.status}`, { defaultValue: remote.status })}
      >
        <ExpandToggle
          expanded={expanded}
          onToggle={() => setExpanded(v => !v)}
          label={expanded ? t('common.collapse') : t('common.expand')}
        />
        <RouterLink
          to={linkFor(remote.id, '')}
          className={`flex-1 min-w-0 flex items-center gap-1 self-stretch -my-2 py-2 pr-3 -mr-3 rounded-full cursor-pointer ${FOCUS_RING}`}
        >
          <span className="relative shrink-0">
            <Server size={20} style={{ color: isRootActive ? '#1a73e8' : '#5f6368' }} />
            <span
              className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-white"
              style={{ backgroundColor: REMOTE_STATUS_COLOR[remote.status] }}
            />
          </span>
          <span className="text-sm font-medium truncate ml-1 flex-1" style={{ color: isRootActive ? '#041e49' : '#5f6368', fontWeight: 600 }}>
            {remote.name}
          </span>
        </RouterLink>
      </div>
      {expanded && (
        <div className="pl-4">
          {dirs.map(d => (
            <RemoteTreeNode
              key={d.path} remoteId={remote.id} entry={d} depth={0}
              activeRemoteId={activeRemoteId} activePath={activePath} linkFor={linkFor}
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

// ── Module mount tree (e.g. p2pnas → "My Cloud") ──────────────────────────────
// A storage mount published by another active module. Browsed live through the
// module's StorageSource so it renders identically to a remote mount / Mon Drive.

type MountFolder = { id: string; name: string }
type MountSource = { list: (parentId: string | null) => Promise<{ folders: MountFolder[]; files: unknown[] }> }

function ModuleTreeNode({
  source, moduleId, mountKey, folder, depth, activePath, linkFor,
}: {
  source: MountSource
  moduleId: string
  mountKey: string
  folder: MountFolder
  depth: number
  activePath: string | null
  /** Builds the real href of a mount folder. */
  linkFor: (path: string) => string
}) {
  const { t } = useTranslation('drive')
  const [expanded, setExpanded] = useState(false)
  const isActive = activePath === folder.id

  const { data } = useQuery({
    queryKey: ['module-mount', moduleId, mountKey, folder.id],
    queryFn:  () => source.list(folder.id),
    enabled:  expanded,
    retry:    false,
  })
  const childDirs = data?.folders ?? []

  return (
    <div>
      <div
        className={`flex items-center gap-1 py-1 rounded-full cursor-pointer select-none
          ${isActive ? 'bg-primary-light' : ''}`}
        style={{ paddingLeft: `${8 + depth * 16}px`, paddingRight: '8px' }}
        {...(isActive ? {} : hoverBg(ROW_HOVER))}
      >
        <ExpandToggle
          expanded={expanded}
          onToggle={() => setExpanded(v => !v)}
          label={expanded ? t('common.collapse') : t('common.expand')}
        />
        <RouterLink
          to={linkFor(folder.id)}
          className={`flex-1 min-w-0 flex items-center gap-1 self-stretch -my-1 py-1 pr-2 -mr-2 rounded-full cursor-pointer ${FOCUS_RING}`}
        >
          <FolderIcon size={15} className="shrink-0" style={{ color: isActive ? '#1a73e8' : '#5f6368' }} fill="currentColor" />
          <span className="text-sm truncate ml-1 flex-1" style={{ color: isActive ? '#041e49' : '#5f6368', fontWeight: isActive ? 600 : 400 }}>
            {folder.name}
          </span>
        </RouterLink>
      </div>
      {expanded && childDirs.map(child => (
        <ModuleTreeNode
          key={child.id} source={source} moduleId={moduleId} mountKey={mountKey}
          folder={child} depth={depth + 1} activePath={activePath} linkFor={linkFor}
        />
      ))}
    </div>
  )
}

function ModuleMountSection({
  moduleId, mountKey, name, isActiveMount, activePath, linkFor, onHeaderContextMenu,
}: {
  moduleId: string
  mountKey: string
  name: string
  isActiveMount: boolean
  activePath: string
  /** Builds the real href of a mount folder ('' = the mount root). */
  linkFor: (path: string) => string
  onHeaderContextMenu?: (e: React.MouseEvent) => void
}) {
  const { t } = useTranslation('drive')
  const [expanded, setExpanded] = useState(false)
  const source = useMemo(
    () => ModuleServiceRegistry.call<MountSource>(moduleId, 'getStorageSource', mountKey),
    [moduleId, mountKey],
  )
  const isRootActive = isActiveMount && activePath === ''

  const { data } = useQuery({
    queryKey: ['module-mount', moduleId, mountKey, ''],
    queryFn:  () => source!.list(''),
    enabled:  expanded && !!source,
    retry:    false,
  })
  const dirs = data?.folders ?? []

  return (
    <div>
      <div
        className={`flex items-center gap-1 px-3 py-2 rounded-full cursor-pointer select-none
          ${isRootActive ? 'bg-primary-light' : ''}`}
        {...(isRootActive ? {} : hoverBg(ROW_HOVER))}
        onContextMenu={onHeaderContextMenu}
      >
        <ExpandToggle
          expanded={expanded}
          onToggle={() => setExpanded(v => !v)}
          label={expanded ? t('common.collapse') : t('common.expand')}
        />
        <RouterLink
          to={linkFor('')}
          className={`flex-1 min-w-0 flex items-center gap-1 self-stretch -my-2 py-2 pr-3 -mr-3 rounded-full cursor-pointer ${FOCUS_RING}`}
        >
          <Cloud size={20} className="shrink-0" style={{ color: isRootActive ? '#1a73e8' : '#5f6368' }} />
          <span className="text-sm font-medium truncate ml-1 flex-1" style={{ color: isRootActive ? '#041e49' : '#5f6368', fontWeight: 600 }}>
            {name}
          </span>
        </RouterLink>
      </div>
      {expanded && source && (
        <div className="pl-4">
          {dirs.map(d => (
            <ModuleTreeNode
              key={d.id} source={source} moduleId={moduleId} mountKey={mountKey}
              folder={d} depth={0} activePath={activePath} linkFor={linkFor}
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
  icon, label, isActive, to,
}: {
  icon: React.ReactNode
  label: string
  isActive: boolean
  to: string
}) {
  return (
    <RouterLink
      to={to}
      className={`w-full flex items-center gap-3 px-3 py-2 rounded-full text-sm
        transition-colors text-left select-none cursor-pointer ${FOCUS_RING}
        ${isActive ? 'bg-primary-light' : ''}`}
      {...(isActive ? {} : hoverBg(ROW_HOVER))}
    >
      <span className="flex-shrink-0" style={{ color: isActive ? '#1a73e8' : '#5f6368' }}>
        {icon}
      </span>
      <span className="truncate flex-1" style={{ color: isActive ? '#041e49' : '#5f6368', fontWeight: isActive ? 600 : 400 }}>
        {label}
      </span>
    </RouterLink>
  )
}

// ── FilesTreeSidebar ──────────────────────────────────────────────────────────

export default function FilesTreeSidebar({ collapsed = false }: { collapsed?: boolean }) {
  const { t } = useTranslation('drive')
  const isMobile = useIsMobile()
  const { pathname, hash } = useLocation()
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
  }

  // A saved search is an addressable view without a route of its own, so it is
  // linked as `/drive/#search/<id>`. The state is read back from the hash, which
  // makes a pasted link and the browser Back button both restore the view.
  useEffect(() => {
    const target = fromHash(hash)
    if (!target || target.kind !== 'search') return
    const saved = savedSearches.find(s => s.id === target.id)
    if (saved) applySaved(saved)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hash, savedSearches])
  const { openFolderMenu, contextMenuFolderId, setContextMenuFolderId } = useFilesContextMenuStore()
  const qc = useQueryClient()
  const { confirm, confirmState, handleConfirm, handleCancel } = useConfirm()
  const isAdmin = useAuthStore(s => s.user?.role === 'admin')

  // Storage mounts published by other active modules (e.g. p2pnas → "My Cloud").
  // A module may decide a mount is unavailable for this user (e.g. no quota) and
  // signal a recheck via the `kubuno:module-mounts-changed` event.
  const activeModules = useModulesStore(s => s.activeModules)
  const [mountsVersion, setMountsVersion] = useState(0)
  useEffect(() => {
    const h = () => setMountsVersion(v => v + 1)
    window.addEventListener('kubuno:module-mounts-changed', h)
    return () => window.removeEventListener('kubuno:module-mounts-changed', h)
  }, [])
  const moduleMounts = useMemo(
    () => activeModules.flatMap(m => {
      const list = ModuleServiceRegistry.call<Array<{ key: string; name: string }>>(m.module_id, 'getStorageMounts')
      return (list ?? []).map(x => ({ moduleId: m.module_id, key: x.key, name: x.name }))
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeModules, mountsVersion],
  )
  // Active module mount (route /drive/m/:moduleId/:mountKey?path=…).
  const moduleMatch = pathname.match(/^\/drive\/m\/([^/]+)\/([^/]+)/)
  const activeModuleId = moduleMatch ? moduleMatch[1] : null
  const activeMountKey = moduleMatch ? moduleMatch[2] : null
  const activeMountPath = moduleMatch ? (searchParams.get('path') ?? '') : ''
  const moduleMountLink = (moduleId: string, key: string, path: string) =>
    `/drive/m/${moduleId}/${key}${path ? `?path=${encodeURIComponent(path)}` : ''}`
  const goToModuleMount = (moduleId: string, key: string, path: string) =>
    navigate(moduleMountLink(moduleId, key, path))

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
  const remoteLink = (remoteId: string, path: string) =>
    `/drive/remote/${remoteId}?path=${encodeURIComponent(path)}`
  const goToRemote = (remoteId: string, path: string) => navigate(remoteLink(remoteId, path))

  const isSpecial = ['/drive/recent', '/drive/starred', '/drive/shared', '/drive/trash', '/drive/settings', '/drive/storage', '/drive/remote', '/drive/split', '/drive/system', '/drive/m'].some(
    p => pathname === p || pathname.startsWith(p + '/'),
  )
  const isInDrive = !isSpecial
  const isRecent  = pathname === '/drive/recent'
  const isStarred = pathname === '/drive/starred'
  const isShared  = pathname === '/drive/shared'
  const isTrashed = pathname === '/drive/trash'
  const isSystem  = pathname === '/drive/system'

  // Mobile : le tiroir remplace la sidebar. Il ne rend PAS l'arborescence (des
  // chevrons de 16px ne se manipulent pas au pouce) mais les destinations que la
  // barre du bas n'a pas déjà — plus la jauge de stockage, invisible ailleurs sur
  // mobile (FilesStorageGaugeHeader est `hidden lg:flex`).
  if (isMobile && !collapsed) {
    return (
      <MobileDrawerNav
        t={t} pathname={pathname}
        isInDrive={isInDrive} isRecent={isRecent} isTrashed={isTrashed} isSystem={isSystem}
        isAdmin={isAdmin} moduleMounts={moduleMounts} remotes={remotes}
      />
    )
  }

  // Mode replié : nav en icônes vers les destinations principales (pas l'arbre).
  if (collapsed) {
    return (
      <nav className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
        <SidebarNavItem collapsed label={t('tree.my_drive', { defaultValue: 'Mon Drive' })}
          icon={<HardDrive size={20} />} active={isInDrive} to="/drive" />
        {moduleMounts.map(mt => (
          <SidebarNavItem key={`${mt.moduleId}:${mt.key}`} collapsed label={mt.name}
            icon={<Cloud size={20} />} active={pathname === `/drive/m/${mt.moduleId}/${mt.key}`}
            to={`/drive/m/${mt.moduleId}/${mt.key}`} />
        ))}
        <SidebarNavItem collapsed label={t('nav.shared')}
          icon={<Share2 size={20} />} active={isShared} to="/drive/shared" />
        <SidebarNavItem collapsed label={t('nav.recent')}
          icon={<Clock size={20} />} active={isRecent} to="/drive/recent" />
        <SidebarNavItem collapsed label={t('tree.starred')}
          icon={<Star size={20} />} active={isStarred} to="/drive/starred" />
        <SidebarNavItem collapsed label={t('nav.trash')}
          icon={<Trash2 size={20} />} active={isTrashed} to="/drive/trash" />
        <SidebarNavItem collapsed label={t('dual.title', { defaultValue: 'Deux volets' })}
          icon={<Columns2 size={20} />} active={pathname === '/drive/split'} to="/drive/split" />
        {isAdmin && (
          <SidebarNavItem collapsed label={t('nav.system', { defaultValue: 'Système' })}
            icon={<ServerCog size={20} />} active={isSystem} to="/drive/system" />
        )}
      </nav>
    )
  }

  const folderLink = (id: string | null) => (id ? `/drive?folder=${id}` : '/drive')

  const handleContextMenu = (folder: Folder, x: number, y: number) => {
    setContextMenuFolderId(folder.id)
    openFolderMenu?.(folder, x, y)
  }

  // ── Items des menus contextuels (Mon Drive / montages distants) ───────────────
  const driveMenuItems = (): MenuItem[] => [
    { type: 'action', label: t('newfolder.title', { defaultValue: 'Nouveau dossier' }), icon: <FolderPlus size={15} />, onClick: openNewFolder },
    { type: 'action', label: t('common.refresh', { defaultValue: 'Actualiser' }), icon: <RefreshCw size={15} />, onClick: () => qc.invalidateQueries({ queryKey: ['tree-children'] }) },
  ]
  const moduleMountMenuItems = (mt: { moduleId: string; key: string }): MenuItem[] => [
    { type: 'action', label: t('common.open', { defaultValue: 'Ouvrir' }), icon: <ExternalLink size={15} />, onClick: () => goToModuleMount(mt.moduleId, mt.key, '') },
    { type: 'action', label: t('common.refresh', { defaultValue: 'Actualiser' }), icon: <RefreshCw size={15} />, onClick: () => qc.invalidateQueries({ queryKey: ['module-mount', mt.moduleId, mt.key] }) },
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
          linkFor={folderLink}
          onContextMenu={handleContextMenu}
          onHeaderContextMenu={e => openCtx(e, driveMenuItems())}
        />

        {/* Montages de modules (ex. p2pnas → « My Cloud ») — 2e position, juste
            après « Mon Drive » et avant les montages distants, en arbre complet. */}
        {moduleMounts.map(mt => (
          <ModuleMountSection
            key={`${mt.moduleId}:${mt.key}`}
            moduleId={mt.moduleId}
            mountKey={mt.key}
            name={mt.name}
            isActiveMount={activeModuleId === mt.moduleId && activeMountKey === mt.key}
            activePath={activeMountPath}
            linkFor={path => moduleMountLink(mt.moduleId, mt.key, path)}
            onHeaderContextMenu={e => openCtx(e, moduleMountMenuItems(mt))}
          />
        ))}

        {/* Montages distants — même niveau hiérarchique que « Mon Drive » */}
        {remotes.map(remote => (
          <RemoteSection
            key={remote.id}
            remote={remote}
            activeRemoteId={activeRemoteId}
            activePath={activeRemotePath}
            linkFor={remoteLink}
            onHeaderContextMenu={e => openCtx(e, remoteMenuItems(remote))}
          />
        ))}

        <div className="h-px bg-border mx-1 my-1" />

        <NavItem
          icon={<Share2 size={20} />}
          label={t('nav.shared')}
          isActive={isShared}
          to="/drive/shared"
        />
        <NavItem
          icon={<Clock size={20} />}
          label={t('nav.recent')}
          isActive={isRecent}
          to="/drive/recent"
        />
        <NavItem
          icon={<Star size={20} />}
          label={t('tree.starred')}
          isActive={isStarred}
          to="/drive/starred"
        />
        <NavItem
          icon={<Trash2 size={20} />}
          label={t('nav.trash')}
          isActive={isTrashed}
          to="/drive/trash"
        />
        <NavItem
          icon={<Columns2 size={20} />}
          label={t('dual.title', { defaultValue: 'Deux volets' })}
          isActive={pathname === '/drive/split'}
          to="/drive/split"
        />
        {isAdmin && (
          <NavItem
            icon={<ServerCog size={20} />}
            label={t('nav.system', { defaultValue: 'Système' })}
            isActive={isSystem}
            to="/drive/system"
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
                className="group w-full flex items-center gap-3 px-3 py-2 rounded-full text-sm text-left select-none"
                {...hoverBg(ROW_HOVER)}
              >
                {/* Addressable view, no route of its own → real hash link. */}
                <RouterLink
                  to={hashTo('search', s.id)}
                  className={`flex items-center gap-3 flex-1 min-w-0 self-stretch -my-2 py-2 pr-3 -mr-3 rounded-full cursor-pointer ${FOCUS_RING}`}
                >
                  <Search size={18} className="flex-shrink-0" style={{ color: s.color ? tagColorHex(s.color) : '#5f6368' }} />
                  <span className="truncate flex-1" style={{ color: '#5f6368' }}>{s.name}</span>
                </RouterLink>
                <a
                  href="#"
                  role="button"
                  onClick={e => { e.preventDefault(); e.stopPropagation(); void deleteSavedSearch(s.id) }}
                  onKeyDown={e => { if (e.key === ' ') { e.preventDefault(); void deleteSavedSearch(s.id) } }}
                  className={`opacity-0 group-hover:opacity-100 p-0.5 rounded text-danger transition-opacity cursor-pointer ${FOCUS_RING}`}
                  {...hoverBg('var(--color-danger-light)')}
                  title="Supprimer la recherche"
                >
                  <X size={14} />
                </a>
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
